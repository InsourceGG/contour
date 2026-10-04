import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_SCOPES, ALL_SCOPES, ContourError, createAdaptiveBroker, defineAdaptiveApp, hashJson, type ContourStore, type JsonValue, type Proposal, type StoredJob, type StoredView, type VerifiedContext } from "@contour/sdk/core";
import { runContractKit } from "@contour/sdk/testing";

/**
 * Isolated fixture for the Northwind Contour integration: no network, no
 * database, no real preferences. Data functions, the users table, and the
 * settings row are in-memory fixtures.
 */

const fx = vi.hoisted(() => ({
  users: [] as { id: string; email: string; name: string; role: string; team: string; role_version: number }[],
  settings: null as { agent_access_enabled: boolean } | null,
  settingsError: false,
  calls: [] as { fn: string; session: unknown; options?: unknown }[],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("../src/lib/session", () => ({ getSession: async () => null }));
vi.mock("../src/lib/db", () => ({
  getDb: () => ({ from: () => {
    let rows = [...fx.users];
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { rows = rows.filter((row) => (row as Record<string, unknown>)[key] === value); return chain; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    };
    return chain;
  } }),
}));
vi.mock("../src/contour/db", () => ({
  getAppDb: () => ({ schema: () => ({ from: () => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      maybeSingle: async () => fx.settingsError ? { data: null, error: { message: "down" } }
        : { data: filters.tenant_id === "northwind" && filters.app_id === "northwind" ? fx.settings : null, error: null },
    };
    return chain;
  } }) }),
}));

const long = (n: number) => "x".repeat(n);
vi.mock("../src/data/tickets", () => ({
  getTickets: async (session: unknown, options: unknown) => {
    fx.calls.push({ fn: "getTickets", session, options });
    return Array.from({ length: 45 }, (_, i) => ({
      id: `t${i}`, number: 1000 + i, subject: long(300), description: "private description", status: "open", priority: "high", team: "Tier 1",
      customerId: "c1", customerName: "Ada Customer", customerCompany: "Acme", assigneeId: null, assigneeName: null,
      createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", dueAt: "2026-10-02T00:00:00Z", channel: "email",
      email: "ada@customer.example",
    }));
  },
}));
vi.mock("../src/data/sla", () => ({
  getSlaBreaches: async (session: unknown) => {
    fx.calls.push({ fn: "getSlaBreaches", session });
    return Array.from({ length: 30 }, (_, i) => ({ ticketId: `t${i}`, ticketNumber: i, subject: long(200), customerName: "Ada Customer", team: "Tier 1", dueAt: "2026-10-02T00:00:00Z", minutesOverdue: 5 }));
  },
}));
vi.mock("../src/data/csat", () => ({
  getCsatTrend: async (session: unknown, options: unknown) => {
    fx.calls.push({ fn: "getCsatTrend", session, options });
    return Array.from({ length: 40 }, (_, i) => ({ date: `2026-09-${String(i % 30 + 1).padStart(2, "0")}`, score: 90, responses: 3, team: "Tier 1" }));
  },
}));
vi.mock("../src/data/workload", () => ({
  getWorkload: async (session: unknown) => {
    fx.calls.push({ fn: "getWorkload", session });
    return Array.from({ length: 60 }, (_, i) => ({ userId: `u${i}`, name: long(100), team: "Tier 1", open: 1, pending: 2, capacity: 12 }));
  },
}));
vi.mock("../src/data/kb", () => ({
  getKbArticles: async (session: unknown, options: unknown) => {
    fx.calls.push({ fn: "getKbArticles", session, options });
    return Array.from({ length: 25 }, (_, i) => ({ id: `kb${i}`, title: long(200), summary: long(500), body: "internal body", topic: long(100), team: "Tier 1", readMinutes: 4, updatedAt: "2026-10-01T00:00:00Z" }));
  },
}));
vi.mock("../src/data/timeline", () => ({
  getCustomerTimeline: async (session: unknown, options: unknown) => {
    fx.calls.push({ fn: "getCustomerTimeline", session, options });
    return Array.from({ length: 30 }, (_, i) => ({
      id: `e${i}`, customerId: "c1", customerName: "Ada Customer", customerCompany: "Acme", ticketId: "t1", ticketNumber: 1000,
      team: "Tier 1", kind: i % 2 === 0 ? "note" : "reply", description: long(500), createdAt: "2026-10-01T00:00:00Z",
    }));
  },
}));

const { manifest, policy, readers, componentIds } = await import("../src/contour/index");
const { identity, agentAccessEnabled, sessionForContext } = await import("../src/contour/identity");

const RILEY = { id: "riley", email: "riley@northwind.demo", name: "Riley Chen", role: "agent", team: "Tier 1", role_version: 1 };
const CASEY = { id: "casey", email: "casey@northwind.demo", name: "Casey Morgan", role: "lead", team: "Tier 2", role_version: 1 };

function context(overrides: Partial<VerifiedContext> = {}): VerifiedContext {
  return {
    subjectId: "riley", tenantId: "northwind", appId: "northwind", surfaceId: "desk", clientId: "agent-client",
    grantRevision: "1", scopes: new Set(AGENT_SCOPES), roleVersion: "1", role: "agent", channel: "mcp", ...overrides,
  };
}
const host = (subjectId = "riley", roleVersion = "1") => context({ subjectId, clientId: "host", grantRevision: "host-session", scopes: new Set(ALL_SCOPES), channel: "host", roleVersion });

/** A minimal in-memory ContourStore with the same owner scoping and status rules as the SQL RPCs. */
function memoryStore(): ContourStore {
  const views = new Map<string, StoredView>();
  const proposals = new Map<string, Proposal & { requestHash: string }>();
  const jobs = new Map<string, StoredJob & { owner: string }>();
  let credits = 5;
  const key = (o: { tenantId: string; appId: string; subjectId: string; surfaceId: string }) => `${o.tenantId}|${o.appId}|${o.subjectId}|${o.surfaceId}`;
  const owned = (o: { tenantId: string; appId: string; subjectId: string; surfaceId: string }, p?: Proposal) => p && p.tenantId === o.tenantId && p.appId === o.appId && p.ownerSubjectId === o.subjectId && p.surfaceId === o.surfaceId ? p : null;
  return {
    getMembership: (s, t, a) => identity.getMembership(s, t, a),
    isAgentAccessEnabled: (t, a) => agentAccessEnabled(t, a),
    getActiveView: async (o) => views.get(key(o)) ?? null,
    getHistoryEntry: async () => null,
    listHistory: async () => [],
    getPreferences: async () => ({ pins: [] }),
    savePreferences: async () => {},
    getProposal: async (o, id) => owned(o, proposals.get(id)),
    findProposalByRequest: async (o, requestId) => [...proposals.values()].find((p) => owned(o, p) && p.requestId === requestId) ?? null,
    listProposals: async () => [],
    setProposalStatus: async (o, id, from, to) => {
      const p = owned(o, proposals.get(id));
      if (!p || p.status !== from) return false;
      p.status = to;
      return true;
    },
    createProposal: async (r) => {
      if (credits <= 0) return { ok: false, code: "PAYMENT_REQUIRED" };
      credits -= 1;
      const id = crypto.randomUUID();
      proposals.set(id, {
        id, ownerSubjectId: String(r.subject_id), tenantId: String(r.tenant_id), appId: String(r.app_id), surfaceId: String(r.surface_id),
        baseRevision: Number(r.base_revision), manifestVersion: String(r.manifest_version), policyVersion: String(r.policy_version),
        roleVersion: String(r.role_version), config: r.config as unknown as Proposal["config"], configHash: String(r.config_hash),
        expiresAt: String(r.expires_at), createdAt: new Date().toISOString(), status: "READY", decisionId: String(r.decision_id),
        requestId: String(r.request_id), candidateId: String(r.candidate_id), task: String(r.task), expertise: String(r.expertise),
        preferences: {}, changes: r.changes as unknown as Proposal["changes"], rationale: String(r.rationale), requestHash: String(r.request_hash),
      });
      return { ok: true, replayed: false, proposalId: id };
    },
    applyProposal: async (params: Record<string, JsonValue>) => {
      const o = { tenantId: String(params.tenant_id), appId: String(params.app_id), subjectId: String(params.subject_id), surfaceId: String(params.surface_id) };
      const p = owned(o, proposals.get(String(params.proposal_id)));
      if (!p) return { ok: false, code: "NOT_FOUND" };
      if (p.status !== "READY") return { ok: false, code: "PROPOSAL_NOT_READY", status: p.status };
      if (p.configHash !== params.config_hash) return { ok: false, code: "HASH_MISMATCH" };
      if (p.roleVersion !== String(params.role_version)) { p.status = "INVALID"; return { ok: false, code: "INCOMPATIBLE_MANIFEST" }; }
      const current = views.get(key(o))?.revision ?? 0;
      if (current !== p.baseRevision) { p.status = "STALE"; return { ok: false, code: "STALE_REVISION", currentRevision: current }; }
      views.set(key(o), { revision: current + 1, parentRevision: current, manifestVersion: p.manifestVersion, policyVersion: p.policyVersion, config: p.config, configHash: p.configHash });
      p.status = "APPLIED";
      return { ok: true, revision: current + 1, proposalId: p.id };
    },
    commitSnapshot: async () => ({ ok: false, code: "INVALID_INPUT" }),
    reserveCredit: async () => (credits > 0 ? { ok: true } : { ok: false, code: "PAYMENT_REQUIRED" }),
    releaseCredit: async () => ({ ok: true }),
    creditBalance: async () => ({ available: credits, reserved: 0, consumed: 0 }),
    recordDecision: async () => {},
    recordUsage: async () => {},
    listDecisions: async () => [],
    rateLimit: async () => true,
    createJob: async (o, input) => {
      const id = crypto.randomUUID();
      const at = new Date().toISOString();
      jobs.set(id, { id, owner: key(o), status: "working", task: input.task, expertise: input.expertise, changedComponents: [], message: null, startedAt: at, updatedAt: at, proposalId: null });
      return id;
    },
    updateJob: async (o, id, patch) => {
      const job = jobs.get(id);
      if (job && job.owner === key(o)) Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    },
    getLatestJob: async (o, sinceMs) => {
      const mine = [...jobs.values()].filter((j) => j.owner === key(o) && Date.parse(j.startedAt) >= sinceMs);
      const latest = mine.at(-1);
      if (!latest) return null;
      return { id: latest.id, status: latest.status, task: latest.task, expertise: latest.expertise, changedComponents: latest.changedComponents, message: latest.message, startedAt: latest.startedAt, updatedAt: latest.updatedAt, proposalId: latest.proposalId };
    },
  };
}

function fixtureBroker() {
  const registry = defineAdaptiveApp([manifest], { readerIds: new Set(readers.keys()), implementedComponentIds: componentIds });
  return createAdaptiveBroker({
    registry, policies: { desk: policy }, readers, store: memoryStore(), confidenceFloor: 0.6, appUrl: "http://localhost:3200",
    readerTimeoutMs: 5000, maxReaderOutputBytes: 64_000,
    // Fixture selector for isolated tests only; never a production fallback.
    selector: { provider: "fixture", select: async (input) => ({ status: "ok", choice: input.candidates[0].id, confidence: 0.9, modelVersion: "fixture", providerLatencyMs: 0 }) },
  });
}

const propose = (requestId: string, task = "triage_queue") => ({
  surfaceId: "desk", baseRevision: 0, task: { id: task, source: "explicit" }, expertise: { level: "new", source: "explicit" }, requestId,
});

beforeEach(() => {
  fx.users = [{ ...RILEY }, { ...CASEY }];
  fx.settings = { agent_access_enabled: true };
  fx.settingsError = false;
  fx.calls.length = 0;
});

describe("registration", () => {
  it("runs Contour unmetered (owner decision): no credits are required", async () => {
    const { contour } = await import("../src/contour/server");
    expect(contour.config.billing).toBe("none");
  });
  it("passes the SDK contract kit", async () => {
    const report = await runContractKit({ manifest, policy, readers, componentIds });
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.ok).toBe(true);
  });
  it("keeps SLA alerts locked and required and the queue required", () => {
    const spec = (id: string) => manifest.components.find((c) => c.id === id)!;
    expect([spec("sla-alerts").locked, spec("sla-alerts").required]).toEqual([true, true]);
    expect([spec("ticket-queue").locked, spec("ticket-queue").required]).toEqual([false, true]);
    expect(["csat-trend", "workload", "knowledge-base", "customer-timeline"].map((id) => spec(id).required)).toEqual([false, false, false, false]);
  });
});

describe("approved reader allowlist", () => {
  const read = (id: string, input: unknown = {}) => fixtureBroker().readComponentData(context(), id, input).then((r) => r.data as Record<string, Record<string, unknown>[]>);
  const keys = (rows: Record<string, unknown>[]) => [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();

  it("tickets.list projects only approved fields, caps rows and subjects, and passes the filter through", async () => {
    const data = await read("tickets.list", { filter: "mine" });
    expect(keys(data.tickets)).toEqual(["dueAt", "id", "number", "priority", "status", "subject"]);
    expect(data.tickets).toHaveLength(20);
    expect(data.tickets[0].subject).toHaveLength(160);
    expect(data.untrustedContent).toBe(true);
    expect(fx.calls[0].options).toEqual({ filter: "mine", limit: 20 });
    expect(JSON.stringify(data)).not.toMatch(/@|Ada Customer|private description/);
  });
  it("tickets.list accepts only 10, 20, or 40 rows", async () => {
    expect((await read("tickets.list", { limit: 40 })).tickets).toHaveLength(40);
    await expect(read("tickets.list", { limit: 41 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("sla.active caps 20 rows and 160-character subjects without customer names", async () => {
    const data = await read("sla.active");
    expect(keys(data.breaches)).toEqual(["dueAt", "minutesOverdue", "subject", "ticketId", "ticketNumber"]);
    expect(data.breaches).toHaveLength(20);
    expect(data.breaches[0].subject).toHaveLength(160);
  });
  it("csat.trend returns at most 30 points and defaults to 7d", async () => {
    const data = await read("csat.trend");
    expect(keys(data.points)).toEqual(["date", "responses", "score"]);
    expect(data.points).toHaveLength(30);
    expect(fx.calls[0].options).toEqual({ range: "7d" });
  });
  it("workload.team caps 50 rows and 80-character names", async () => {
    const data = await read("workload.team");
    expect(keys(data.workload)).toEqual(["capacity", "name", "open", "pending"]);
    expect(data.workload).toHaveLength(50);
    expect(data.workload[0].name).toHaveLength(80);
  });
  it("kb.articles caps rows and text and never returns article bodies", async () => {
    const data = await read("kb.articles");
    expect(keys(data.articles)).toEqual(["id", "readMinutes", "summary", "title", "topic"]);
    expect(data.articles).toHaveLength(20);
    expect([data.articles[0].title, data.articles[0].summary, data.articles[0].topic].map((v) => String(v).length)).toEqual([160, 400, 80]);
    expect(JSON.stringify(data)).not.toContain("internal body");
  });
  it("customers.timeline removes internal notes before the row cap and defaults to 10", async () => {
    const data = await read("customers.timeline");
    expect(keys(data.events)).toEqual(["createdAt", "description", "id", "kind", "ticketNumber"]);
    expect(data.events).toHaveLength(10);
    expect(data.events.every((event) => event.kind !== "note")).toBe(true);
    expect(data.events[0].description).toHaveLength(400);
    expect(JSON.stringify(data)).not.toContain("Ada Customer");
  });
  it("rejects unapproved input keys on every reader", async () => {
    for (const id of readers.keys()) {
      await expect(read(id, { customerId: "c1" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });
  it("rebuilds the session from the live user row, using the current team", async () => {
    fx.users[0].team = "Tier 2";
    await read("workload.team");
    expect(fx.calls[0].session).toEqual({ userId: "riley", email: "riley@northwind.demo", name: "Riley Chen", role: "agent", team: "Tier 2" });
  });
});

describe("identity and revocation", () => {
  it("refuses a stale role version, a deleted user, and another company", async () => {
    fx.users[0].role_version = 2;
    await expect(sessionForContext(context())).rejects.toMatchObject({ code: "FORBIDDEN" });
    fx.users = [];
    await expect(sessionForContext(context({ roleVersion: "2" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    fx.users = [{ ...RILEY }];
    await expect(sessionForContext(context({ tenantId: "other" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await identity.getMembership("riley", "other", "northwind")).toBeNull();
  });
  it("maps approved roles to data access and a deleted user to no membership", async () => {
    expect(await identity.getMembership("casey", "northwind", "northwind")).toMatchObject({ role: "lead", roleVersion: 1, status: "active", dataAccess: true });
    expect(await identity.getMembership("nobody", "northwind", "northwind")).toBeNull();
  });
  it("keeps login redirects on this origin", () => {
    expect(identity.loginUrl("//evil.example/x")).toBe("/login?next=%2Fdesk");
    expect(identity.loginUrl("/oauth/authorize?x=1")).toBe("/login?next=%2Foauth%2Fauthorize%3Fx%3D1");
  });
  it("treats the kill switch, a missing row, another app, and a lookup error as disabled", async () => {
    expect(await agentAccessEnabled("northwind", "northwind")).toBe(true);
    fx.settings = { agent_access_enabled: false };
    expect(await agentAccessEnabled("northwind", "northwind")).toBe(false);
    fx.settings = null;
    expect(await agentAccessEnabled("northwind", "northwind")).toBe(false);
    fx.settings = { agent_access_enabled: true };
    expect(await agentAccessEnabled("northwind", "other")).toBe(false);
    fx.settingsError = true;
    expect(await agentAccessEnabled("northwind", "northwind")).toBe(false);
  });
});

describe("authorized fixture flow", () => {
  it("describes, reads, proposes, previews, and applies only through the host", async () => {
    const broker = fixtureBroker();
    const described = await broker.describeSurface(context());
    expect(described.readers.map((r) => r.id).sort()).toEqual([...readers.keys()].sort());
    await broker.readComponentData(context(), "tickets.list", {});

    const result = await broker.proposeView(context(), propose("request-0001"));
    expect(result.outcome).toBe("READY");
    if (result.outcome !== "READY") return;
    expect(result.previewUrl).toBe(`http://localhost:3200/preview/${result.proposalId}`);

    const preview = await broker.getPreview(host(), result.proposalId);
    expect(preview.state).toBe("ready");
    expect(preview.proposed.templateId).toBe("focus-triage");

    const apply = { proposalId: result.proposalId, configHash: preview.proposal.configHash, idempotencyKey: "apply-0001" };
    await expect(broker.applyProposal(context(), apply)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(broker.applyProposal(context({ scopes: new Set(ALL_SCOPES) }), apply)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await broker.getSnapshot(host())).revision).toBe(0);

    expect(await broker.applyProposal(host(), apply)).toMatchObject({ ok: true, revision: 1 });
    const saved = await broker.getSnapshot(host());
    expect([saved.revision, saved.source, saved.config.templateId]).toEqual([1, "saved", "focus-triage"]);
    expect(saved.configHash).toBe(hashJson(preview.proposed));
  });

  it("Keep current leaves the saved view unchanged", async () => {
    const broker = fixtureBroker();
    const result = await broker.proposeView(context(), propose("request-0002", "review_quality"));
    if (result.outcome !== "READY") throw new Error(`expected READY, got ${result.outcome}`);
    expect(await broker.rejectProposal(host(), result.proposalId)).toEqual({ ok: true, status: "REJECTED" });
    const snapshot = await broker.getSnapshot(host());
    expect([snapshot.revision, snapshot.source]).toEqual([0, "default"]);
  });

  it("hides another user's proposal", async () => {
    const broker = fixtureBroker();
    const result = await broker.proposeView(context(), propose("request-0003"));
    if (result.outcome !== "READY") throw new Error("expected READY");
    await expect(broker.getPreview(host("casey"), result.proposalId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("invalidates a proposal after a role change and blocks the agent's next read", async () => {
    const broker = fixtureBroker();
    const result = await broker.proposeView(context(), propose("request-0004"));
    if (result.outcome !== "READY") throw new Error("expected READY");
    fx.users[0].role_version = 2;
    expect((await broker.getPreview(host("riley", "2"), result.proposalId)).state).toBe("invalid");
    await expect(broker.readComponentData(context(), "tickets.list", {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("turning the kill switch on disables agents, and turning it off restores them", async () => {
    const broker = fixtureBroker();
    fx.settings = { agent_access_enabled: false };
    for (const call of [
      () => broker.describeSurface(context()),
      () => broker.readComponentData(context(), "tickets.list", {}),
      () => broker.proposeView(context(), propose("request-0005")),
    ]) await expect(call()).rejects.toBeInstanceOf(ContourError);
    await expect(broker.describeSurface(context())).rejects.toMatchObject({ code: "AGENT_ACCESS_DISABLED" });
    // The host desk keeps working while agents are off.
    expect((await broker.getSnapshot(host())).source).toBe("default");
    fx.settings = { agent_access_enabled: true };
    await expect(broker.describeSurface(context())).resolves.toMatchObject({ surfaceId: "desk" });
  });

  it("removes data access for a role outside the approved set", async () => {
    fx.users[0].role = "contractor";
    await expect(fixtureBroker().readComponentData(context(), "tickets.list", {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
