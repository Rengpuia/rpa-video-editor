#!/usr/bin/env node
/**
 * RPA Video Editor - Model Context Protocol (MCP) Stdio Server
 *
 * Enables AI Assistants (Claude Desktop, Antigravity, Cursor, Windsurf) to inspect,
 * edit, generate, and export video projects via standard MCP JSON-RPC protocol over stdio.
 *
 * Developer: K Vanlalrengpuia (rengakhiangte@gmail.com)
 * License: Open Source (MIT License)
 */

const readline = require('readline');
const { handleMcpRequest } = require('./server/mcp_handler');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
        const req = JSON.parse(trimmed);
        handleMcpRequest(req, (res) => {
            if (res) {
                process.stdout.write(JSON.stringify(res) + '\n');
            }
        });
    } catch (err) {
        const errResponse = {
            jsonrpc: '2.0',
            id: null,
            error: {
                code: -32700,
                message: `Parse error: ${err.message}`
            }
        };
        process.stdout.write(JSON.stringify(errResponse) + '\n');
    }
});

process.stderr.write('RPA Video Editor MCP Server v2.0.0 running on stdio.\n');
