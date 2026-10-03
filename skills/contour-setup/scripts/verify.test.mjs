import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeArgs, runEnvironment, checkpointChecks, redact } from '../../../apps/northwind-eval/run-skill.ts';

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

test('eval CLI restricts tools, blocks remote tools, and loads only an empty MCP config', () => {
  const args = claudeArgs();
  assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools')), [
    'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Bash(node:*)', 'Bash(pnpm:*)',
    'Bash(npx tsc:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(ls:*)', 'Bash(cat:*)',
  ]);
  assert.deepEqual(args.slice(args.indexOf('--disallowedTools') + 1, args.indexOf('--strict-mcp-config')), [
    'Bash(vercel:*)', 'Bash(git push:*)', 'Bash(npm publish:*)', 'Bash(pnpm publish:*)',
    'Bash(supabase:*)', 'mcp__vercel__*', 'mcp__supabase__*',
  ]);
  assert.ok(args.includes('--strict-mcp-config'));
  assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config') + 1]), { mcpServers: {} });
});

test('eval environment preserves only named run/auth values and drops remote credentials and overrides', () => {
  const allowed = {
    PATH: '/bin', HOME: '/home/dana', ANTHROPIC_API_KEY: 'auth', ANTHROPIC_AUTH_TOKEN: 'auth-token',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth', CONTOUR_CLOUD_URL: 'https://cloud.example',
    CONTOUR_PROJECT_TOKEN: 'project', CONTOUR_CSRF_SECRET: 'csrf',
    JEV_MODEL: 'typesafe-ai/jev', JEV_TIMEOUT_MS: '4000', JEV_CONFIDENCE_FLOOR: '0.70',
  };
  const source = { ...allowed, VERCEL_TOKEN: 'remote', GH_TOKEN: 'remote', NPM_TOKEN: 'remote',
    STRIPE_SECRET_KEY: 'remote', SUPABASE_SECRET_KEY: 'remote', CONTOUR_UNKNOWN: 'remote',
    JEV_UNKNOWN: 'remote', NODE_OPTIONS: '--require unsafe.js', ANTHROPIC_BASE_URL: 'https://untrusted.example' };
  assert.deepEqual(runEnvironment(source), allowed);
  assert.deepEqual(runEnvironment({ PATH: '/bin' }), { PATH: '/bin' });
  assert.equal(source.VERCEL_TOKEN, 'remote');
});

test('post-hoc detector rejects forbidden MCP names and shell commands', () => {
  const check = (name, input = {}) => checkpointChecks([
    { type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } },
  ], '/tmp/app').find((row) => row.name === 'No deployment');
  for (const name of ['mcp__vercel__deploy', 'mcp__supabase__execute_sql']) assert.equal(check(name).passed, false);
  for (const command of ['vercel env pull', 'pnpm exec supabase db push', 'git push origin branch', 'npm publish', 'pnpm publish']) {
    assert.equal(check('Bash', { command }).passed, false, command);
  }
  assert.equal(check('Read', { file_path: '/tmp/app/package.json' }).passed, true);
  assert.equal(check('Bash', { command: 'pnpm exec tsc --noEmit' }).passed, true);
});

test('redaction retains numeric usage while removing credentials and textual token fields', () => {
  const usage = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40, total_tokens: 120 };
  assert.deepEqual(redact({ usage, access_token: 'credential', api_key: 'credential', output_tokens: 'credential', secret: 123 }), {
    usage, access_token: '[REDACTED]', api_key: '[REDACTED]', output_tokens: '[REDACTED]', secret: '[REDACTED]',
  });
});

async function samples(reference, count) {
  const content = await readFile(new URL(`../references/${reference}`, import.meta.url), 'utf8');
  return [...content.matchAll(/```ts\n([\s\S]*?)```/g)].slice(0, count).map((match) =>
    stripTypeScriptTypes(match[1].replace(/^import .*;\n/gm, '').replace(/^export /gm, '')));
}

test('wiring samples defer required env and database access, and selector reads live getters', async () => {
  const [server, selector] = await samples('wiring-guide.md', 2);
  const env = {};
  let dbCalls = 0;
  const config = runInNewContext(`${server}\ncontour;`, {
    process: { env }, URL, defineContourServer: (config) => config,
    getAppDb: () => { dbCalls++; return 'db'; }, identity: {}, agentAccessEnabled: () => true,
  });
  assert.equal(dbCalls, 0);
  assert.throws(() => config.appUrl, /Missing required environment variable APP_URL/);
  assert.throws(() => config.csrfSecret, /CONTOUR_CSRF_SECRET/);
  assert.equal(config.trustedClients.length, 0);
  Object.assign(env, { APP_URL: 'https://app.example/path', CONTOUR_CSRF_SECRET: 'csrf', CONTOUR_CLOUD_URL: 'https://cloud.example/path' });
  assert.equal(config.appUrl, 'https://app.example');
  assert.equal(config.csrfSecret, 'csrf');
  assert.equal(config.trustedClients[0], 'https://cloud.example/oauth/client.json');
  assert.equal(config.db, 'db');
  assert.equal(dbCalls, 1);
  const getters = runInNewContext(`${selector}\nselector;`, { process: { env }, createJevSelector: (config) => config });
  assert.equal(getters.apiKey(), '');
  assert.equal(getters.model(), 'typesafe-ai/jev');
  assert.equal(getters.timeoutMs(), 4000);
  Object.assign(env, { AI_GATEWAY_API_KEY: 'key', JEV_MODEL: 'model', JEV_TIMEOUT_MS: '8000' });
  assert.equal(getters.apiKey(), 'key');
  assert.equal(getters.model(), 'model');
  assert.equal(getters.timeoutMs(), 8000);
});

test('identity samples distinguish signed out from signed in without active membership', async () => {
  const [, supabase, northwind] = await samples('identity-guide.md');
  class ContourError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const query = { select() { return this; }, eq() { return this; }, maybeSingle() { return { data: null, error: null }; }, data: [], error: null };
  let signedIn = false;
  const supabaseUser = runInNewContext(`${supabase}\ncurrentUser;`, {
    ContourError, cookies: async () => ({ get: () => undefined }),
    userClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'dana' } : null } }) } }),
    adminClient: () => ({ from: () => query }),
  });
  const northwindUser = runInNewContext(`${northwind}\ncurrentUser;`, {
    ContourError, cookies: async () => ({ get: () => ({ value: 'verified-cookie' }) }),
    getSession: async () => signedIn ? { userId: 'dana' } : null,
    getDb: () => ({ from: () => query }),
  });
  assert.equal(await supabaseUser(), null);
  assert.equal(await northwindUser(), null);
  signedIn = true;
  await assert.rejects(supabaseUser(), { code: 'FORBIDDEN' });
  await assert.rejects(northwindUser(), { code: 'FORBIDDEN' });
});
