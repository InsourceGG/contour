import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { discover } from './discover.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const northwind = path.resolve(scriptDirectory, '../../../apps/northwind');
const expectedVariants = {
  SlaAlerts: { variant: ['banner', 'expanded'] },
  TicketQueue: { density: ['comfortable', 'compact'], variant: ['list', 'cards'] },
  CsatTrend: { range: ['7d', '30d'], presentation: ['chart', 'summary'] },
  WorkloadPanel: { density: ['comfortable', 'compact'] },
  KnowledgeBase: { mode: ['guided', 'collapsed'] },
  CustomerTimeline: { density: ['comfortable', 'compact'] },
};

// Discovery targets an app BEFORE integration, so test against the pristine
// baseline (git tag northwind-baseline); fall back to the working tree.
async function baselineNorthwind() {
  const repo = path.resolve(scriptDirectory, '../../..');
  try {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'nw-baseline-'));
    const tar = execFileSync('git', ['-C', repo, 'archive', 'northwind-baseline', 'apps/northwind']);
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
    return path.join(dir, 'apps/northwind');
  } catch {
    return northwind;
  }
}

test('Northwind: resolves all six desk components through the barrel and preserves literal variants', async () => {
  const result = await discover(await baselineNorthwind());
  assert.equal(result.framework.nextVersion, '16.3.8');
  assert.equal(result.framework.appRouter, true);
  const screen = result.candidateScreens.find(page => page.route === '/desk');
  assert.ok(screen, '/desk must be a candidate screen');
  assert.equal(screen.file, 'src/app/(workspace)/desk/page.tsx');
  assert.deepEqual([...screen.components].sort(), Object.keys(expectedVariants).sort());
  assert.equal(result.components.length, 6);
  for (const [name, variants] of Object.entries(expectedVariants)) {
    const component = result.components.find(item => item.name === name);
    assert.equal(component?.file, `src/components/desk/${name}.tsx`);
    assert.deepEqual(component.variantProps, variants);
    assert.ok(component.props.some(prop => prop.name === 'loading'), 'inherited data-state props must be discovered');
  }
  const csat = result.components.find(component => component.name === 'CsatTrend');
  assert.equal(csat.props.find(prop => prop.name === 'periodHrefs').type, 'Record<"7d" | "30d", string>');
  assert.equal(csat.variantProps.periodHrefs, undefined, 'a union nested in Record is not a closed prop enum');
});

test('Northwind: finds all six session-first reader candidates with complete nested parameter text', async () => {
  const result = await discover(northwind);
  for (const name of ['getTickets', 'getSlaBreaches', 'getCsatTrend', 'getWorkload', 'getKbArticles', 'getCustomerTimeline']) {
    const reader = result.dataFunctions.find(item => item.name === name);
    assert.ok(reader, `${name} must be discovered`);
    assert.equal(reader.firstParamType, 'Session');
    assert.equal(reader.sessionFirst, true);
    assert.match(reader.parameters, /^session: Session/);
  }
  assert.equal(result.dataFunctions.find(item => item.name === 'getTickets').parameters, 'session: Session, options: { filter?: TicketStatus | "all" | "mine"; limit?: number } = {}');
  assert.equal(result.dataFunctions.find(item => item.name === 'getCsatTrend').parameters, 'session: Session, options: { range: "7d" | "30d" }');
  assert.equal(result.dataFunctions.find(item => item.name === 'authenticate').sessionFirst, false);
});

test('Northwind: reports its signed session cookie and fixed chrome without confusing Supabase DB with Auth', async () => {
  const result = await discover(northwind);
  assert.ok(result.auth.sessionFiles.includes('src/lib/session.ts'));
  assert.deepEqual(result.auth.cookieNames, ['nw_session']);
  assert.equal(result.auth.supabase.client, true);
  assert.equal(result.auth.supabase.auth, false);
  assert.ok(result.pages.some(page => page.route === '/tickets/[id]'));
  for (const kind of ['nav', 'account', 'admin']) assert.ok(result.fixedChrome.some(item => item.kind === kind), `${kind} chrome must be suggested`);
});

test('CLI prints the same valid JSON as the API', async () => {
  const output = execFileSync(process.execPath, [path.join(scriptDirectory, 'discover.mjs'), northwind], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output), await discover(northwind));
});

test('lightweight parsing handles aliases, default exports, async arrows, inline props, and comment delimiters', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contour-discover-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sources = {
    'package.json': JSON.stringify({ dependencies: { next: '^16.3.8' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '#/*': ['./src/*'] } } }),
    'src/data/read.ts': `// export async function ghost(session: Session) {}
/* export async function anotherGhost(session: Session) {} */
const text = "export";
export const fetchRows = async (session: Readonly<Session>, options: { pairs: Record<string, [string, number]>; limit?: number } = { pairs: {} }): Promise<string[]> => [];
export async function fetchOpen(/* a comment with ), { */ session: Session, mode: 'open' | 'closed' = 'open') { return []; }
`,
    'src/components/base.ts': 'export interface BaseProps { loading?: boolean; }',
    'src/components/First.tsx': `import type { BaseProps } from './base';
type FirstProps = {
mode?: 'small' | 'large'
data: Record<'a' | 'b', string>
};
export function First({ mode }: FirstProps) { return <section />; }`,
    'src/components/Second.tsx': `import type { BaseProps } from './base';
interface SecondProps extends BaseProps { density: 'compact' | 'comfortable'; }
export default function Second(props: SecondProps) { return <section />; }`,
    'src/components/Third.tsx': `export const Third = ({ view }: { view?: 'summary' | 'details'; active: true | false; }) => <section />;`,
    'src/components/index.ts': `export { First as PanelOne } from './First';`,
    'src/app/(team)/home/page.tsx': `import { PanelOne as One } from '#/components';
import Two from '#/components/Second';
import { Third } from '#/components/Third';
export default function Home() { return <><One /><Two /><Third /></>; }`,
    'src/lib/session.ts': `const SESSION_COOKIE = 'signed_session';
export async function getSession() { const jar = await cookies(); return jar.get(SESSION_COOKIE); }`,
    'node_modules/dependency/src/data/bad.ts': 'export async function dependencyReader(session: Session) {}',
  };
  for (const [file, source] of Object.entries(sources)) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  const result = await discover(root);
  assert.deepEqual(result.dataFunctions.map(item => item.name).sort(), ['fetchOpen', 'fetchRows', 'getSession']);
  const fetchRows = result.dataFunctions.find(item => item.name === 'fetchRows');
  assert.equal(fetchRows.firstParamType, 'Readonly<Session>');
  assert.equal(fetchRows.sessionFirst, true);
  assert.equal(fetchRows.parameters, 'session: Readonly<Session>, options: { pairs: Record<string, [string, number]>; limit?: number } = { pairs: {} }');
  assert.deepEqual(result.auth.cookieNames, ['signed_session']);
  assert.equal(result.candidateScreens[0].route, '/home');
  assert.deepEqual(Object.fromEntries(result.components.map(component => [component.name, component.variantProps])), {
    First: { mode: ['small', 'large'] },
    Second: { density: ['compact', 'comfortable'] },
    Third: { view: ['summary', 'details'], active: [true, false] },
  });
});
