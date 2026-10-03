import type { CloudDb } from '../../src/server/db.js';
type Row = Record<string, any>;
type Result = { data: any; error: { message: string } | null };
export type FakeCloudDb = CloudDb & { tables: Map<string, Row[]> };

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeCloudDb {
  const tables = new Map(Object.entries(structuredClone(seed)));
  function rows(table: string): Row[] {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  }
  return {
    tables,
    from(table: string) {
      let operation = 'select';
      let payload: Row[] = [];
      let columns = '*';
      let singular = false;
      let requireSingle = false;
      let sort: { key: string; ascending: boolean } | undefined;
      let countLimit: number | undefined;
      let conflict: string[] = [];
      const filters: ((row: Row) => boolean)[] = [];
      let result: Result | undefined;
      const query: any = {
        select(value = '*') { columns = value; return query; },
        insert(value: Row | Row[]) { operation = 'insert'; payload = Array.isArray(value) ? value : [value]; return query; },
        upsert(value: Row | Row[], opts?: { onConflict?: string }) { operation = 'upsert'; payload = Array.isArray(value) ? value : [value]; conflict = (opts?.onConflict ?? '').split(','); return query; },
        update(value: Row) { operation = 'update'; payload = [value]; return query; },
        delete() { operation = 'delete'; return query; },
        eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
        neq(key: string, value: unknown) { filters.push(row => row[key] !== value); return query; },
        is(key: string, value: unknown) { filters.push(row => (row[key] ?? null) === value); return query; },
        gt(key: string, value: unknown) { filters.push(row => row[key] > value!); return query; },
        in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
        order(key: string, opts?: { ascending?: boolean }) { sort = { key, ascending: opts?.ascending ?? true }; return query; },
        limit(value: number) { countLimit = value; return query; },
        maybeSingle() { singular = true; return query; },
        single() { singular = true; requireSingle = true; return query; },
        then(resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) {
          try {
            if (!result) {
              const source = rows(table);
              let selected = source.filter(row => filters.every(filter => filter(row)));
              const now = new Date().toISOString();
              if (operation === 'insert' || operation === 'upsert') {
                selected = payload.map(value => {
                  const existing = operation === 'upsert' && conflict.length ? source.find(row => conflict.every(key => row[key] === value[key])) : undefined;
                  if (existing) { Object.assign(existing, structuredClone(value)); return existing; }
                  const row = { created_at: now, updated_at: now, ...structuredClone(value) };
                  source.push(row); return row;
                });
              } else if (operation === 'update') {
                selected.forEach(row => Object.assign(row, structuredClone(payload[0])));
              } else if (operation === 'delete') {
                tables.set(table, source.filter(row => !selected.includes(row)));
              }
              if (sort) selected.sort((a,b) => (a[sort!.key] < b[sort!.key] ? -1 : a[sort!.key] > b[sort!.key] ? 1 : 0) * (sort!.ascending ? 1 : -1));
              if (countLimit !== undefined) selected = selected.slice(0, countLimit);
              const projected = selected.map(row => {
                const copy = structuredClone(row);
                if (columns.includes('projects')) {
                  copy.projects = structuredClone(rows('projects').find(project => project.id === row.project_id) ?? null);
                  copy.project = copy.projects;
                }
                return copy;
              });
              result = { data: singular ? projected[0] ?? null : projected, error: singular && (projected.length > 1 || (requireSingle && !projected.length)) ? { message: 'Expected one row' } : null };
            }
            return Promise.resolve(result).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      return query;
    },
    async rpc(fn, args) {
      if (fn !== 'consume_link_state' && fn !== 'consume_session_link_state') throw new Error('Unexpected RPC');
      const { p_state_hash, p_contour_user, p_session_id } = args as Record<string, string>;
      const state = rows('link_states').find(row => row.state_hash === p_state_hash && row.contour_user === p_contour_user &&
        (fn === 'consume_session_link_state' ? !!p_session_id && row.session_id === p_session_id : row.session_id == null) &&
        !row.used_at && Date.parse(row.expires_at) > Date.now());
      if (!state) return { data: [], error: null };
      state.used_at = new Date().toISOString();
      return { data: [{ project_id: state.project_id, verifier_ct: state.verifier_ct, key_id: state.key_id }], error: null };
    },
  };
}
