// Renders the schema-scoped Contour install (sql/contour_schema.sql.tmpl).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TEMPLATE_PATH = fileURLToPath(new URL("../sql/contour_schema.sql.tmpl", import.meta.url));

/** Schemas the template must never be installed into. `public` keeps Acme's own migrations. */
const RESERVED = new Set([
  "public", "auth", "storage", "extensions", "graphql", "graphql_public", "realtime", "vault",
  "net", "cron", "pgbouncer", "information_schema", "supabase_functions", "supabase_migrations",
]);

/**
 * Validates a schema name: a plain lowercase identifier that needs no quoting
 * and is not a platform schema.
 * @param {string} schema
 * @returns {string}
 */
export function assertSchemaName(schema, action = "install Contour into") {
  if (typeof schema !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error(`Invalid schema name ${JSON.stringify(schema)}: use a lowercase identifier ([a-z_][a-z0-9_]*)`);
  }
  if (RESERVED.has(schema) || schema.startsWith("pg_") || schema.startsWith("supabase_")) {
    throw new Error(`Refusing to ${action} reserved schema "${schema}"`);
  }
  return schema;
}

/**
 * Returns the install SQL for `schema`.
 * @param {string} schema
 * @returns {string}
 */
export function renderSchema(schema) {
  assertSchemaName(schema);
  const sql = readFileSync(TEMPLATE_PATH, "utf8").replaceAll("{{schema}}", schema);
  if (/\{\{|\}\}/.test(sql)) throw new Error("Template has unrendered placeholders");
  return sql;
}

/**
 * Lists the tables and functions the template creates, parsed from the template
 * itself so the uninstall can never drift from the install.
 * @returns {{ tables: string[], functions: string[] }}
 */
export function templateObjects() {
  const tmpl = readFileSync(TEMPLATE_PATH, "utf8");
  const tables = [...tmpl.matchAll(/create table if not exists \{\{schema\}\}\.(\w+)/g)].map((m) => m[1]);
  const functions = [...tmpl.matchAll(/create or replace function \{\{schema\}\}\.(\w+)\s*\(/g)].map((m) => m[1]);
  return { tables: [...new Set(tables)], functions: [...new Set(functions)] };
}

/**
 * Returns the uninstall SQL for `schema`: drops every function and table the
 * template creates (cascade, if exists). For a dedicated `<app>_contour` schema
 * it also drops whatever else is left inside it, but keeps the schema itself so
 * its API exposure and grants survive a reinstall.
 * @param {string} schema
 * @returns {string}
 */
export function renderDrop(schema) {
  assertSchemaName(schema, "drop Contour objects from");
  const { tables, functions } = templateObjects();
  const dedicated = schema.endsWith("_contour");
  const lines = [
    `-- Contour schema-scoped uninstall for ${schema}.`,
    "-- Rendered by `contour-migrate --schema " + schema + " --drop`. Idempotent: every drop is `if exists`.",
    dedicated
      ? `-- ${schema} is a dedicated Contour schema: everything inside it is dropped; the schema itself is kept.`
      : `-- Only objects the template creates are dropped; other objects in ${schema} are left alone.`,
    "",
    "begin;",
    "",
    "-- functions (before tables: some return table row types)",
    ...functions.map((f) => `drop function if exists ${schema}.${f} cascade;`),
    "",
    "-- tables",
    ...tables.map((t) => `drop table if exists ${schema}.${t} cascade;`),
  ];
  if (dedicated) {
    lines.push(
      "",
      `-- anything else left in the dedicated schema ${schema}`,
      "do $$",
      "declare r record;",
      "begin",
      "  for r in",
      "    select c.relname, case c.relkind when 'v' then 'view' when 'm' then 'materialized view'",
      "      when 'S' then 'sequence' when 'f' then 'foreign table' else 'table' end as kind",
      "    from pg_class c join pg_namespace n on n.oid = c.relnamespace",
      `    where n.nspname = '${schema}' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`,
      "      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a', 'i'))",
      "  loop",
      `    execute format('drop %s if exists %I.%I cascade', r.kind, '${schema}', r.relname);`,
      "  end loop;",
      "  for r in",
      "    select p.oid::regprocedure::text as sig, case p.prokind when 'p' then 'procedure'",
      "      when 'a' then 'aggregate' else 'function' end as kind",
      "    from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
      `    where n.nspname = '${schema}'`,
      "  loop",
      "    execute format('drop %s if exists %s cascade', r.kind, r.sig);",
      "  end loop;",
      "end",
      "$$;",
    );
  }
  lines.push("", "notify pgrst, 'reload schema';", "commit;", "");
  return lines.join("\n");
}
