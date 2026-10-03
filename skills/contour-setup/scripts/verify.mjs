#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const self = fileURLToPath(import.meta.url);
const resultMarker = 'CONTOUR_CONTRACT_RESULT:';

// Run imports in a separate Node process so TS loaders and react-server apply
// before SDK/host modules are loaded. Resolve both packages from the host app.
async function contractWorker(appDir, moduleFile, kitFile) {
  const { runContractKit } = await import(pathToFileURL(kitFile).href);
  if (typeof runContractKit !== 'function') throw new Error('runContractKit export is missing');
  const registration = await import(pathToFileURL(moduleFile).href);
  for (const name of ['manifest', 'policy', 'readers', 'componentIds']) {
    if (registration[name] === undefined) throw new Error(`Registration export missing: ${name}`);
  }
  const { manifest, policy, readers, componentIds } = registration;
  const report = await runContractKit({ manifest, policy, readers, componentIds });
  // The later SDK task owns the kit. Do not turn an unknown report into a pass.
  let passed;
  if (typeof report?.ok === 'boolean') passed = report.ok;
  else if (typeof report?.passed === 'boolean') passed = report.passed;
  else if (Number.isInteger(report?.failed) && Number.isInteger(report?.passed)) {
    passed = report.failed === 0 && report.passed > 0;
  } else throw new Error('Unknown contract report: expected ok/passed boolean or passed/failed counts');
  process.stdout.write(`${resultMarker}${JSON.stringify({ passed })}\n`);
  if (!passed) process.exitCode = 1;
}

function run(command, args, cwd, options = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, env: process.env, ...options });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.stderr?.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => done({ code: 1, output: error.message }));
    child.on('close', (code) => done({ code: code ?? 1, output }));
  });
}

async function smoke(baseUrl, add) {
  const origin = new URL(baseUrl).origin;
  const request = async (path, options) => fetch(`${origin}${path}`, {
    redirect: 'manual', signal: AbortSignal.timeout(10_000), ...options,
  });
  const checks = [
    ['resource metadata', async () => {
      const response = await request('/.well-known/oauth-protected-resource/api/mcp');
      if (response.status !== 200) throw new Error(`HTTP ${response.status}, expected 200`);
      const body = await response.json();
      if (body.resource !== `${origin}/api/mcp`) throw new Error('resource does not match app origin /api/mcp');
    }],
    ['unauthenticated MCP', async () => {
      const response = await request('/api/mcp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      if (response.status !== 401) throw new Error(`HTTP ${response.status}, expected 401`);
      if (!response.headers.get('www-authenticate')?.includes('resource_metadata')) {
        throw new Error('WWW-Authenticate lacks resource_metadata');
      }
    }],
    ['project document', async () => {
      const response = await request('/.well-known/contour-project.json');
      if (response.status !== 200) throw new Error(`HTTP ${response.status}, expected 200`);
    }],
  ];
  for (const [name, check] of checks) {
    try { await check(); add(name, 'PASS', ''); }
    catch (error) { add(name, 'FAIL', error.message); }
  }
}

async function main(args) {
  if (!args[0] || args[0].startsWith('--') ||
      !(args.length === 1 || (args.length === 3 && args[1] === '--base-url'))) {
    console.error('Usage: node verify.mjs <appDir> [--base-url http://localhost:3200]');
    return 1;
  }
  const appDir = await realpath(resolve(args[0]));
  const rows = [];
  const add = (check, status, details) => rows.push({ check, status, details });
  const typecheck = await run('pnpm', ['exec', 'tsc', '--noEmit'], appDir);
  add('typecheck', typecheck.code === 0 ? 'PASS' : 'FAIL', typecheck.code === 0 ? '' : `tsc exited ${typecheck.code}; run pnpm exec tsc --noEmit in the app for diagnostics`);

  let unavailable = false;
  const appRequire = createRequire(resolve(appDir, 'package.json'));
  let kitFile;
  try { kitFile = appRequire.resolve('@contour/sdk/testing'); }
  catch (error) {
    if (['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      unavailable = true;
      add('contract kit', 'UNAVAILABLE', 'contract kit unavailable');
    } else add('contract kit', 'FAIL', 'Cannot resolve @contour/sdk/testing');
  }
  if (kitFile) {
    try {
      const config = JSON.parse(await readFile(resolve(appDir, 'contour.config.json'), 'utf8'));
      if (typeof config.contourModule !== 'string' || isAbsolute(config.contourModule)) {
        throw new Error('contourModule must be an app-relative module path');
      }
      const moduleFile = await realpath(resolve(appDir, config.contourModule));
      const moduleRelative = relative(appDir, moduleFile);
      if (moduleRelative === '..' || moduleRelative.startsWith('../')) throw new Error('contourModule escapes appDir');
      const nodeArgs = ['--conditions=react-server'];
      // tsx handles TSX, workspace TS exports, and the app's tsconfig aliases.
      try { nodeArgs.push('--import', pathToFileURL(appRequire.resolve('tsx')).href); }
      catch {
        if (['.ts', '.tsx', '.mts', '.cts'].includes(extname(moduleFile)) || extname(kitFile) === '.ts') {
          throw new Error('Install tsx in the app to load its TypeScript contourModule and SDK');
        }
      }
      nodeArgs.push(self, '--contract-worker', appDir, moduleFile, kitFile);
      const result = await run(process.execPath, nodeArgs, appDir);
      const line = result.output.split('\n').find((value) => value.startsWith(resultMarker));
      const report = line ? JSON.parse(line.slice(resultMarker.length)) : null;
      const passed = result.code === 0 && report?.passed === true;
      add('contract kit', passed ? 'PASS' : 'FAIL', passed ? '' : 'Contract import or assertions failed; check registration exports, SDK report shape, and installed loader');
    } catch (error) { add('contract kit', 'FAIL', error.message); }
  }
  if (args[2]) await smoke(args[2], add);
  else add('HTTP smoke', 'SKIP', 'No --base-url supplied');
  // Do not echo subprocess logs: registration imports can contain credentials.
  console.table(rows);
  return unavailable ? 2 : rows.some((row) => row.status === 'FAIL') ? 1 : 0;
}

try {
  if (process.argv[2] === '--contract-worker') {
    await contractWorker(...process.argv.slice(3));
  } else process.exitCode = await main(process.argv.slice(2));
} catch {
  // Errors from imported host modules may include environment values.
  console.error('Verification failed: check the app configuration, registration module, and SDK imports.');
  process.exitCode = 1;
}
