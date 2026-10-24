/**
 * RPA Video Editor - Local Server & Media Backend
 *
 * Cleanroom private studio server providing asset hosting, project persistence,
 * and media pipeline services on port 3800.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { handleMcpRequest } = require('./mcp_handler');

const PORT = process.env.PORT || 3800;
const HOST = '127.0.0.1';
const ROOT_DIR = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT_DIR, 'client');
const PROJECTS_DIR = path.join(ROOT_DIR, 'projects');
const EXPORTS_DIR = path.join(ROOT_DIR, 'exports');

// Ensure storage directories exist
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });
if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.ico': 'image/x-icon'
};

function getInstalledWindowsFonts(callback) {
    const fontsSet = new Set();
    const cmd1 = 'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"';
    const cmd2 = 'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"';

    const parseRegOutput = (stdout) => {
        if (!stdout) return;
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('HKEY_')) continue;
            const match = trimmed.match(/^(.+?)\s+REG_(?:SZ|EXPAND_SZ)\s+/i);
            if (match && match[1]) {
                let fontName = match[1].trim();
                fontName = fontName.replace(/\s*\((?:TrueType|OpenType|PostScript)\)$/i, '').trim();
                if (fontName) fontsSet.add(fontName);
            }
        }
    };

    exec(cmd1, { maxBuffer: 1024 * 1024 * 10 }, (err1, stdout1) => {
        if (!err1 && stdout1) parseRegOutput(stdout1);
        exec(cmd2, { maxBuffer: 1024 * 1024 * 10 }, (err2, stdout2) => {
            if (!err2 && stdout2) parseRegOutput(stdout2);

            // Also check Windows user font directory directly
            const userFontDir = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts');
            if (fs.existsSync(userFontDir)) {
                try {
                    const files = fs.readdirSync(userFontDir);
                    for (const file of files) {
                        const name = path.basename(file, path.extname(file)).replace(/[-_]/g, ' ');
                        if (name) fontsSet.add(name);
                    }
                } catch (e) {}
            }

            const sorted = Array.from(fontsSet).sort((a, b) => a.localeCompare(b));
            callback(sorted);
        });
    });
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data, null, 2));
}

function handleApiRequest(req, res, url) {
    // Model Context Protocol (MCP) JSON-RPC 2.0 Endpoint
    if (req.method === 'POST' && url.pathname === '/api/mcp') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const mcpReq = JSON.parse(body);
                handleMcpRequest(mcpReq, (mcpRes) => {
                    sendJson(res, 200, mcpRes);
                });
            } catch (err) {
                sendJson(res, 400, {
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32700, message: 'Invalid JSON-RPC 2.0 payload' }
                });
            }
        });
        return;
    }


    // 1. System Status
    if (req.method === 'GET' && url.pathname === '/api/system/status') {
        return sendJson(res, 200, {
            app: 'RPA Video Editor',
            version: '2.0.0',
            developer: 'K Vanlalrengpuia',
            email: 'rengakhiangte@gmail.com',
            license: 'Open Source (MIT)',
            mcp_enabled: true,
            status: 'online',
            projects_dir: PROJECTS_DIR,
            exports_dir: EXPORTS_DIR
        });
    }

    // 2. List Projects
    if (req.method === 'GET' && url.pathname === '/api/projects') {
        const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.rpavideo'));
        const projects = files.map(filename => {
            const fullPath = path.join(PROJECTS_DIR, filename);
            const stat = fs.statSync(fullPath);
            try {
                const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                return {
                    id: path.basename(filename, '.rpavideo'),
                    filename,
                    title: data.title || filename,
                    duration: data.duration || 0,
                    updatedAt: stat.mtime
                };
            } catch {
                return { id: filename, filename, title: filename, updatedAt: stat.mtime };
            }
        });
        return sendJson(res, 200, { projects });
    }

    // 3. Save Project
    if (req.method === 'POST' && url.pathname === '/api/projects/save') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const project = JSON.parse(body);
                const id = (project.title || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
                const filePath = path.join(PROJECTS_DIR, `${id}.rpavideo`);
                fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');
                return sendJson(res, 200, { success: true, id, path: filePath });
            } catch (err) {
                return sendJson(res, 400, { error: `Failed to save project: ${err.message}` });
            }
        });
        return;
    }

    // 4. Load Project
    if (req.method === 'GET' && url.pathname.startsWith('/api/projects/')) {
        const id = url.pathname.replace('/api/projects/', '');
        const filePath = path.join(PROJECTS_DIR, `${id}.rpavideo`);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return sendJson(res, 200, data);
        } else {
            return sendJson(res, 404, { error: 'Project not found.' });
        }
    }

    // 5. Delete Project
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/projects/')) {
        const id = url.pathname.replace('/api/projects/', '');
        const filePath = path.join(PROJECTS_DIR, `${id}.rpavideo`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return sendJson(res, 200, { success: true, id });
        } else {
            return sendJson(res, 404, { error: 'Project not found.' });
        }
    }

    // 6. Installed Windows & User Fonts
    if (req.method === 'GET' && url.pathname === '/api/system/fonts') {
        getInstalledWindowsFonts(fonts => {
            return sendJson(res, 200, { success: true, count: fonts.length, fonts });
        });
        return;
    }

    sendJson(res, 404, { error: 'API route not found' });
}

const server = http.createServer((req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (url.pathname.startsWith('/api/')) {
        return handleApiRequest(req, res, url);
    }

    // Serve Static Client Assets
    let safePath = path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '\\') safePath = '/index.html';

    const filePath = path.join(CLIENT_DIR, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`File not found: ${url.pathname}`);
    }
});

function start(port = PORT, host = HOST) {
    return new Promise((resolve, reject) => {
        server.listen(port, host, () => {
            const appUrl = `http://${host}:${port}`;
            console.log(`\n======================================================`);
            console.log(`  🎬 RPA VIDEO EDITOR - STUDIO MEDIA SERVER ONLINE    `);
            console.log(`======================================================`);
            console.log(`  Studio URL:    ${appUrl}`);
            console.log(`  Projects Path: ${PROJECTS_DIR}`);
            console.log(`  Exports Path:  ${EXPORTS_DIR}`);
            console.log(`======================================================\n`);

            // Only open external browser if explicitly requested (never in offline desktop mode)
            if (process.env.OPEN_BROWSER === 'true' && !process.env.OFFLINE_DESKTOP && !process.versions?.electron) {
                const openCommand = process.platform === 'win32' ? `start "" "${appUrl}"` :
                                    process.platform === 'darwin' ? `open "${appUrl}"` : `xdg-open "${appUrl}"`;
                exec(openCommand, () => {});
            }
            resolve(server);
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`[RPA Server] Port ${port} is already in use. Utilizing existing instance.`);
                resolve(server);
            } else {
                reject(err);
            }
        });
    });
}

if (require.main === module) {
    start();
}

module.exports = { server, start, PORT, HOST };
