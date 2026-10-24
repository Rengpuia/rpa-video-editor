/**
 * Model Context Protocol (MCP) Core Handler
 * Cleanroom implementation of JSON-RPC 2.0 MCP specification
 * Supports both stdio transport (Claude Desktop / Antigravity / Cursor) and HTTP transport (/api/mcp)
 *
 * Developer: K Vanlalrengpuia (rengakhiangte@gmail.com)
 * License: Open Source (MIT)
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PROJECTS_DIR = path.join(ROOT_DIR, 'projects');
const EXPORTS_DIR = path.join(ROOT_DIR, 'exports');

if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });
if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

const MCP_TOOLS = [
    {
        name: 'list_projects',
        description: 'Lists all available RPA Video Editor project files (.rpavideo) with their titles, durations, and last modified timestamps.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_project',
        description: 'Reads and returns the complete project structure including tracks, clips, settings, captions, and markers.',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'The project ID or filename (without .rpavideo).' }
            },
            required: ['projectId']
        }
    },
    {
        name: 'create_project',
        description: 'Creates a new RPA Video Editor project with customized settings and saves it to disk.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Human-readable title of the project.' },
                resolution: { type: 'string', description: 'Preset (1920x1080, 3840x2160, 1080x1920, 2560x1440, etc.) or "custom".', default: '1920x1080' },
                width: { type: 'number', description: 'Canvas width in pixels (required if resolution is custom).', default: 1920 },
                height: { type: 'number', description: 'Canvas height in pixels (required if resolution is custom).', default: 1080 },
                fps: { type: 'number', description: 'Timeline framerate (24, 30, 60, 120).', default: 30 }
            },
            required: ['title']
        }
    },
    {
        name: 'save_project',
        description: 'Persists an updated project JSON structure directly to the project storage directory.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'object', description: 'The entire project state object.' }
            },
            required: ['project']
        }
    },
    {
        name: 'add_clip',
        description: 'Adds a new media or callout clip to an existing project timeline.',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'Target project ID.' },
                trackIndex: { type: 'number', description: 'Track index (0-based) to place the clip on.', default: 0 },
                clipType: { type: 'string', enum: ['callout', 'video', 'audio', 'image', 'sfx'], description: 'Type of clip to create.' },
                title: { type: 'string', description: 'Title or displayText for callout.' },
                startTime: { type: 'number', description: 'Start time in seconds on timeline.' },
                duration: { type: 'number', description: 'Duration in seconds.' },
                textAlign: { type: 'string', enum: ['left', 'center', 'right', 'justify'], description: 'Text horizontal alignment.' },
                verticalAlign: { type: 'string', enum: ['top', 'middle', 'bottom'], description: 'Text vertical alignment.' },
                color: { type: 'string', description: 'Primary hex color code (e.g. #38bdf8).' },
                behavior: { type: 'string', enum: ['none', 'pop', 'slide', 'drift', 'pulse', 'jump', 'fade-scale'], description: 'Kinetic motion behavior.' }
            },
            required: ['projectId', 'clipType', 'startTime', 'duration']
        }
    },
    {
        name: 'delete_clip',
        description: 'Removes a clip from a project timeline by clip ID.',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'Target project ID.' },
                clipId: { type: 'string', description: 'Unique ID of the clip to remove.' }
            },
            required: ['projectId', 'clipId']
        }
    },
    {
        name: 'split_clip',
        description: 'Splits an existing clip into two distinct clips at a specified timeline timestamp.',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'Target project ID.' },
                clipId: { type: 'string', description: 'Unique ID of the clip to split.' },
                splitTime: { type: 'number', description: 'Timeline time in seconds where split occurs.' }
            },
            required: ['projectId', 'clipId', 'splitTime']
        }
    },
    {
        name: 'apply_behavior',
        description: 'Configures studio kinetic motion behavior (In, During, Out phases) on a target clip.',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'Target project ID.' },
                clipId: { type: 'string', description: 'Clip ID to apply behavior to.' },
                behavior: { type: 'string', enum: ['pop', 'slide', 'drift', 'pulse', 'jump', 'fade-scale'], description: 'Behavior type.' },
                textUnit: { type: 'string', enum: ['character', 'word', 'all'], default: 'character' },
                loopForever: { type: 'boolean', default: true }
            },
            required: ['projectId', 'clipId', 'behavior']
        }
    },
    {
        name: 'export_video_spec',
        description: 'Validates and returns configuration parameters for rendering an export with custom resolution and framerate.',
        inputSchema: {
            type: 'object',
            properties: {
                width: { type: 'number', description: 'Video width in pixels (even number).' },
                height: { type: 'number', description: 'Video height in pixels (even number).' },
                fps: { type: 'number', enum: [24, 30, 60, 120], default: 30 },
                bitrate: { type: 'number', default: 6000000 },
                format: { type: 'string', enum: ['webm', 'mp4'], default: 'webm' }
            },
            required: ['width', 'height']
        }
    }
];

function handleMcpRequest(reqBody, callback) {
    const { jsonrpc, id, method, params } = reqBody;

    if (jsonrpc !== '2.0') {
        return callback({ jsonrpc: '2.0', id: id || null, error: { code: -32600, message: 'Invalid Request: jsonrpc must be 2.0' } });
    }

    // 1. MCP Initialize
    if (method === 'initialize') {
        return callback({
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: '2024-11-05',
                serverInfo: {
                    name: 'rpa-video-editor-mcp',
                    version: '2.0.0',
                    developer: 'K Vanlalrengpuia',
                    email: 'rengakhiangte@gmail.com',
                    license: 'Open Source (MIT)'
                },
                capabilities: {
                    tools: {},
                    resources: {}
                }
            }
        });
    }

    // 2. MCP Tools List
    if (method === 'tools/list') {
        return callback({
            jsonrpc: '2.0',
            id,
            result: {
                tools: MCP_TOOLS
            }
        });
    }

    // 3. MCP Resources List
    if (method === 'resources/list') {
        try {
            const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.rpavideo'));
            const resources = files.map(filename => ({
                uri: `rpa://project/${path.basename(filename, '.rpavideo')}`,
                name: filename,
                mimeType: 'application/json'
            }));
            return callback({ jsonrpc: '2.0', id, result: { resources } });
        } catch (err) {
            return callback({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
        }
    }

    // 4. MCP Resources Read
    if (method === 'resources/read') {
        const uri = params?.uri || '';
        const match = uri.match(/^rpa:\/\/project\/(.+)$/);
        if (!match) {
            return callback({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid resource URI format' } });
        }
        const projectId = match[1];
        const filePath = path.join(PROJECTS_DIR, `${projectId}.rpavideo`);
        if (!fs.existsSync(filePath)) {
            return callback({ jsonrpc: '2.0', id, error: { code: -32001, message: 'Project not found' } });
        }
        const text = fs.readFileSync(filePath, 'utf8');
        return callback({
            jsonrpc: '2.0',
            id,
            result: {
                contents: [{ uri, mimeType: 'application/json', text }]
            }
        });
    }

    // 5. MCP Tools Call
    if (method === 'tools/call') {
        const toolName = params?.name;
        const args = params?.arguments || {};

        try {
            if (toolName === 'list_projects') {
                const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.rpavideo'));
                const list = files.map(filename => {
                    const full = path.join(PROJECTS_DIR, filename);
                    const stat = fs.statSync(full);
                    try {
                        const data = JSON.parse(fs.readFileSync(full, 'utf8'));
                        return {
                            id: path.basename(filename, '.rpavideo'),
                            filename,
                            title: data.title || filename,
                            duration: data.duration || 0,
                            updatedAt: stat.mtime
                        };
                    } catch {
                        return { id: filename, filename, updatedAt: stat.mtime };
                    }
                });
                return callback({
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] }
                });
            }

            if (toolName === 'get_project') {
                const pId = args.projectId;
                const filePath = path.join(PROJECTS_DIR, `${pId}.rpavideo`);
                if (!fs.existsSync(filePath)) {
                    return callback({ jsonrpc: '2.0', id, error: { code: -32001, message: `Project ${pId} not found.` } });
                }
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                return callback({
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
                });
            }

            if (toolName === 'create_project') {
                const title = args.title || 'Untitled Project';
                const id = title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
                const filePath = path.join(PROJECTS_DIR, `${id}.rpavideo`);

                let w = args.width || 1920;
                let h = args.height || 1080;
                if (args.resolution && args.resolution.includes('x')) {
                    const parts = args.resolution.split('x').map(Number);
                    w = parts[0];
                    h = parts[1];
                }

                const newProj = {
                    version: '2.0.0',
                    title,
                    duration: 10.0,
                    projectSettings: {
                        name: `${w}x${h}`,
                        width: w,
                        height: h,
                        fps: args.fps || 30
                    },
                    tracks: [
                        { id: 'track_1', name: 'Track 1', locked: false, muted: false, clips: [] },
                        { id: 'track_2', name: 'Track 2', locked: false, muted: false, clips: [] }
                    ],
                    captions: [],
                    markers: []
                };

                fs.writeFileSync(filePath, JSON.stringify(newProj, null, 2), 'utf8');
                return callback({
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: JSON.stringify({ success: true, id, path: filePath, project: newProj }, null, 2) }] }
                });
            }

            if (toolName === 'save_project') {
                const proj = args.project;
                const id = (proj.title || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
                const filePath = path.join(PROJECTS_DIR, `${id}.rpavideo`);
                fs.writeFileSync(filePath, JSON.stringify(proj, null, 2), 'utf8');
                return callback({
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: JSON.stringify({ success: true, id, path: filePath }, null, 2) }] }
                });
            }

            if (toolName === 'add_clip') {
                const pId = args.projectId;
                const filePath = path.join(PROJECTS_DIR, `${pId}.rpavideo`);
                if (!fs.existsSync(filePath)) {
                    return callback({ jsonrpc: '2.0', id, error: { code: -32001, message: `Project ${pId} not found.` } });
                }
                const proj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const tIdx = Math.max(0, Math.min(proj.tracks.length - 1, args.trackIndex || 0));
                const newClip = {
                    id: 'clip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                    type: args.clipType,
                    title: args.title || (args.clipType.toUpperCase() + ' Clip'),
                    displayText: args.title || '',
                    startTime: Number(args.startTime),
                    duration: Number(args.duration),
                    textAlign: args.textAlign || 'center',
                    verticalAlign: args.verticalAlign || 'middle',
                    color: args.color || '#38bdf8',
                    behavior: args.behavior || 'none'
                };
                proj.tracks[tIdx].clips.push(newClip);
                fs.writeFileSync(filePath, JSON.stringify(proj, null, 2), 'utf8');

                return callback({
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: JSON.stringify({ success: true, clip: newClip }, null, 2) }] }
                });
            }

            if (toolName === 'delete_clip') {
                const pId = args.projectId;
                const filePath = path.join(PROJECTS_DIR, `${pId}.rpavideo`);
                if (!fs.existsSync(filePath)) {
                    return callback({ jsonrpc: '2.0', id, error: { code: -32001, message: `Project ${pId} not found.` } });
                }
                const proj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                let found = false;
                proj.tracks.forEach(tr => {
                    const idx = tr.clips.findIndex(c => c.id === args.clipId);
                    if (idx !== -1) {
                        tr.clips.splice(idx, 1);
                        found = true;
                    }
                });
                fs.writeFileSync(filePath, JSON.stringify(proj, null, 2), 'utf8');
                return callback({
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: JSON.stringify({ success: found, clipId: args.clipId }, null, 2) }] }
                });
            }

            if (toolName === 'split_clip') {
                const pId = args.projectId;
                const filePath = path.join(PROJECTS_DIR, `${pId}.rpavideo`);
                if (!fs.existsSync(filePath)) {
                    return callback({ jsonrpc: '2.0', id, error: { code: -32001, message: `Project ${pId} not found.` } });
                }
                const proj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                let splitDone = false;
                proj.tracks.forEach(tr => {
                    const c = tr.clips.find(clip => clip.id === args.clipId);
                    if (c && args.splitTime > c.startTime && args.splitTime < (c.startTime + c.duration)) {
                        const originalDuration = c.duration;
                        const firstDuration = args.splitTime - c.startTime;
                        const secondDuration = originalDuration - firstDuration;

                        c.duration = firstDuration;
                        const secondClip = {
                            ...JSON.parse(JSON.stringify(c)),
                            id: 'clip_' + Date.now(),
                            startTime: args.splitTime,
                            duration: secondDuration
                        };
                        tr.clips.push(secondClip);
                        splitDone = true;
                    }
                });
                fs.writeFileSync(filePath, JSON.stringify(proj, null, 2), 'utf8');
                return callback({
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: JSON.stringify({ success: splitDone, clipId: args.clipId, splitTime: args.splitTime }, null, 2) }] }
                });
            }

            if (toolName === 'apply_behavior') {
                const pId = args.projectId;
                const filePath = path.join(PROJECTS_DIR, `${pId}.rpavideo`);
                if (!fs.existsSync(filePath)) {
                    return callback({ jsonrpc: '2.0', id, error: { code: -32001, message: `Project ${pId} not found.` } });
                }
                const proj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                let updated = false;
                proj.tracks.forEach(tr => {
                    const c = tr.clips.find(clip => clip.id === args.clipId);
                    if (c) {
                        c.behavior = args.behavior;
                        c.behaviorProps = c.behaviorProps || {};
                        c.behaviorProps.textUnit = args.textUnit || 'character';
                        c.behaviorProps.loopForever = args.loopForever !== false;
                        updated = true;
                    }
                });
                fs.writeFileSync(filePath, JSON.stringify(proj, null, 2), 'utf8');
                return callback({
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: JSON.stringify({ success: updated, clipId: args.clipId, behavior: args.behavior }, null, 2) }] }
                });
            }

            if (toolName === 'export_video_spec') {
                const w = Math.round(Number(args.width) / 2) * 2;
                const h = Math.round(Number(args.height) / 2) * 2;
                const spec = {
                    width: Math.max(128, Math.min(8192, w)),
                    height: Math.max(128, Math.min(8192, h)),
                    fps: args.fps || 30,
                    bitrate: args.bitrate || 6000000,
                    format: args.format || 'webm',
                    aspectRatio: (w / h).toFixed(4),
                    valid: true
                };
                return callback({
                    jsonrpc: '2.0',
                    id,
                    result: { content: [{ type: 'text', text: JSON.stringify(spec, null, 2) }] }
                });
            }

            return callback({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${toolName}` } });
        } catch (err) {
            return callback({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
        }
    }

    // Default unknown method
    return callback({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

module.exports = {
    handleMcpRequest,
    MCP_TOOLS
};
