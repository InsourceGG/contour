#!/usr/bin/env node
// contour-migrate: print or apply the schema-scoped Contour install.
//
//   node packages/contour-sdk/bin/contour-migrate.mjs --schema northwind            # print SQL
//   node packages/contour-sdk/bin/contour-migrate.mjs --schema northwind --apply    # run it on the linked project
//
// --apply writes the SQL to a temp file and runs `supabase db query --linked -f <file>`.
// Pass --workdir <dir> to point the Supabase CLI at the linked project directory.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderSchema } from "./render.mjs";

const USAGE = "Usage: contour-migrate --schema <name> [--apply] [--workdir <supabase project dir>]";

function parseArgs(argv) {
  const out = { schema: undefined, apply: false, workdir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--schema") out.schema = argv[++i];
    else if (a.startsWith("--schema=")) out.schema = a.slice("--schema=".length);
    else if (a === "--workdir") out.workdir = argv[++i];
    else if (a.startsWith("--workdir=")) out.workdir = a.slice("--workdir=".length);
    else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}\n${USAGE}`);
      process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.schema) {
  console.error(USAGE);
  process.exit(2);
}

let sql;
try {
  sql = renderSchema(args.schema);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}

if (!args.apply) {
  process.stdout.write(sql);
  process.exit(0);
}

const dir = mkdtempSync(path.join(tmpdir(), "contour-migrate-"));
const file = path.join(dir, `contour_${args.schema}.sql`);
try {
  writeFileSync(file, sql, { mode: 0o600 });
  const cli = ["db", "query", "--linked", "-f", file];
  if (args.workdir) cli.push("--workdir", path.resolve(args.workdir));
  console.error(`[contour-migrate] applying schema "${args.schema}" via supabase ${cli.join(" ")}`);
  const r = spawnSync("supabase", cli, { stdio: "inherit" });
  if (r.error) {
    console.error(`[contour-migrate] could not run the Supabase CLI: ${r.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = r.status ?? 1;
    if (r.status === 0) console.error(`[contour-migrate] schema "${args.schema}" is up to date`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
