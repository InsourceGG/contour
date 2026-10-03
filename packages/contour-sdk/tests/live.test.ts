import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { overviewManifest as manifest } from "./fixtures/manifest";
import { overviewPolicy } from "./fixtures/policy";
import {
  createAdaptiveBroker,
  type ContourStore,
  type JobPatch,
  type Owner,
  type Selector,
  type SelectorResult,
  type StoredJob,
  type StoredView,
} from "../src/core/broker";
import { defineAdaptiveApp } from "../src/core/registry";
import { hashJson } from "../src/core/hash";
import { ALL_SCOPES, type JsonValue, type Proposal, type VerifiedContext } from "../src/core/types";

const registry = defineAdaptiveApp([manifest], {
  readerIds: new Set(["revenue.summary", "metrics.summary", "tasks.list", "activity.recent", "alerts.active"]),
  implementedComponentIds: new Set(manifest.components.map((c) => c.id)),
});
const now = new Date("2026-10-03T20:00:00Z");
const context: VerifiedContext = {
  tenantId: "tenant-1", appId: manifest.appId, subjectId: "subject-1", surfaceId: manifest.surfaceId,
  clientId: "agent-1", channel: "mcp", grantRevision: "1", scopes: new Set(ALL_SCOPES), roleVersion: "1", role: "member",
};
const host: VerifiedContext = { ...context, clientId: "host", channel: "host", scopes: new Set(["view:read"]) };
const request = () => ({
  surfaceId: manifest.surfaceId, baseRevision: 0, task: { id: "triage_work", source: "explicit" },
  expertise: { level: "expert", source: "explicit" }, requestId: randomUUID(),
});
const selected = (choice = "dense"): SelectorResult => ({
  status: "ok", choice, confidence: 0.95, modelVersion: "fixture", providerLatencyMs: 1,
});

function setup(selector: Selector = { provider: "fixture", select: async () => selected() }) {
  let job: StoredJob | null = null;
  let proposal: Proposal | null = null;
  let active: StoredView | null = null;
  const transitions: string[] = [];
  const jobs = vi.fn(async (_owner: Owner, input: { clientId: string; task: string; expertise: string }) => {
    job = {
      id: randomUUID(), status: "working", task: input.task, expertise: input.expertise, proposalId: null,
      changedComponents: [], message: null, startedAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    transitions.push(job.status);
    return job.id;
  });
  const updates = vi.fn(async (_owner: Owner, id: string, patch: JobPatch) => {
    if (job?.id === id) job = { ...job, ...patch };
    if (patch.status) transitions.push(patch.status);
  });
  const latest = vi.fn(async () => job);
  const reserve = vi.fn(async () => ({ ok: true }));
  const store: ContourStore = {
    getMembership: async () => ({
      tenantId: context.tenantId, subjectId: context.subjectId, appId: context.appId, role: "member", roleVersion: 1,
      status: "active", dataAccess: true, displayName: "Alex",
    }),
    isAgentAccessEnabled: async () => true,
    getActiveView: async () => active,
    getHistoryEntry: async () => null,
    listHistory: async () => [],
    getPreferences: async () => ({ pins: [] }),
    savePreferences: async () => {},
    getProposal: async (_owner, id) => proposal?.id === id ? proposal : null,
    createJob: jobs,
    updateJob: updates,
    getLatestJob: latest,
    findProposalByRequest: async () => null,
    listProposals: async () => proposal ? [proposal] : [],
    setProposalStatus: async (_owner, id, from, to) => {
      if (proposal?.id !== id || proposal.status !== from) return false;
      proposal.status = to;
      return true;
    },
    createProposal: async (record: Record<string, JsonValue>) => {
      proposal = {
        id: randomUUID(), tenantId: context.tenantId, appId: context.appId, ownerSubjectId: context.subjectId,
        surfaceId: context.surfaceId, baseRevision: Number(record.base_revision), roleVersion: String(record.role_version),
        manifestVersion: String(record.manifest_version), policyVersion: String(record.policy_version),
        config: record.config as unknown as Proposal["config"], configHash: String(record.config_hash), status: "READY",
        candidateId: String(record.candidate_id), task: String(record.task), expertise: String(record.expertise),
        preferences: {}, changes: record.changes as unknown as Proposal["changes"], rationale: String(record.rationale),
        expiresAt: String(record.expires_at), createdAt: now.toISOString(), decisionId: String(record.decision_id),
        requestId: String(record.request_id),
      };
      return { ok: true, proposalId: proposal.id };
    },
    applyProposal: async () => {
      if (!proposal) return { ok: false, code: "NOT_FOUND" };
      proposal.status = "APPLIED";
      active = {
        revision: 1, parentRevision: 0, manifestVersion: proposal.manifestVersion, policyVersion: proposal.policyVersion,
        config: proposal.config, configHash: proposal.configHash,
      };
      return { ok: true, revision: 1, proposalId: proposal.id };
    },
    commitSnapshot: async () => ({ ok: true }),
    reserveCredit: reserve,
    releaseCredit: vi.fn(async () => ({ ok: true })),
    creditBalance: async () => ({ available: 1, reserved: 0, consumed: 0 }),
    recordDecision: async () => {},
    recordUsage: async () => {},
    listDecisions: async () => [],
    rateLimit: vi.fn(async () => true),
  };
  const broker = createAdaptiveBroker({
    registry, store, selector, policies: { [manifest.surfaceId]: overviewPolicy }, readers: new Map(),
    confidenceFloor: 0.7, appUrl: "https://app.example.test", now: () => now,
  });
  return {
    broker, store, jobs, updates, latest, reserve, transitions,
    get job() { return job; }, get proposal() { return proposal; },
    set active(value: StoredView | null) { active = value; },
  };
}

describe("live proposal jobs", () => {
  it("creates working progress before reserving credit or calling the selector, then links READY", async () => {
    const s = setup({ provider: "fixture", select: async () => {
      expect(s.job?.status).toBe("working");
      expect((await s.broker.getLive(host)).proposal).toBeNull();
      return selected();
    } });
    const result = await s.broker.proposeView(context, request());
    expect(result.outcome).toBe("READY");
    expect(s.jobs.mock.invocationCallOrder[0]).toBeLessThan(s.reserve.mock.invocationCallOrder[0]);
    expect(s.jobs).toHaveBeenCalledWith(
      { tenantId: context.tenantId, appId: context.appId, subjectId: context.subjectId, surfaceId: context.surfaceId },
      { clientId: context.clientId, task: "triage_work", expertise: "expert" },
    );
    expect(s.transitions).toEqual(["working", "ready"]);
    expect(s.job?.proposalId).toBe(s.proposal?.id);
    const expectedChanges = manifest.components.filter((c) =>
      hashJson(manifest.defaultConfig.placements.find((p) => p.componentId === c.id)) !==
      hashJson(s.proposal!.config.placements.find((p) => p.componentId === c.id)),
    ).map((c) => c.id);
    expect(s.job?.changedComponents).toEqual(expectedChanges);
    expect(s.job?.changedComponents).not.toContain("alerts");
  });

  it.each([["KEEP", "kept"], ["ASK", "asked"]])("updates %s progress", async (choice, status) => {
    const s = setup({ provider: "fixture", select: async () => selected(choice) });
    expect((await s.broker.proposeView(context, request())).outcome).toBe(choice);
    expect(s.transitions).toEqual(["working", status]);
    expect(s.store.releaseCredit).toHaveBeenCalledOnce();
    expect(s.job?.proposalId).toBeNull();
  });

  it("does not create a job for invalid input, a stale revision, or deterministic clarification", async () => {
    const s = setup();
    await expect(s.broker.proposeView(context, {})).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.broker.proposeView(context, { ...request(), baseRevision: 2 })).rejects.toMatchObject({ code: "STALE_REVISION" });
    const result = await s.broker.proposeView(context, { ...request(), task: { id: "unsupported", source: "explicit" } });
    expect(result.outcome).toBe("ASK");
    expect(s.jobs).not.toHaveBeenCalled();
    expect(s.reserve).not.toHaveBeenCalled();
  });

  it("marks provider failures as failed while keeping the current view", async () => {
    const s = setup({ provider: "fixture", select: async () => ({ ...selected(), status: "error", error: "secret-provider-token" }) });
    expect((await s.broker.proposeView(context, request())).outcome).toBe("KEEP");
    expect(s.transitions).toEqual(["working", "failed"]);
    expect(s.job?.message).not.toContain("secret-provider-token");
  });

  it("marks thrown errors and unavailable credit as failed", async () => {
    const s = setup({ provider: "fixture", select: async () => { throw new Error("secret-provider-token"); } });
    await expect(s.broker.proposeView(context, request())).rejects.toThrow("secret-provider-token");
    expect(s.job?.status).toBe("failed");
    expect(s.job?.message).not.toContain("secret-provider-token");
    expect(s.store.releaseCredit).toHaveBeenCalledOnce();
    const unpaid = setup();
    unpaid.reserve.mockResolvedValueOnce({ ok: false });
    await expect(unpaid.broker.proposeView(context, request())).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(unpaid.transitions).toEqual(["working", "failed"]);
    expect(unpaid.store.releaseCredit).not.toHaveBeenCalled();
  });

  it("job diagnostics never break proposal generation or log thrown secrets", async () => {
    const s = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    s.jobs.mockRejectedValueOnce(new Error("secret-create-token"));
    s.updates.mockRejectedValueOnce(new Error("secret-update-token"));
    try {
      expect((await s.broker.proposeView(context, request())).outcome).toBe("READY");
      expect(log.mock.calls.flat().join(" ")).not.toContain("secret");
      expect(log).toHaveBeenCalledWith("[contour] createJob failed");
      expect(log).toHaveBeenCalledWith("[contour] updateJob failed");
    } finally { log.mockRestore(); }
  });
});

describe("getLive", () => {
  it("is host-only, requires view:read and rate-limits polling once per call", async () => {
    const s = setup();
    await expect(s.broker.getLive(context)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(s.broker.getLive({ ...host, scopes: new Set(["view:commit"]) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await s.broker.getLive(host)).toEqual({ revision: 0, configHash: hashJson(manifest.defaultConfig), job: null, proposal: null });
    expect(s.store.rateLimit).toHaveBeenCalledExactlyOnceWith(`live:${context.tenantId}:${context.subjectId}`, 60, 150);
    expect(s.latest).toHaveBeenCalledWith(expect.any(Object), now.getTime() - 10 * 60 * 1000);
    vi.mocked(s.store.rateLimit).mockResolvedValueOnce(false);
    await expect(s.broker.getLive(host)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("includes only a still READY proposal, and removes it after authenticated apply", async () => {
    const s = setup();
    await s.broker.proposeView(context, request());
    const live = await s.broker.getLive(host);
    expect(live.proposal?.state).toBe("ready");
    expect(live.proposal?.proposal.id).toBe(s.proposal?.id);
    expect(live.job).not.toHaveProperty("proposalId");
    await expect(s.broker.applyProposal(host, {
      proposalId: s.proposal!.id, configHash: s.proposal!.configHash, idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await s.broker.applyProposal({ ...host, scopes: new Set(ALL_SCOPES) }, {
      proposalId: s.proposal!.id, configHash: s.proposal!.configHash, idempotencyKey: randomUUID(),
    });
    expect(await s.broker.getLive(host)).toMatchObject({ revision: 1, proposal: null });
  });

  it.each(["APPLIED", "REJECTED", "EXPIRED", "STALE", "INVALID"] as const)("excludes %s proposals", async (status) => {
    const s = setup();
    await s.broker.proposeView(context, request());
    s.proposal!.status = status;
    expect((await s.broker.getLive(host)).proposal).toBeNull();
  });

  it.each(["expired", "stale", "invalid"])("revalidates %s READY proposals through getPreview", async (condition) => {
    const s = setup();
    await s.broker.proposeView(context, request());
    if (condition === "expired") s.proposal!.expiresAt = "2026-10-03T19:00:00Z";
    if (condition === "invalid") s.proposal!.configHash = "corrupt-hash";
    if (condition === "stale") s.active = {
      revision: 1, parentRevision: 0, config: manifest.defaultConfig, configHash: hashJson(manifest.defaultConfig),
      manifestVersion: manifest.manifestVersion, policyVersion: manifest.policyVersion,
    };
    expect((await s.broker.getLive(host)).proposal).toBeNull();
    expect(s.proposal!.status).toBe(condition.toUpperCase());
  });

  it("does not expose an older proposal when the most recent job was kept", async () => {
    const s = setup();
    await s.broker.proposeView(context, request());
    await s.store.updateJob({ tenantId: context.tenantId, appId: context.appId, subjectId: context.subjectId, surfaceId: context.surfaceId }, s.job!.id, { status: "kept" });
    expect((await s.broker.getLive(host)).proposal).toBeNull();
  });
});
