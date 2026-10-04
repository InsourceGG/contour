import { describe, expect, it } from "vitest";
import { overviewManifest as M } from "./fixtures/manifest";
import { overviewPolicy } from "./fixtures/policy";
import { createAdaptiveBroker, type ContourStore, type Membership } from "../src/core/broker";
import { hashJson } from "../src/core/hash";
import { defineAdaptiveApp } from "../src/core/registry";
import { ALL_SCOPES, type Proposal, type VerifiedContext } from "../src/core/types";

// Schema-template installs have no memberships table: the broker's fresh
// identity.getMembership role version travels in the RPC payload instead.

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
  roleVersion: "7",
  role: "member",
  channel: "host",
};

function setup() {
  const calls: { op: string; params: Record<string, unknown> }[] = [];
  const membership: Membership = {
    tenantId: "t1", subjectId: "subject-1", appId: M.appId, role: "member", roleVersion: 7,
    dataAccess: true, status: "active", displayName: "Sam",
  };
  const proposal = {
    id: "00000000-0000-4000-8000-000000000001",
    status: "APPLIED",
    roleVersion: "7",
    configHash: hashJson(M.defaultConfig),
  } as unknown as Proposal;
  const unused = async () => {
    throw new Error("not used in this test");
  };
  const store: ContourStore = {
    getMembership: async () => membership,
    isAgentAccessEnabled: async () => true,
    getActiveView: async () => ({
      revision: 1, parentRevision: 0, manifestVersion: M.manifestVersion, policyVersion: M.policyVersion,
      config: M.defaultConfig, configHash: hashJson(M.defaultConfig),
    }),
    getHistoryEntry: async (_o, revision) => ({
      revision, parentRevision: null, source: "default", proposalId: null, manifestVersion: M.manifestVersion,
      policyVersion: M.policyVersion, config: M.defaultConfig, configHash: hashJson(M.defaultConfig), createdAt: new Date().toISOString(),
    }),
    listHistory: async () => [],
    getPreferences: async () => ({ pins: [] }),
    savePreferences: unused,
    getProposal: async () => proposal,
    createJob: unused,
    updateJob: async () => {},
    getLatestJob: async () => null,
    findProposalByRequest: async () => null,
    listProposals: async () => [],
    setProposalStatus: async () => true,
    createProposal: unused,
    applyProposal: async (params) => {
      calls.push({ op: "apply", params });
      return { ok: true, revision: 2, proposalId: proposal.id };
    },
    commitSnapshot: async (params) => {
      calls.push({ op: String(params.operation), params });
      return { ok: true, revision: 2 };
    },
    reserveCredit: unused,
    releaseCredit: unused,
    creditBalance: async () => ({ available: 0, reserved: 0, consumed: 0 }),
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
    selector: { provider: "none", select: unused },
    confidenceFloor: 0.7,
    appUrl: "http://localhost:3000",
  });
  return { broker, calls, proposal };
}

describe("role_version in commit payloads", () => {
  it("applyProposal sends the fresh membership role version", async () => {
    const { broker, calls, proposal } = setup();
    await broker.applyProposal(ctx, { proposalId: proposal.id, configHash: proposal.configHash, idempotencyKey: "apply-key-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].params.role_version).toBe(7);
  });

  it("undo and reset send the fresh membership role version", async () => {
    const { broker, calls } = setup();
    await broker.undo(ctx, { expectedRevision: 1, idempotencyKey: "undo-key-1" });
    await broker.reset(ctx, { expectedRevision: 1, idempotencyKey: "reset-key-1" });
    expect(calls.map((c) => c.op)).toEqual(["undo", "reset"]);
    for (const c of calls) expect(c.params.role_version).toBe(7);
  });
});
