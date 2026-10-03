import { describe, expect, it } from "vitest";
import { renderSchema } from "../bin/render.mjs";

describe("contour schema template", () => {
  it("renders a schema-scoped install", () => {
    const sql = renderSchema("northwind");
    expect(sql).toContain("create schema if not exists northwind");
    expect(sql).toMatch(/northwind\.proposals/);
    expect(sql).toMatch(/northwind\.contour_apply_proposal/);
    expect(sql).not.toMatch(/\bpublic\./);
    expect(sql).toMatch(/revoke all on all tables in schema northwind from anon, authenticated/);
  });

  it("leaves no unrendered placeholders", () => {
    expect(renderSchema("cloud")).not.toMatch(/\{\{|\}\}/);
  });

  it("defines service-only live progress with the supported statuses and owner index", () => {
    const sql = renderSchema("northwind");
    expect(sql).toContain("create table if not exists northwind.contour_jobs (");
    expect(sql).toContain("status in ('working', 'ready', 'kept', 'asked', 'failed')");
    expect(sql).toContain("changed_components text[] not null default '{}'");
    expect(sql).toContain("contour_jobs_owner_idx on northwind.contour_jobs(tenant_id, app_id, subject_id, surface_id, started_at desc)");
    expect(sql).toContain("alter table northwind.contour_jobs enable row level security");
  });

  it("is service-role only: RLS on every table, no policies, grants to service_role", () => {
    const sql = renderSchema("northwind");
    const tables = [...sql.matchAll(/create table if not exists northwind\.(\w+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(15);
    for (const t of tables) expect(sql).toContain(`alter table northwind.${t} enable row level security`);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on all functions in schema northwind from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on all sequences in schema northwind from public, anon, authenticated/);
    expect(sql).toMatch(/grant all on all tables in schema northwind to service_role/);
    expect(sql).toMatch(/grant execute on all functions in schema northwind to service_role/);
  });

  it("drops company tables and auth.users FKs; subjects are text", () => {
    const sql = renderSchema("northwind");
    expect(sql).not.toMatch(/auth\.users/);
    expect(sql).not.toMatch(/\bmemberships\b/);
    expect(sql).not.toMatch(/northwind\.(tenants|apps|demo_\w+)\b/);
    expect(sql).not.toMatch(/contour_is_member/);
    expect(sql).not.toMatch(/subject_id uuid/);
    expect(sql).toMatch(/subject_id text not null/);
    expect(sql).toContain("create table if not exists northwind.tenant_app_settings");
    expect(sql).toContain("create table if not exists northwind.audit_events");
  });

  it("carries every table and RPC the store and OAuth module use", () => {
    const sql = renderSchema("northwind");
    for (const t of [
      "user_preferences", "user_views", "view_history", "proposals", "approvals", "idempotency_keys",
      "decision_events", "usage_events", "audit_events", "billing_orders", "stripe_events", "credits",
      "credit_ledger", "oauth_clients", "oauth_codes", "oauth_grants", "oauth_tokens", "rate_limits",
      "tenant_app_settings", "surface_manifests", "contour_jobs",
    ]) {
      expect(sql).toContain(`create table if not exists northwind.${t} (`);
    }
    for (const f of [
      "contour_reserve_credit", "contour_release_credit", "contour_create_proposal", "contour_lock_view",
      "contour_apply_proposal", "contour_commit_snapshot", "contour_grant_credit", "contour_rate_limit",
      "contour_redeem_code", "contour_upsert_grant", "contour_retention",
    ]) {
      expect(sql).toContain(`create or replace function northwind.${f}(`);
    }
  });

  it("keeps the OAuth agent-scope cap and code-to-grant binding", () => {
    const sql = renderSchema("northwind");
    for (const c of ["oauth_grants_agent_scopes_only", "oauth_codes_agent_scopes_only", "oauth_tokens_agent_scopes_only"]) {
      expect(sql).toContain(c);
    }
    expect(sql).toMatch(/array\['view:read', 'data:read', 'view:propose'\]/);
    expect(sql).not.toMatch(/view:commit/);
    expect(sql).toMatch(/grant_revision integer/);
  });

  it("takes the role version from the payload instead of a memberships row", () => {
    const sql = renderSchema("northwind");
    expect(sql).toMatch(/p->>'role_version'/);
    expect(sql).toContain("INCOMPATIBLE_MANIFEST");
  });

  it("is idempotent: guarded creates and constraint adds", () => {
    const sql = renderSchema("northwind");
    expect(sql).not.toMatch(/create table (?!if not exists)/);
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/);
    expect(sql).not.toMatch(/create function/);
    // Every constraint add sits inside a guarded DO block.
    const adds = sql.split("\n").filter((l) => /add constraint/.test(l));
    expect(adds.length).toBeGreaterThan(0);
    expect(sql).toMatch(/if not exists \(select 1 from pg_constraint/);
  });

  it("adds Contour columns to an audit_events table the schema already owns (cloud registry log)", () => {
    const sql = renderSchema("cloud");
    const block = sql.slice(sql.indexOf("alter table cloud.audit_events"));
    for (const col of ["tenant_id text", "app_id text", "subject_id text", "surface_id text", "kind text", "ref text"]) {
      expect(block).toMatch(new RegExp(`^\\s*add column if not exists ${col}[,;]`, "m"));
    }
    // The index on tenant/app must come after the columns exist.
    expect(sql.indexOf("audit_events_app_idx")).toBeGreaterThan(sql.indexOf("alter table cloud.audit_events"));
  });

  it("rejects unsafe or reserved schema names", () => {
    for (const bad of ["public", "auth", "storage", "Northwind", "north-wind", "x; drop table y", "", "pg_temp"]) {
      expect(() => renderSchema(bad)).toThrow();
    }
  });
});
