import { describe, expect, it } from "vitest";
import { overviewManifest as M } from "./fixtures/manifest";
import { overviewPolicy } from "./fixtures/policy";
import { createAdaptiveBroker, type ContourStore, type Membership, type RpcResult } from "../src/core/broker";
import { defineAdaptiveApp } from "../src/core/registry";
import { ALL_SCOPES, type VerifiedContext } from "../src/core/types";
import type { Selector } from "../src/core/broker";

// Billing mode lives in the store. An unmetered store answers reserveCredit
// with status "unmetered"; the broker must then reach READY without reserving,
// releasing or consuming a credit.

const READERS = new Set(["revenue.summary", "metrics.summary", "tasks.list", "activity.recent", "alerts.active"]);
const IMPL = new Set(["alerts", "tasks", "revenue", "metrics", "activity", "help"]);
const registry = defineAdaptiveApp([M], { readerIds: READERS, implementedComponentIds: IMPL });

const ctx: VerifiedContext = {
  subjectId: "subject-1",
  tenantId: "t1",
  appId: M.appId,
  surfaceId: M.surfaceId,
  clientId: "host",
  grantRevision: "1",
  scopes: new Set(ALL_SCOPES),
  roleVersion: "1",
  role: "member",
  channel: "host",
};

const selector: Selector = {
  provider: "fixture",
  async select() {
    return {
      status: "ok",
      choice: "dense",
      confidence: 0.95,
      distribution: { dense: 0.95 },
      modelVersion: "fixture-1",
      providerLatencyMs: 1,
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: null,
      currency: null,
    };
  },
};

function setup(reserve: RpcResult) {
  const calls: string[] = [];
  const created: Record<string, unknown>[] = [];
  const membership: Membership = {
    tenantId: "t1", subjectId: "subject-1", appId: M.appId, role: "member", roleVersion: 1,
    dataAccess: true, status: "active", displayName: "Sam",
  };
  const unused = async () => {
    throw new Error("not used in this test");
  };
  const store: ContourStore = {
    getMembership: async () => membership,
    isAgentAccessEnabled: async () => true,
    getActiveView: async () => null,
    getHistoryEntry: async () => null,
    listHistory: async () => [],
    getPreferences: async () => ({ pins: [] }),
    savePreferences: unused,
    getProposal: async () => null,
    createJob: async () => "00000000-0000-4000-8000-0000000000aa",
    updateJob: async () => {},
    getLatestJob: async () => null,
    findProposalByRequest: async () => null,
    listProposals: async () => [],
    setProposalStatus: async () => true,
    createProposal: async (record) => {
      calls.push("createProposal");
      created.push(record);
      return { ok: true, replayed: false, proposalId: "00000000-0000-4000-8000-000000000001" };
    },
    applyProposal: unused,
    commitSnapshot: unused,
    reserveCredit: async () => {
      calls.push("reserveCredit");
      return reserve;
    },
    releaseCredit: async () => {
      calls.push("releaseCredit");
      return { ok: true };
    },
    creditBalance: async () => ({ available: null, reserved: 0, consumed: 0, unmetered: true }),
    recordDecision: async () => {},
    recordUsage: async () => {},
    listDecisions: async () => [],
    rateLimit: async () => true,
  };
  const broker = createAdaptiveBroker({
    registry,
    policies: { [M.surfaceId]: overviewPolicy },
    readers: new Map(),
    store,
    selector,
    confidenceFloor: 0.7,
    appUrl: "http://localhost:3000",
  });
  return { broker, calls, created };
}

const request = (requestId: string) => ({
  surfaceId: M.surfaceId,
  baseRevision: 0,
  task: { id: "review_performance", source: "explicit" as const },
  expertise: { level: "expert", source: "explicit" as const },
  requestId,
});

describe("billing: none", () => {
  it("reaches READY with an unmetered store without consuming or releasing a credit", async () => {
    const { broker, calls, created } = setup({ ok: true, creditId: null, status: "unmetered" });
    const res = await broker.proposeView(ctx, request("req-unmetered-1"));
    expect(res.outcome).toBe("READY");
    if (res.outcome !== "READY") return;
    expect(res.creditConsumed).toBe(false);
    expect(created).toHaveLength(1);
    expect(calls).not.toContain("releaseCredit");
  });

  it("does not release anything when the proposal is not READY", async () => {
    const { broker, calls } = setup({ ok: true, creditId: null, status: "unmetered" });
    const res = await broker.proposeView(ctx, { ...request("req-unmetered-2"), task: { id: "unknown_task", source: "explicit" } });
    expect(res.outcome).toBe("ASK");
    expect(calls).not.toContain("releaseCredit");
  });

  it("creditBalance passes through the unmetered balance", async () => {
    const { broker } = setup({ ok: true, creditId: null, status: "unmetered" });
    expect(await broker.creditBalance(ctx)).toEqual({ available: null, reserved: 0, consumed: 0, unmetered: true });
  });
});

describe("billing: credits (default)", () => {
  it("still requires a credit: PAYMENT_REQUIRED when none can be reserved", async () => {
    const { broker, created } = setup({ ok: false, code: "PAYMENT_REQUIRED" });
    await expect(broker.proposeView(ctx, request("req-credits-1"))).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(created).toHaveLength(0);
  });

  it("reports the credit as consumed when one was reserved", async () => {
    const { broker } = setup({ ok: true, creditId: "c1", status: "reserved" });
    const res = await broker.proposeView(ctx, request("req-credits-2"));
    expect(res.outcome === "READY" && res.creditConsumed).toBe(true);
  });
});
