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
export function assertSchemaName(schema) {
  if (typeof schema !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error(`Invalid schema name ${JSON.stringify(schema)}: use a lowercase identifier ([a-z_][a-z0-9_]*)`);
  }
  if (RESERVED.has(schema) || schema.startsWith("pg_") || schema.startsWith("supabase_")) {
    throw new Error(`Refusing to install Contour into reserved schema "${schema}"`);
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
