import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const verify = fileURLToPath(new URL('./verify.mjs', import.meta.url));
async function fixture(t, { kit = true, report = '{ok:true}', tscExit = 0 } = {}) {
  const app = await mkdtemp(join(tmpdir(), 'contour-verify-test-'));
  t.after(() => rm(app, { recursive: true, force: true }));
  await mkdir(join(app, 'bin'));
  await writeFile(join(app, 'bin/pnpm'), `#!/usr/bin/env node\nprocess.exit(${tscExit});\n`, { mode: 0o755 });
  await writeFile(join(app, 'package.json'), '{"type":"module"}');
  await writeFile(join(app, 'contour.config.json'), '{"contourModule":"contour.mjs"}');
  await writeFile(join(app, 'contour.mjs'), 'export const manifest = {}; export const policy = {}; export const readers = new Map(); export const componentIds = new Set();');
  if (kit) {
    const sdk = join(app, 'node_modules/@contour/sdk');
    await mkdir(sdk, { recursive: true });
    await writeFile(join(sdk, 'package.json'), '{"type":"module","exports":{"./testing":"./testing.mjs"}}');
    await writeFile(join(sdk, 'testing.mjs'), `export function runContractKit({manifest,policy,readers,componentIds}) { if (!manifest || !policy || !(readers instanceof Map) || !(componentIds instanceof Set)) throw Error('bad exports'); return ${report}; }`);
  }
  return {
    app,
    run: (args = []) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [verify, app, ...args], { env: { ...process.env, PATH: `${join(app, 'bin')}:${process.env.PATH}` } });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, output }));
    }),
  };
}

test('loads app registration and passes the exact four contract arguments', async (t) => {
  const { run } = await fixture(t);
  const result = await run();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /contract kit.*PASS/);
  assert.match(result.output, /HTTP smoke.*SKIP/);
});

test('fails on a typecheck error or failing contract report', async (t) => {
  const typeError = await fixture(t, { tscExit: 1 });
  assert.equal((await typeError.run()).code, 1);
  const contractError = await fixture(t, { report: '{ok:false}' });
  assert.equal((await contractError.run()).code, 1);
});

test('reports unavailable testing export with exit 2', async (t) => {
  const { run } = await fixture(t, { kit: false });
  const result = await run();
  assert.equal(result.code, 2);
  assert.match(result.output, /contract kit unavailable/);
  assert.match(result.output, /typecheck.*PASS/);
});

test('fails closed on an unknown contract report and missing registration export', async (t) => {
  const unknown = await fixture(t, { report: '{}' });
  assert.equal((await unknown.run()).code, 1);
  const missing = await fixture(t);
  await writeFile(join(missing.app, 'contour.mjs'), 'export const manifest = {};');
  assert.equal((await missing.run()).code, 1);
});

test('checks all three HTTP smoke routes and rejects missing challenge', async (t) => {
  const { run } = await fixture(t);
  let challenge = true;
  const visited = [];
  const server = createServer((req, res) => {
    visited.push([req.method, req.url, req.headers.authorization]);
    if (req.url === '/.well-known/oauth-protected-resource/api/mcp') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ resource: `http://localhost:${server.address().port}/api/mcp` }));
    } else if (req.url === '/api/mcp') {
      res.writeHead(401, challenge ? { 'WWW-Authenticate': 'Bearer resource_metadata="http://localhost/metadata"' } : {});
      res.end();
    } else if (req.url === '/.well-known/contour-project.json') {
      res.writeHead(200); res.end('{}');
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://localhost:${server.address().port}`;
  assert.equal((await run(['--base-url', baseUrl])).code, 0);
  assert.deepEqual(visited.map((entry) => entry.slice(0, 2)), [
    ['GET', '/.well-known/oauth-protected-resource/api/mcp'],
    ['POST', '/api/mcp'], ['GET', '/.well-known/contour-project.json'],
  ]);
  assert.ok(visited.every((entry) => entry[2] === undefined));
  challenge = false;
  const failure = await run(['--base-url', baseUrl]);
  assert.equal(failure.code, 1);
  assert.match(failure.output, /WWW-Authenticate lacks resource_metadata/);
});
