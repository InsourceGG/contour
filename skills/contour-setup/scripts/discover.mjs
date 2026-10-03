#!/usr/bin/env node
/** Read-only discovery. These are source hints, not a permission or safety audit. */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const IGNORE = new Set(['node_modules', '.git', '.next', '.turbo', 'dist', 'build', 'coverage']);
const slash = value => value.split(path.sep).join('/');

async function walk(directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORE.has(entry.name) || entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (entry.isFile() && SOURCE.test(entry.name)) files.push(file);
  }
  return files;
}

// Keep source offsets while making comments and quoted delimiters opaque. This
// small lexer intentionally does not evaluate types, functions, or templates.
function tokenize(source) {
  const result = [];
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue; }
    const start = i;
    const quote = source[i];
    if (quote === '"' || quote === "'" || quote === '`') {
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i++] === quote) break;
      }
      const raw = source.slice(start, i);
      result.push({ kind: quote === '`' ? 'template' : 'string', value: raw.slice(1, -1), start, end: i });
      continue;
    }
    const identifier = source.slice(i).match(/^[A-Za-z_$][\w$]*/);
    const number = source.slice(i).match(/^\d+(?:\.\d+)?/);
    if (identifier || number) {
      const value = (identifier || number)[0];
      i += value.length;
      result.push({ kind: identifier ? 'identifier' : 'number', value, start, end: i });
    } else {
      result.push({ kind: 'punctuation', value: source[i++], start, end: i });
    }
  }
  return result;
}

function matching(tokens, start) {
  const pairs = { '(': ')', '{': '}', '[': ']', '<': '>' };
  const close = pairs[tokens[start]?.value];
  if (!close) return -1;
  let depth = 1;
  for (let i = start + 1; i < tokens.length; i++) {
    if (tokens[i].kind !== 'punctuation') continue;
    if (tokens[i].value === tokens[start].value) depth++;
    else if (tokens[i].value === close && --depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(tokens, delimiter) {
  const groups = [];
  let current = [];
  const stack = [];
  const pairs = { '(': ')', '{': '}', '[': ']', '<': '>' };
  for (const token of tokens) {
    if (token.kind === 'punctuation') {
      if (token.value === delimiter && !stack.length) { groups.push(current); current = []; continue; }
      if (pairs[token.value]) stack.push(pairs[token.value]);
      else if (token.value === stack.at(-1)) stack.pop();
    }
    current.push(token);
  }
  if (current.length) groups.push(current);
  return groups;
}

function raw(source, tokens) {
  return tokens.length ? source.slice(tokens[0].start, tokens.at(-1).end).trim() : '';
}

function signature(record, opening) {
  const closing = matching(record.tokens, opening);
  if (closing < 0) return null;
  const args = record.tokens.slice(opening + 1, closing);
  const first = splitTopLevel(args, ',')[0] || [];
  // The colon after a destructuring pattern is the parameter's type annotation.
  let index = 0;
  if (['{', '['].includes(first[0]?.value)) index = matching(first, 0) + 1;
  else index = 1;
  if (first[index]?.value === '?') index++;
  const type = first[index]?.value === ':' ? splitTopLevel(first.slice(index + 1), '=')[0] : [];
  const firstParamType = raw(record.source, type || []);
  return {
    parameters: raw(record.source, args),
    firstParamType: firstParamType || null,
    sessionFirst: /^(?:session|auth|identity|userContext)$/i.test(first[0]?.value || '') || /\b(?:\w*Session|Session\w*|AuthContext|UserContext)\b/.test(firstParamType),
    closing,
  };
}

function declarations(record, onlyAsync = false) {
  const found = [];
  const tokens = record.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'identifier' || tokens[i].value !== 'export') continue;
    let cursor = i + 1;
    if (tokens[cursor]?.value === 'default') cursor++;
    const async = tokens[cursor]?.value === 'async';
    if (async) cursor++;
    if (tokens[cursor]?.value === 'function') {
      cursor++;
      if (tokens[cursor]?.value === '*') cursor++;
      const name = tokens[cursor]?.kind === 'identifier' ? tokens[cursor++].value : 'default';
      if (tokens[cursor]?.value === '<') cursor = matching(tokens, cursor) + 1;
      if (tokens[cursor]?.value !== '(' || (onlyAsync && !async)) continue;
      const params = signature(record, cursor);
      if (params) found.push({ name, ...params });
    } else if (['const', 'let', 'var'].includes(tokens[cursor]?.value)) {
      const name = tokens[++cursor]?.value;
      cursor++;
      // Arrow functions may have an explicit variable type. Skip it to '='.
      while (cursor < tokens.length && !['=', ';'].includes(tokens[cursor].value)) cursor++;
      if (tokens[cursor++]?.value !== '=') continue;
      const arrowAsync = tokens[cursor]?.value === 'async';
      if (arrowAsync) cursor++;
      if (tokens[cursor]?.value === '<') cursor = matching(tokens, cursor) + 1;
      if (onlyAsync && !arrowAsync) continue;
      if (tokens[cursor]?.value === '(') {
        const params = signature(record, cursor);
        if (params) found.push({ name, ...params });
      } else if (tokens[cursor]?.kind === 'identifier' && tokens[cursor + 1]?.value === '=') {
        found.push({ name, parameters: tokens[cursor].value, firstParamType: null, sessionFirst: /session/i.test(tokens[cursor].value) });
      }
    }
  }
  return found;
}

function importEntries(record, keyword = 'import') {
  const result = [];
  const tokens = record.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'identifier' || tokens[i].value !== keyword || tokens[i + 1]?.value === '(') continue;
    let cursor = i + 1;
    const clause = [];
    while (cursor < tokens.length && !['from', ';'].includes(tokens[cursor].value) && tokens[cursor].kind !== 'string') clause.push(tokens[cursor++]);
    if (tokens[cursor]?.value !== 'from' || tokens[cursor + 1]?.kind !== 'string') continue;
    const specifier = tokens[cursor + 1].value;
    const opening = clause.findIndex(token => token.value === '{');
    const closing = opening < 0 ? -1 : matching(clause, opening);
    if (opening >= 0 && closing >= 0) {
      for (const group of splitTopLevel(clause.slice(opening + 1, closing), ',')) {
        const names = group.filter(token => token.kind === 'identifier' && token.value !== 'type');
        if (!names.length) continue;
        const imported = names[0].value;
        const local = names.at(-1).value;
        result.push({ specifier, imported, local });
      }
    }
    if (keyword === 'import' && clause[0]?.kind === 'identifier' && !['type', 'from'].includes(clause[0].value)) result.push({ specifier, imported: 'default', local: clause[0].value });
    if (clause[0]?.value === '*') result.push({ specifier, imported: '*', local: clause.at(-1)?.value });
  }
  return result;
}

function literalValues(tokens) {
  const members = splitTopLevel(tokens, '|');
  if (members.length < 2) return null;
  const values = [];
  for (const member of members) {
    if (member.length !== 1) return null;
    const token = member[0];
    if (token.kind === 'string') values.push(token.value);
    else if (token.kind === 'number') values.push(Number(token.value));
    else if (['true', 'false'].includes(token.value)) values.push(token.value === 'true');
    else return null;
  }
  return values;
}

function properties(record, tokens) {
  const props = [];
  const members = [];
  let member = [];
  const stack = [];
  const pairs = { '(': ')', '{': '}', '[': ']', '<': '>' };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nextIsColon = tokens[i + 1]?.value === ':' || (tokens[i + 1]?.value === '?' && tokens[i + 2]?.value === ':');
    const newlineProperty = member.length && !stack.length && ['identifier', 'string'].includes(token.kind) && nextIsColon && /[\r\n]/.test(record.source.slice(tokens[i - 1].end, token.start));
    if (newlineProperty || (!stack.length && [';', ','].includes(token.value) && token.kind === 'punctuation')) {
      members.push(member);
      member = [];
      if (!newlineProperty) continue;
    }
    if (token.kind === 'punctuation') {
      if (pairs[token.value]) stack.push(pairs[token.value]);
      else if (token.value === stack.at(-1)) stack.pop();
    }
    member.push(token);
  }
  if (member.length) members.push(member);
  for (const member of members) {
    let cursor = member[0]?.value === 'readonly' ? 1 : 0;
    const name = member[cursor++];
    if (!name || !['identifier', 'string'].includes(name.kind)) continue;
    const optional = member[cursor]?.value === '?';
    if (optional) cursor++;
    if (member[cursor++]?.value !== ':') continue;
    const typeTokens = member.slice(cursor);
    const prop = { name: name.value, type: raw(record.source, typeTokens), optional };
    const values = literalValues(typeTokens);
    if (values) prop.literalValues = values;
    props.push(prop);
  }
  return props;
}

async function readJson(file, fallback = {}) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

/** Paths in output are app-relative. No host source is imported or executed. */
export async function discover(appDir) {
  const root = path.resolve(appDir);
  const pkg = await readJson(path.join(root, 'package.json'));
  const files = await walk(root);
  const records = new Map();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    records.set(file, { file, source, tokens: tokenize(source) });
  }
  const relative = file => slash(path.relative(root, file));
  // Support the common @/* and ~/* conventions plus JSON tsconfig paths. A
  // custom alias or inherited tsconfig is a hint to inspect manually.
  let tsconfig = {};
  try { tsconfig = await readJson(path.join(root, 'tsconfig.json')); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  const base = path.resolve(root, tsconfig.compilerOptions?.baseUrl || '.');
  const aliases = tsconfig.compilerOptions?.paths || { '@/*': ['./src/*'], '~/*': ['./src/*'] };
  function resolveModule(from, specifier) {
    const candidates = [];
    if (specifier.startsWith('.')) candidates.push(path.resolve(path.dirname(from), specifier));
    for (const [alias, targets] of Object.entries(aliases)) {
      const star = alias.indexOf('*');
      if (star < 0 ? specifier === alias : specifier.startsWith(alias.slice(0, star)) && specifier.endsWith(alias.slice(star + 1))) {
        const rest = star < 0 ? '' : specifier.slice(star, alias.length > star + 1 ? -alias.slice(star + 1).length : undefined);
        for (const target of targets) candidates.push(path.resolve(base, target.replace('*', rest)));
      }
    }
    for (const candidate of candidates) {
      const stem = candidate.replace(/\.[cm]?js$/, '');
      for (const option of [candidate, ...['.tsx', '.ts', '.jsx', '.js', '.mts', '.cts'].map(ext => stem + ext), ...['.tsx', '.ts', '.jsx', '.js'].map(ext => path.join(candidate, 'index' + ext))]) {
        if (records.has(option)) return option;
      }
    }
    return null;
  }
  function resolveExport(file, name, seen = new Set()) {
    const key = `${file}:${name}`;
    if (!file || seen.has(key)) return null;
    seen.add(key);
    const record = records.get(file);
    const declaration = declarations(record).find(item => item.name === name || (name === 'default' && /export\s+default\s/.test(record.source)));
    if (declaration) return { record, declaration };
    for (const entry of importEntries(record, 'export')) {
      if (entry.local !== name && entry.imported !== '*') continue;
      const resolved = resolveExport(resolveModule(file, entry.specifier), entry.imported === '*' ? name : entry.imported, seen);
      if (resolved) return resolved;
    }
    return null;
  }
  function readProps(record, type, seen = new Set()) {
    if (seen.has(`${record.file}:${type}`)) return [];
    seen.add(`${record.file}:${type}`);
    const tokens = record.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (!['interface', 'type'].includes(tokens[i].value) || tokens[i + 1].value !== type) continue;
      let opening = i + 2;
      while (opening < tokens.length && !['{', ';'].includes(tokens[opening].value)) opening++;
      if (tokens[opening]?.value !== '{') continue;
      const closing = matching(tokens, opening);
      if (closing < 0) continue;
      const inherited = [];
      const extendsAt = tokens.slice(i + 2, opening).findIndex(token => token.value === 'extends');
      if (extendsAt >= 0) {
        for (const token of tokens.slice(i + 3 + extendsAt, opening).filter(item => item.kind === 'identifier')) inherited.push(...readProps(record, token.value, seen));
      }
      return [...inherited, ...properties(record, tokens.slice(opening + 1, closing))];
    }
    for (const entry of importEntries(record)) {
      if (entry.local !== type) continue;
      const target = resolveModule(record.file, entry.specifier);
      if (target) return readProps(records.get(target), entry.imported, seen);
    }
    return [];
  }

  const dataFunctions = [];
  const pages = [];
  const components = new Map();
  const componentCache = new Map();
  function pageComponents(record) {
    const tags = new Set(record.tokens.flatMap((token, index) => token.value === '<' && token.kind === 'punctuation' && /^[A-Z][\w$]*$/.test(record.tokens[index + 1]?.value || '') ? [record.tokens[index + 1].value] : []));
    const result = [];
    for (const entry of importEntries(record)) {
      if (!tags.has(entry.local)) continue;
      const resolved = resolveExport(resolveModule(record.file, entry.specifier), entry.imported);
      if (!resolved) continue;
      const { record: componentRecord, declaration } = resolved;
      const key = `${componentRecord.file}:${declaration.name}`;
      let component = componentCache.get(key);
      if (!component) {
        const firstType = declaration.firstParamType || '';
        const props = firstType.startsWith('{') ? properties({ source: firstType }, tokenize(firstType).slice(1, -1)) : readProps(componentRecord, firstType);
        component = { name: declaration.name === 'default' ? entry.local : declaration.name, file: relative(componentRecord.file), props, variantProps: Object.fromEntries(props.filter(prop => prop.literalValues).map(prop => [prop.name, prop.literalValues])) };
        componentCache.set(key, component);
      }
      result.push(component);
    }
    return result;
  }
  for (const record of records.values()) {
    const file = relative(record.file);
    if (/(?:^|\/)(?:data|lib)\//.test(file)) {
      for (const { closing, ...declaration } of declarations(record, true)) dataFunctions.push({ name: declaration.name, file, parameters: declaration.parameters, firstParamType: declaration.firstParamType, sessionFirst: declaration.sessionFirst });
    }
    const appMatch = file.match(/^(?:src\/)?app\/(.*?)(?:\/)?page\.[jt]sx?$/);
    if (appMatch) {
      const route = '/' + appMatch[1].split('/').filter(part => part && !part.startsWith('(') && !part.startsWith('@')).join('/');
      const rendered = pageComponents(record);
      const page = { route, file, components: [...new Set(rendered.map(item => item.name))] };
      pages.push(page);
      if (rendered.length >= 3) for (const component of rendered) components.set(`${component.file}:${component.name}`, component);
    }
  }
  const auth = { sessionFiles: [], cookieNames: [], supabase: { client: false, auth: false, files: [] } };
  const cookies = new Set();
  const fixedChrome = [];
  for (const record of records.values()) {
    const file = relative(record.file);
    if (/(?:^|\/)(?:auth|session)(?:[.-]|\/)/i.test(file) || /\b(?:getSession|requireSession|verifySession)\b/.test(record.source)) auth.sessionFiles.push(file);
    const tokens = record.tokens;
    const cookieConstants = new Map();
    for (let i = 0; i < tokens.length - 3; i++) {
      if (['const', 'let', 'var'].includes(tokens[i].value) && /cookie/i.test(tokens[i + 1]?.value) && tokens[i + 2]?.value === '=' && tokens[i + 3]?.kind === 'string') cookieConstants.set(tokens[i + 1].value, tokens[i + 3].value);
      if (['get', 'set', 'delete'].includes(tokens[i].value) && tokens[i + 1]?.value === '(') {
        const receiver = raw(record.source, tokens.slice(Math.max(0, i - 10), i));
        const value = tokens[i + 2];
        if (/cookies?|cookieStore|jar/i.test(receiver) && value?.kind === 'string') cookies.add(value.value);
        if (cookieConstants.has(value?.value)) cookies.add(cookieConstants.get(value.value));
      }
    }
    if (/\bcookies\s*\(/.test(record.source)) for (const value of cookieConstants.values()) cookies.add(value);
    if (/['"]@supabase\//.test(record.source) || /\bsupabase\b/i.test(record.source)) {
      auth.supabase.client = true;
      auth.supabase.files.push(file);
      if (/\.auth\s*\.|(?:getUser|getSession|signInWithPassword)\s*\(/.test(record.source)) auth.supabase.auth = true;
    }
    if (!/(?:^|\/)components\/|(?:^|\/)layout\.[jt]sx?$|(?:^|\/)admin\//.test(file)) continue;
    const name = declarations(record)[0]?.name || path.basename(file).replace(/\.[^.]+$/, '');
    if (/nav|sidebar|header/i.test(path.basename(file)) || /<nav\b/.test(record.source)) fixedChrome.push({ kind: 'nav', name, file, reason: 'Navigation component or nav element' });
    if (/account[-_ ]|profile[-_ ]|["']\/settings["']/.test(record.source)) fixedChrome.push({ kind: 'account', name, file, reason: 'Account menu, profile, or settings link' });
    if (/(?:^|\/)admin\//.test(file) || /["']\/admin["']/.test(record.source)) fixedChrome.push({ kind: 'admin', name, file, reason: 'Admin route or navigation link' });
  }
  auth.cookieNames = [...cookies].sort();
  const appDirectories = [...new Set(files.map(file => relative(file).match(/^((?:src\/)?app)\//)?.[1]).filter(Boolean))];
  const nextVersion = pkg.dependencies?.next || pkg.devDependencies?.next || null;
  return {
    framework: { name: nextVersion ? 'next' : 'unknown', nextVersion, appRouter: appDirectories.length > 0, appDirectories },
    auth,
    dataFunctions,
    pages,
    candidateScreens: pages.filter(page => page.components.length >= 3),
    components: [...components.values()],
    fixedChrome,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appDir = process.argv[2];
  if (!appDir || process.argv.length !== 3) {
    console.error('Usage: node discover.mjs <appDir>');
    process.exitCode = 1;
  } else {
    try {
      if (!(await stat(appDir)).isDirectory()) throw new Error('appDir must be a directory');
      console.log(JSON.stringify(await discover(appDir), null, 2));
    } catch (error) {
      console.error(`Discovery failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
