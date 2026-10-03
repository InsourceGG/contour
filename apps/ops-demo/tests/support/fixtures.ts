import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdaptiveBroker, type Selector, type SelectorResult } from "@/sdk/broker";
import { defineAdaptiveApp } from "@/sdk/registry";
import { AGENT_SCOPES, ALL_SCOPES, type Scope, type VerifiedContext } from "@/sdk/types";
import { overviewManifest } from "@/host/manifest";
import { overviewPolicy } from "@/host/policy";
import { readers } from "@/host/readers";
import { COMPONENT_IDS } from "@/host/component-ids";
import { supabaseStore } from "@/server/store";

export const PASSWORD = "contour-demo-2026";

export function admin(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A real end-user session (anon key + password grant) — RLS applies. */
export async function userSession(email: string): Promise<SupabaseClient> {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return c;
}

export async function subjectOf(email: string): Promise<{ id: string; tenant: string; roleVersion: number }> {
  const db = admin();
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const u = data.users.find((x) => x.email === email);
  if (!u) throw new Error(`seed user ${email} missing — run pnpm seed`);
  const { data: m } = await db.from("memberships").select("tenant_id, role_version").eq("subject_id", u.id).single();
  return { id: u.id, tenant: m!.tenant_id, roleVersion: m!.role_version };
}

export async function ctxFor(
  email: string,
  opts: { channel?: "host" | "mcp"; scopes?: readonly Scope[]; tenantOverride?: string } = {},
): Promise<VerifiedContext> {
  const s = await subjectOf(email);
  const channel = opts.channel ?? "host";
  return {
    subjectId: s.id,
    tenantId: opts.tenantOverride ?? s.tenant,
    appId: "ops-demo",
    surfaceId: "overview",
    clientId: channel === "host" ? "host" : "test-agent-client",
    grantRevision: "1",
    scopes: new Set(opts.scopes ?? (channel === "host" ? ALL_SCOPES : AGENT_SCOPES)),
    roleVersion: String(s.roleVersion),
    role: "member",
    channel,
  };
}

/** Removes all Contour state for a subject (test isolation). */
export async function resetSubject(subjectId: string) {
  const db = admin();
  await db.from("approvals").delete().eq("subject_id", subjectId);
  await db.from("credit_ledger").delete().eq("subject_id", subjectId);
  await db.from("credits").delete().eq("subject_id", subjectId);
  await db.from("stripe_events").delete().like("event_id", `evt_fixture_${subjectId.slice(0, 8)}%`);
  await db.from("billing_orders").delete().eq("subject_id", subjectId);
  await db.from("proposals").delete().eq("subject_id", subjectId);
  await db.from("idempotency_keys").delete().eq("subject_id", subjectId);
  await db.from("view_history").delete().eq("subject_id", subjectId);
  await db.from("user_views").delete().eq("subject_id", subjectId);
  await db.from("user_preferences").delete().eq("subject_id", subjectId);
  await db.from("decision_events").delete().eq("subject_id", subjectId);
  await db.from("usage_events").delete().eq("subject_id", subjectId);
  await db.from("rate_limits").delete().like("bucket", `%:${subjectId}`);
}

/**
 * TEST FIXTURE ONLY: grants a credit through the same verified-grant RPC the
 * Stripe webhook uses, with a synthetic event ID. This is not Stripe evidence
 * and never counts as a live payment test.
 */
export async function grantFixtureCredit(ctx: VerifiedContext): Promise<{ orderId: string; eventId: string; sessionId: string }> {
  const db = admin();
  const sessionId = `cs_test_fixture_${randomUUID()}`;
  const { data: order, error } = await db
    .from("billing_orders")
    .insert({
      tenant_id: ctx.tenantId,
      app_id: ctx.appId,
      subject_id: ctx.subjectId,
      amount: 100,
      currency: "usd",
      price_id: "price_fixture",
      stripe_session_id: sessionId,
    })
    .select("id")
    .single();
  if (error) throw error;
  const eventId = `evt_fixture_${ctx.subjectId.slice(0, 8)}_${randomUUID()}`;
  const { data, error: gErr } = await db.rpc("contour_grant_credit", {
    p: {
      event_id: eventId,
      event_type: "checkout.session.completed",
      livemode: false,
      order_id: order.id,
      session_id: sessionId,
      tenant_id: ctx.tenantId,
      subject_id: ctx.subjectId,
      app_id: ctx.appId,
      amount: 100,
      currency: "usd",
      payment_intent: null,
    },
  });
  if (gErr || (data as { result: string }).result !== "granted") throw new Error(`fixture grant failed: ${JSON.stringify(gErr ?? data)}`);
  return { orderId: order.id, eventId, sessionId };
}

export function fixedSelector(choice: string, confidence = 0.92): Selector & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    provider: "fixture",
    calls,
    async select(input) {
      calls.push(input);
      return {
        status: "ok",
        choice,
        confidence,
        distribution: { [choice]: confidence },
        modelVersion: "fixture-1",
        providerLatencyMs: 5,
        usage: { inputTokens: 100, outputTokens: 10 },
        cost: null,
        currency: null,
      };
    },
  };
}

export function failingSelector(status: SelectorResult["status"]): Selector {
  return {
    provider: "fixture",
    async select() {
      return { status, modelVersion: "fixture-1", providerLatencyMs: 4000 };
    },
  };
}

export const registry = defineAdaptiveApp([overviewManifest], {
  readerIds: new Set(readers.keys()),
  implementedComponentIds: COMPONENT_IDS,
});

export function brokerWith(selector: Selector) {
  return createAdaptiveBroker({
    registry,
    policies: { overview: overviewPolicy },
    readers,
    store: supabaseStore,
    selector,
    confidenceFloor: 0.7,
    appUrl: "http://localhost:3000",
  });
}

export function proposeReq(baseRevision: number, task = "review_performance", level = "beginner", extra: Record<string, unknown> = {}) {
  return {
    surfaceId: "overview",
    baseRevision,
    task: { id: task, source: "explicit" },
    expertise: { level, source: "explicit" },
    requestId: `req-${randomUUID()}`,
    ...extra,
  };
}
