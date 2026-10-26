/**
 * Security regression tests for the local server and MCP handler.
 * Run with: node test_security.js
 */
const http = require('http');
const assert = require('assert');

process.env.PORT = process.env.PORT || '3921';
process.env.OFFLINE_DESKTOP = '1';

const { projectPath, isValidProjectId, idFromTitle } = require('./server/paths');
const { handleMcpRequest } = require('./server/mcp_handler');
const { start, server, PORT, HOST } = require('./server/server');

function request(opts, body) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: HOST, port: PORT, ...opts }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

(async () => {
    console.log('[SEC 1] Project ID validation...');
    for (const bad of ['../x', '..\\x', 'a/b', 'a\\b', '/etc/passwd', 'C:\\x', '.hidden', '', 'a..b', null, undefined, 42, 'x'.repeat(200)]) {
        assert.strictEqual(isValidProjectId(bad), false, `should reject ${JSON.stringify(bad)}`);
        assert.throws(() => projectPath(bad), /Invalid project id/);
    }
    for (const good of ['demo_automation', 'untitled', 'My-Project_2', 'v1.2']) {
        assert.ok(projectPath(good).endsWith(`${good}.rpavideo`));
    }
    assert.strictEqual(idFromTitle('../../Evil Name!'), 'evil_name');
    assert.strictEqual(idFromTitle('---'), 'untitled');
    console.log('✓ Unsafe project IDs are rejected; titles map to safe IDs.');

    console.log('\n[SEC 2] MCP rejects path traversal and keeps the JSON-RPC id...');
    await new Promise((resolve) => handleMcpRequest(
        { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'get_project', arguments: { projectId: '../../etc/passwd' } } },
        (res) => { assert.strictEqual(res.id, 11); assert.ok(res.error); resolve(); }
    ));
    console.log('✓ Traversal attempt returns an error with the original request id.');

    await start(PORT, HOST);

    console.log('\n[SEC 3] Cross-site and DNS-rebinding requests are refused...');
    const evilOrigin = await request({ path: '/api/system/status', headers: { Origin: 'https://evil.example' } });
    assert.strictEqual(evilOrigin.status, 403);
    const evilPost = await request({ path: '/api/projects/save', method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' } }, '{"title":"x"}');
    assert.strictEqual(evilPost.status, 403);
    const rebinding = await request({ path: '/api/system/status', headers: { Host: 'evil.example' } });
    assert.strictEqual(rebinding.status, 403);
    console.log('✓ Foreign Origin and Host headers get 403.');

    console.log('\n[SEC 4] Legitimate local access still works, without wildcard CORS...');
    const ok = await request({ path: '/api/system/status' });
    assert.strictEqual(ok.status, 200);
    assert.notStrictEqual(ok.headers['access-control-allow-origin'], '*');
    const ui = await request({ path: '/', headers: { Origin: `http://${HOST}:${PORT}` } });
    assert.strictEqual(ui.status, 200);
    assert.ok(ui.headers['content-security-policy'], 'UI should be served with a CSP');
    console.log('✓ Same-origin and local clients work; CSP is set on the UI.');

    console.log('\n[SEC 5] Path traversal on routes and static files is blocked...');
    assert.strictEqual((await request({ path: '/api/projects/..%2F..%2Fpackage' })).status, 400);
    assert.strictEqual((await request({ path: '/api/projects/..%2F..%2Fpackage', method: 'DELETE' })).status, 400);
    const staticTraversal = await request({ path: '/%2e%2e/package.json' });
    assert.ok([403, 404].includes(staticTraversal.status) && !staticTraversal.body.includes('rpa-video-editor'));
    console.log('✓ Encoded traversal is refused for projects and static files.');

    console.log('\n--- ALL SECURITY TESTS PASSED ---');
    server.close();
    process.exit(0);
})().catch((err) => {
    console.error('✗ SECURITY TEST FAILED:', err.message);
    try { server.close(); } catch (e) {}
    process.exit(1);
});
