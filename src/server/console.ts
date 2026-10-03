import "server-only";
import { overviewManifest } from "@/host/manifest";
import { hashJson } from "@/sdk/hash";
import type { SurfaceManifest } from "@/sdk/types";
import { ContourError } from "@/sdk/types";
import { APP_ID, resolveHostUser } from "./context";
import { adminClient } from "./supabase";

/** Aggregate company reporting (spec §13). Operator-only, scoped to the
 *  operator's tenant and app, metadata only (no layouts, prompts or records).
 *  Task × expertise cohorts below MIN_COHORT distinct users are suppressed. */
export const MIN_COHORT = 2;

export type ConsoleData = {
  manifest: SurfaceManifest;
  manifestHash: string;
  agentAccessEnabled: boolean;
  minCohort: number;
  totals: {
    users: number;
    decisions: number;
    proposals: number;
    applied: number;
    kept: number;
    asked: number;
    rejected: number;
    undos: number;
    resets: number;
    expired: number;
    validationFailures: number;
    timeouts: number;
  };
  rates: { acceptance: number | null; undo: number | null; fallback: number | null };
  latency: { p50: number | null; p95: number | null; providerP50: number | null };
  cost: { totalProvider: number; perAcceptedChange: number | null; currency: string; inputTokens: number; outputTokens: number };
  byTask: { task: string; expertise: string; users: number; proposals: number; applied: number; suppressed: boolean; topCandidate: string | null }[];
  outcomesByDay: { day: string; previewed: number; kept: number; asked: number }[];
  unsupportedRequests: number;
  pinConflicts: number;
  grants: { active: number; revoked: number; clients: { clientName: string; users: number }[] };
  recentAudit: { kind: string; createdAt: string; ref: string | null }[];
  revenue: { creditsGranted: number; creditsConsumed: number; ordersPending: number };
};

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export async function requireOperator() {
  const user = await resolveHostUser();
  if (user.role !== "operator") throw new ContourError("FORBIDDEN", "Company operator role required");
  return user;
}

export async function getConsoleData(): Promise<ConsoleData> {
  const user = await requireOperator();
  const db = adminClient();
  const t = user.tenantId;
  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  const [decisions, proposals, audit, app, grants, credits, orders] = await Promise.all([
    db
      .from("decision_events")
      .select("subject_id,outcome,outcome_reason,provider_status,validation,total_latency_ms,provider_latency_ms,input_tokens,output_tokens,provider_cost,currency,selected_id,inputs,created_at")
      .eq("tenant_id", t)
      .eq("app_id", APP_ID)
      .gte("created_at", since)
      .limit(5000),
    db.from("proposals").select("subject_id,status,task,expertise,candidate_id").eq("tenant_id", t).eq("app_id", APP_ID).gte("created_at", since).limit(5000),
    db.from("audit_events").select("kind,created_at,ref").eq("tenant_id", t).eq("app_id", APP_ID).order("created_at", { ascending: false }).limit(200),
    db.from("apps").select("agent_access_enabled").eq("id", APP_ID).single(),
    db.from("oauth_grants").select("subject_id,client_id,revoked_at,oauth_clients(client_name)").eq("tenant_id", t).eq("app_id", APP_ID).limit(1000),
    db.from("credits").select("status").eq("tenant_id", t).eq("app_id", APP_ID).limit(5000),
    db.from("billing_orders").select("status").eq("tenant_id", t).eq("app_id", APP_ID).limit(5000),
  ]);
  for (const r of [decisions, proposals, audit, app, grants, credits, orders]) {
    if (r.error) throw new ContourError("INTERNAL", "Console data unavailable");
  }

  const d = decisions.data ?? [];
  const p = proposals.data ?? [];
  const a = audit.data ?? [];
  const users = new Set(d.map((x) => x.subject_id));
  const count = (pred: (x: (typeof d)[number]) => boolean) => d.filter(pred).length;
  const applied = p.filter((x) => x.status === "APPLIED").length;
  const undos = a.filter((x) => x.kind === "view_undo").length;
  const resets = a.filter((x) => x.kind === "view_reset").length;
  const totalCost = d.reduce((s, x) => s + (x.provider_cost ? Number(x.provider_cost) : 0), 0);

  // Task × expertise cohorts with minimum-cohort suppression.
  const cohorts = new Map<string, { users: Set<string>; proposals: number; applied: number; candidates: Map<string, number> }>();
  for (const x of p) {
    const k = `${x.task}|${x.expertise}`;
    const c = cohorts.get(k) ?? { users: new Set<string>(), proposals: 0, applied: 0, candidates: new Map<string, number>() };
    c.users.add(x.subject_id);
    c.proposals++;
    if (x.status === "APPLIED") {
      c.applied++;
      c.candidates.set(x.candidate_id, (c.candidates.get(x.candidate_id) ?? 0) + 1);
    }
    cohorts.set(k, c);
  }
  const byTask = [...cohorts.entries()].map(([k, c]) => {
    const [task, expertise] = k.split("|");
    const suppressed = c.users.size < MIN_COHORT;
    const top = [...c.candidates.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    return suppressed
      ? { task, expertise, users: c.users.size, proposals: 0, applied: 0, suppressed, topCandidate: null }
      : { task, expertise, users: c.users.size, proposals: c.proposals, applied: c.applied, suppressed, topCandidate: top };
  });

  const days = new Map<string, { previewed: number; kept: number; asked: number }>();
  for (let i = 13; i >= 0; i--) days.set(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), { previewed: 0, kept: 0, asked: 0 });
  for (const x of d) {
    const day = days.get(String(x.created_at).slice(0, 10));
    if (!day) continue;
    if (x.outcome === "previewed") day.previewed++;
    else if (x.outcome === "kept") day.kept++;
    else if (x.outcome === "asked") day.asked++;
  }

  const g = grants.data ?? [];
  const clientUsers = new Map<string, Set<string>>();
  for (const x of g.filter((x) => !x.revoked_at)) {
    const rel = x.oauth_clients as unknown as { client_name?: string } | { client_name?: string }[] | null;
    const name = (Array.isArray(rel) ? rel[0]?.client_name : rel?.client_name) ?? "Unknown client";
    const set = clientUsers.get(name) ?? new Set<string>();
    set.add(x.subject_id);
    clientUsers.set(name, set);
  }

  const cr = credits.data ?? [];
  return {
    manifest: overviewManifest,
    manifestHash: hashJson(overviewManifest),
    agentAccessEnabled: Boolean(app.data?.agent_access_enabled),
    minCohort: MIN_COHORT,
    totals: {
      users: users.size,
      decisions: d.length,
      proposals: p.length,
      applied,
      kept: count((x) => x.outcome === "kept"),
      asked: count((x) => x.outcome === "asked"),
      rejected: p.filter((x) => x.status === "REJECTED").length,
      undos,
      resets,
      expired: p.filter((x) => x.status === "EXPIRED").length,
      validationFailures: count((x) => x.validation === "failed"),
      timeouts: count((x) => x.provider_status === "timeout"),
    },
    rates: {
      acceptance: p.length ? applied / p.length : null,
      undo: applied ? undos / applied : null,
      fallback: d.length ? count((x) => x.provider_status !== "ok" && x.provider_status !== "skipped") / d.length : null,
    },
    latency: {
      p50: percentile(d.map((x) => x.total_latency_ms).filter((v): v is number => typeof v === "number"), 50),
      p95: percentile(d.map((x) => x.total_latency_ms).filter((v): v is number => typeof v === "number"), 95),
      providerP50: percentile(d.map((x) => x.provider_latency_ms).filter((v): v is number => typeof v === "number"), 50),
    },
    cost: {
      totalProvider: Math.round(totalCost * 1e8) / 1e8,
      perAcceptedChange: applied ? Math.round((totalCost / applied) * 1e8) / 1e8 : null,
      currency: "USD",
      inputTokens: d.reduce((s, x) => s + (x.input_tokens ?? 0), 0),
      outputTokens: d.reduce((s, x) => s + (x.output_tokens ?? 0), 0),
    },
    byTask,
    outcomesByDay: [...days.entries()].map(([day, v]) => ({ day, ...v })),
    unsupportedRequests: count((x) => x.outcome_reason === "unsupported_task" || x.outcome_reason === "unsupported_expertise"),
    pinConflicts: count((x) => x.outcome_reason === "pin_conflict"),
    grants: {
      active: g.filter((x) => !x.revoked_at).length,
      revoked: g.filter((x) => x.revoked_at).length,
      clients: [...clientUsers.entries()].map(([clientName, s]) => ({ clientName, users: s.size })),
    },
    recentAudit: a.slice(0, 15).map((x) => ({ kind: x.kind, createdAt: x.created_at, ref: x.ref })),
    revenue: {
      creditsGranted: cr.length,
      creditsConsumed: cr.filter((x) => x.status === "consumed").length,
      ordersPending: (orders.data ?? []).filter((x) => x.status === "pending").length,
    },
  };
}
