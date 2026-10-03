import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseStore } from "@contour/sdk/server";
import type { Owner } from "@contour/sdk/core";
import { admin } from "../support/fixtures";

// The SDK store against a schema installed by `contour-migrate` (northwind):
// text subject IDs, no memberships table, role version passed in the payload.

const SCHEMA = "northwind";
const client = admin();
const db = () => client.schema(SCHEMA);
const store = supabaseStore({ client, schema: SCHEMA, agentAccessEnabled: async () => true });

const subjectId = `it-store-${randomUUID()}`;
const owner: Owner = { tenantId: "it-tenant", appId: "it-app", subjectId, surfaceId: "it-surface" };
const eventIds: string[] = [];
const DEFAULT_CONFIG = { placements: [], note: "default" };

async function grantCredit() {
  const sessionId = `cs_test_it_${randomUUID()}`;
  const { data: order, error } = await db()
    .from("billing_orders")
    .insert({ tenant_id: owner.tenantId, app_id: owner.appId, subject_id: subjectId, amount: 100, currency: "usd", price_id: "price_it", stripe_session_id: sessionId })
    .select("id")
    .single();
  if (error) throw error;
  const eventId = `evt_it_${randomUUID()}`;
  eventIds.push(eventId);
  const { data, error: gErr } = await db().rpc("contour_grant_credit", {
    p: {
      event_id: eventId, event_type: "checkout.session.completed", livemode: false, order_id: order.id, session_id: sessionId,
      tenant_id: owner.tenantId, subject_id: subjectId, app_id: owner.appId, amount: 100, currency: "usd", payment_intent: null,
    },
  });
  if (gErr) throw gErr;
  return data as { ok: boolean; result: string };
}

function proposalRecord(jobId: string, baseRevision: number, roleVersion: number) {
  const config = { placements: [], note: `proposal ${jobId}` };
  return {
    tenant_id: owner.tenantId, app_id: owner.appId, subject_id: subjectId, surface_id: owner.surfaceId, client_id: "host",
    base_revision: baseRevision, manifest_version: "m1", policy_version: "p1", role_version: roleVersion, config,
    config_hash: `sha256:${jobId}`, candidate_id: "guided", task: "review", expertise: "beginner", preferences: {}, changes: [],
    rationale: "integration", decision_id: randomUUID(), job_id: jobId, request_id: `req-${jobId}`, request_hash: `rh-${jobId}`,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

function applyParams(proposalId: string, configHash: string, key: string, roleVersion?: number) {
  return {
    proposal_id: proposalId, tenant_id: owner.tenantId, app_id: owner.appId, subject_id: subjectId, surface_id: owner.surfaceId,
    config_hash: configHash, manifest_version: "m1", policy_version: "p1", idempotency_key: key,
    request_hash: `apply:${proposalId}:${configHash}`, default_config: DEFAULT_CONFIG, default_hash: "sha256:default", history_limit: 20,
    ...(roleVersion === undefined ? {} : { role_version: roleVersion }),
  };
}

afterAll(async () => {
  for (const t of ["approvals", "credit_ledger", "credits", "billing_orders", "proposals", "idempotency_keys", "view_history", "user_views", "audit_events"]) {
    await db().from(t).delete().eq("subject_id", subjectId);
  }
  if (eventIds.length) await db().from("stripe_events").delete().in("event_id", eventIds);
});

describe(`supabaseStore on a contour-migrate schema (${SCHEMA})`, () => {
  it("reserve, grant, propose, apply and replay round-trip with a text subject ID", async () => {
    expect(await store.reserveCredit(owner, randomUUID())).toMatchObject({ ok: false, code: "PAYMENT_REQUIRED" });

    expect(await grantCredit()).toMatchObject({ ok: true, result: "granted" });
    expect(await store.creditBalance(owner)).toEqual({ available: 1, reserved: 0, consumed: 0 });

    const job = randomUUID();
    expect(await store.reserveCredit(owner, job)).toMatchObject({ ok: true, status: "reserved" });
    const record = proposalRecord(job, 0, 1);
    const created = await store.createProposal(record);
    expect(created).toMatchObject({ ok: true, replayed: false });
    const proposalId = created.proposalId as string;

    const key = `apply-${randomUUID()}`;
    const applied = await store.applyProposal(applyParams(proposalId, record.config_hash, key, 1));
    expect(applied).toMatchObject({ ok: true, revision: 1, proposalId });

    const replay = await store.applyProposal(applyParams(proposalId, record.config_hash, key, 1));
    expect(replay).toMatchObject({ ok: true, revision: 1, replayed: true });

    expect((await store.getActiveView(owner))?.revision).toBe(1);
    expect((await store.getProposal(owner, proposalId))?.status).toBe("APPLIED");
    expect(await store.creditBalance(owner)).toEqual({ available: 0, reserved: 0, consumed: 1 });
  });

  it("refuses an apply without role_version and invalidates on a role-version change", async () => {
    expect(await grantCredit()).toMatchObject({ ok: true, result: "granted" });
    const job = randomUUID();
    expect(await store.reserveCredit(owner, job)).toMatchObject({ ok: true });
    const record = proposalRecord(job, 1, 1);
    const created = await store.createProposal(record);
    const proposalId = created.proposalId as string;

    expect(await store.applyProposal(applyParams(proposalId, record.config_hash, `apply-${randomUUID()}`))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await store.getProposal(owner, proposalId))?.status).toBe("READY");

    expect(await store.applyProposal(applyParams(proposalId, record.config_hash, `apply-${randomUUID()}`, 2))).toMatchObject({
      ok: false,
      code: "INCOMPATIBLE_MANIFEST",
    });
    expect((await store.getProposal(owner, proposalId))?.status).toBe("INVALID");
    expect((await store.getActiveView(owner))?.revision).toBe(1);
  });
});
