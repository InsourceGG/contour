import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseStore } from "@contour/sdk/server";
import type { Membership, Owner } from "@contour/sdk/core";
import { admin } from "../support/fixtures";

// billing: "none" against the dedicated northwind_contour schema: a READY
// proposal is created and applied with no credits anywhere.

const SCHEMA = "northwind_contour";
const client = admin();
const db = () => client.schema(SCHEMA);

const subjectId = `it-unmetered-${randomUUID()}`;
const owner: Owner = { tenantId: "it-tenant", appId: "it-app", subjectId, surfaceId: "it-surface" };
const activeMembership: Membership = {
  tenantId: owner.tenantId, subjectId, appId: owner.appId, role: "member", roleVersion: 1,
  dataAccess: true, status: "active", displayName: "Unmetered Tester",
};
const store = supabaseStore({
  client,
  schema: SCHEMA,
  billing: "none",
  agentAccessEnabled: async () => true,
  getMembership: async () => activeMembership,
});

afterAll(async () => {
  for (const t of ["approvals", "credit_ledger", "credits", "proposals", "idempotency_keys", "view_history", "user_views", "audit_events"]) {
    await db().from(t).delete().eq("subject_id", subjectId);
  }
});

describe(`supabaseStore billing: none on ${SCHEMA}`, () => {
  it("creates a READY proposal without credits, then apply gives revision 1", async () => {
    expect((await db().from("credits").select("id").eq("subject_id", subjectId)).data ?? []).toHaveLength(0);
    expect(await store.creditBalance(owner)).toEqual({ available: null, reserved: 0, consumed: 0, unmetered: true });

    const job = randomUUID();
    expect(await store.reserveCredit(owner, job)).toEqual({ ok: true, creditId: null, status: "unmetered" });

    const config = { placements: [], note: `proposal ${job}` };
    const configHash = `sha256:${job}`;
    const created = await store.createProposal({
      tenant_id: owner.tenantId, app_id: owner.appId, subject_id: subjectId, surface_id: owner.surfaceId, client_id: "host",
      base_revision: 0, manifest_version: "m1", policy_version: "p1", role_version: 1, config, config_hash: configHash,
      candidate_id: "guided", task: "review", expertise: "beginner", preferences: {}, changes: [], rationale: "integration",
      decision_id: randomUUID(), job_id: job, request_id: `req-${job}`, request_hash: `rh-${job}`,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(created).toMatchObject({ ok: true, replayed: false, jobId: job, creditId: null });
    const proposalId = created.proposalId as string;
    expect((await store.getProposal(owner, proposalId))?.status).toBe("READY");

    const applied = await store.applyProposal({
      proposal_id: proposalId, tenant_id: owner.tenantId, app_id: owner.appId, subject_id: subjectId, surface_id: owner.surfaceId,
      config_hash: configHash, manifest_version: "m1", policy_version: "p1", idempotency_key: `apply-${randomUUID()}`,
      request_hash: `apply:${proposalId}:${configHash}`, default_config: { placements: [], note: "default" },
      default_hash: "sha256:default", history_limit: 20, role_version: 1,
    });
    expect(applied).toMatchObject({ ok: true, revision: 1, proposalId });
    expect((await store.getActiveView(owner))?.revision).toBe(1);

    await store.releaseCredit(job);
    expect((await db().from("credits").select("id").eq("subject_id", subjectId)).data ?? []).toHaveLength(0);
    expect((await db().from("credit_ledger").select("id").eq("subject_id", subjectId)).data ?? []).toHaveLength(0);
  });

  it("replays an identical request without PAYMENT_REQUIRED", async () => {
    const job = randomUUID();
    const record = {
      tenant_id: owner.tenantId, app_id: owner.appId, subject_id: subjectId, surface_id: owner.surfaceId, client_id: "host",
      base_revision: 1, manifest_version: "m1", policy_version: "p1", role_version: 1, config: { placements: [], note: job },
      config_hash: `sha256:${job}`, candidate_id: "guided", task: "review", expertise: "beginner", preferences: {}, changes: [],
      rationale: "integration", decision_id: randomUUID(), job_id: job, request_id: `req-${job}`, request_hash: `rh-${job}`,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const first = await store.createProposal(record);
    const again = await store.createProposal(record);
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(again).toMatchObject({ ok: true, replayed: true, proposalId: first.proposalId });
  });
});
