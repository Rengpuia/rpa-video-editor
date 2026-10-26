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
const { BASE_DIR, PROJECTS_DIR, EXPORTS_DIR, projectPath, idFromTitle } = require('./paths');
const ROOT_DIR = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT_DIR, 'client');

// Request size limits (bytes)
const MAX_MCP_BODY = 5 * 1024 * 1024;
const MAX_PROJECT_BODY = 100 * 1024 * 1024;

// Project file extensions the save API will write
const ALLOWED_PROJECT_EXTENSIONS = new Set(['rpavideo', 'json']);

// Content-Security-Policy for the studio UI. Inline scripts/styles are still used by
// index.html, so 'unsafe-inline' is required; everything else is locked to this origin
// (plus Google Fonts, which index.html loads).
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob: mediastream:",
    "connect-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
].join('; ');

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
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
}

/**
 * Only the studio UI itself (and non-browser local clients, which send no Origin header)
 * may talk to this server. This blocks cross-site requests from web pages and DNS rebinding.
 */
function isTrustedRequest(req) {
    const port = server.listening && server.address() ? server.address().port : PORT;
    const allowedHosts = new Set([`${HOST}:${port}`, `localhost:${port}`]);
    if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) return false;

    const origin = req.headers.origin;
    if (origin !== undefined && !allowedHosts.has(String(origin).replace(/^https?:\/\//i, '').toLowerCase())) return false;
    if (origin !== undefined && !/^http:\/\//i.test(origin)) return false;

    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    return true;
}

function readBody(req, res, maxBytes, onBody) {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', chunk => {
        if (tooLarge) return;
        size += chunk.length;
        if (size > maxBytes) {
            tooLarge = true;
            chunks.length = 0;
            sendJson(res, 413, { error: 'Request body too large.' });
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        if (!tooLarge) onBody(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {});
}

function isDirectory(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch { return null; }
}

function handleApiRequest(req, res, url) {
    // Model Context Protocol (MCP) JSON-RPC 2.0 Endpoint
    if (req.method === 'POST' && url.pathname === '/api/mcp') {
        readBody(req, res, MAX_MCP_BODY, (body) => {
            try {
                const mcpReq = JSON.parse(body);
                if (!mcpReq || typeof mcpReq !== 'object' || Array.isArray(mcpReq)) throw new Error('not an object');
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
        if (!fs.existsSync(PROJECTS_DIR)) return sendJson(res, 200, { projects: [] });
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
        readBody(req, res, MAX_PROJECT_BODY, (body) => {
            try {
                const project = JSON.parse(body);
                if (!project || typeof project !== 'object' || Array.isArray(project)) {
                    throw new Error('Project must be a JSON object.');
                }

                // The caller may pick a destination folder, but never the file name or path.
                const requestedDir = typeof project.targetDirectory === 'string' ? project.targetDirectory.trim() : '';
                const targetDir = (requestedDir && path.isAbsolute(requestedDir) && isDirectory(requestedDir))
                    ? requestedDir
                    : PROJECTS_DIR;
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                const id = idFromTitle(project.title, `project_${Date.now()}`);
                const requestedExt = typeof project.extension === 'string' ? project.extension.toLowerCase() : 'rpavideo';
                const ext = ALLOWED_PROJECT_EXTENSIONS.has(requestedExt) ? requestedExt : 'rpavideo';
                const filePath = path.join(targetDir, `${id}.${ext}`);
                fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');
                return sendJson(res, 200, { success: true, id, path: filePath });
            } catch (err) {
                console.error('[Server Save Error]', err);
                return sendJson(res, 400, { error: `Failed to save project: ${err.message}` });
            }
        });
        return;
    }

    // 4. Load Project
    if (req.method === 'GET' && url.pathname.startsWith('/api/projects/')) {
        const id = safeDecode(url.pathname.slice('/api/projects/'.length));
        let filePath;
        try { filePath = projectPath(id); } catch { return sendJson(res, 400, { error: 'Invalid project id.' }); }
        if (!fs.existsSync(filePath)) {
            return sendJson(res, 404, { error: 'Project not found.' });
        }
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return sendJson(res, 200, data);
        } catch (err) {
            console.error('[Server Load Error]', err);
            return sendJson(res, 500, { error: 'Project file is corrupt or unreadable.' });
        }
    }

    // 5. Delete Project
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/projects/')) {
        const id = safeDecode(url.pathname.slice('/api/projects/'.length));
        let filePath;
        try { filePath = projectPath(id); } catch { return sendJson(res, 400, { error: 'Invalid project id.' }); }
        if (!fs.existsSync(filePath)) {
            return sendJson(res, 404, { error: 'Project not found.' });
        }
        try {
            fs.unlinkSync(filePath);
            return sendJson(res, 200, { success: true, id });
        } catch (err) {
            return sendJson(res, 500, { error: `Failed to delete project: ${err.message}` });
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
    // Reject cross-site and DNS-rebinding requests before doing anything else
    if (!isTrustedRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    // Same-origin / local-client responses only; never a wildcard CORS policy
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.headers.origin) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    let url;
    try {
        url = new URL(req.url, `http://${HOST}:${PORT}`);
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad request');
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        try {
            return handleApiRequest(req, res, url);
        } catch (err) {
            console.error('[Server API Error]', err);
            if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error.' });
            return;
        }
    }

    // Serve Static Client Assets (must stay inside CLIENT_DIR)
    const decoded = safeDecode(url.pathname);
    if (decoded === null || decoded.includes('\0')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad request');
        return;
    }
    const relPath = (decoded === '/' || decoded === '\\') ? '/index.html' : decoded;
    const filePath = path.resolve(CLIENT_DIR, '.' + relPath);

    if (filePath !== CLIENT_DIR && !filePath.startsWith(CLIENT_DIR + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const headers = { 'Content-Type': contentType };
        if (ext === '.html') {
            headers['Content-Security-Policy'] = CSP;
            headers['X-Frame-Options'] = 'DENY';
        }
        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
    }
});

/** True if the program already listening on host:port is an RPA Video Editor server. */
function isRpaServerRunning(host, port) {
    return new Promise((resolve) => {
        const req = http.get({ host, port, path: '/api/system/status', timeout: 1500 }, (res) => {
            let data = '';
            res.on('data', (c) => { if (data.length < 65536) data += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(data).app === 'RPA Video Editor'); } catch { resolve(false); }
            });
        });
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.on('error', () => resolve(false));
    });
}

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

        server.on('error', async (err) => {
            if (err.code === 'EADDRINUSE') {
                // Only reuse the port if the program on it really is another RPA Video Editor.
                if (await isRpaServerRunning(host, port)) {
                    console.log(`[RPA Server] Port ${port} is already served by another RPA Video Editor instance. Reusing it.`);
                    resolve(server);
                } else {
                    reject(new Error(`Port ${port} is already in use by another program. Close it or set the PORT environment variable to a free port.`));
                }
            } else {
                reject(err);
            }
        });
    });
}

if (require.main === module) {
    start().catch((err) => {
        console.error('[RPA Server] ' + err.message);
        process.exit(1);
    });
}

module.exports = { server, start, PORT, HOST };
