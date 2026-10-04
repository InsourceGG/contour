import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Owner } from "../src/core/broker";
import { supabaseStore } from "../src/server/store/supabase-store";

const owner: Owner = { tenantId: "t1", appId: "app", subjectId: "subject-1", surfaceId: "overview" };
function setup(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const calls: [string, unknown[]][] = [];
  const chain: Record<string, unknown> = {};
  for (const operation of ["from", "select", "insert", "update", "eq", "gte", "order", "limit"]) {
    chain[operation] = (...args: unknown[]) => { calls.push([operation, args]); return chain; };
  }
  chain.maybeSingle = async () => result;
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  const client = { schema: () => chain } as unknown as SupabaseClient;
  return { calls, store: supabaseStore({ client, schema: "public", agentAccessEnabled: async () => true }) };
}

function expectOwnerFilters(calls: [string, unknown[]][]) {
  expect(calls).toContainEqual(["eq", ["tenant_id", owner.tenantId]]);
  expect(calls).toContainEqual(["eq", ["app_id", owner.appId]]);
  expect(calls).toContainEqual(["eq", ["subject_id", owner.subjectId]]);
  expect(calls).toContainEqual(["eq", ["surface_id", owner.surfaceId]]);
}

describe("supabaseStore live jobs", () => {
  it("creates a working job bound to the complete owner tuple", async () => {
    const { calls, store } = setup();
    const id = await store.createJob(owner, { clientId: "agent-1", task: "triage", expertise: "expert" });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls).toContainEqual(["insert", [expect.objectContaining({
      id, tenant_id: owner.tenantId, app_id: owner.appId, subject_id: owner.subjectId, surface_id: owner.surfaceId,
      client_id: "agent-1", task: "triage", expertise: "expert", status: "working",
    })]]);
  });

  it("limits job updates to the owner and converts the patch to database columns", async () => {
    const { calls, store } = setup();
    await store.updateJob(owner, "job-1", { status: "ready", proposalId: "proposal-1", changedComponents: ["tasks"], message: null });
    expectOwnerFilters(calls);
    expect(calls).toContainEqual(["eq", ["id", "job-1"]]);
    expect(calls).toContainEqual(["update", [expect.objectContaining({
      status: "ready", proposal_id: "proposal-1", changed_components: ["tasks"], message: null,
      updated_at: expect.any(String),
    })]]);
  });

  it("reads only the newest owner-scoped job within ten minutes and maps its presentation data", async () => {
    const started = new Date().toISOString();
    const { calls, store } = setup({ data: {
      id: "job-1", status: "ready", task: "triage", expertise: "expert", proposal_id: "proposal-1",
      changed_components: ["tasks"], message: null, started_at: started, updated_at: started,
    }, error: null });
    const before = Date.now();
    expect(await store.getLatestJob(owner, 0)).toEqual({
      id: "job-1", status: "ready", task: "triage", expertise: "expert", proposalId: "proposal-1",
      changedComponents: ["tasks"], message: null, startedAt: started, updatedAt: started,
    });
    expectOwnerFilters(calls);
    expect(calls).toContainEqual(["order", ["started_at", { ascending: false }]]);
    expect(calls).toContainEqual(["limit", [1]]);
    const since = calls.find(([op]) => op === "gte")![1][1] as string;
    expect(Date.parse(since)).toBeGreaterThanOrEqual(before - 10 * 60 * 1000);
  });

  it("swallows failed progress writes without logging database details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = setup({ data: null, error: { message: "secret-database-token" } });
    try {
      await expect(store.createJob(owner, { clientId: "agent-1", task: "triage", expertise: "expert" })).resolves.toMatch(/^[0-9a-f-]{36}$/);
      await expect(store.updateJob(owner, "job-1", { status: "failed" })).resolves.toBeUndefined();
      expect(log.mock.calls.flat().join(" ")).not.toContain("secret");
      await expect(store.getLatestJob(owner, Date.now())).rejects.toMatchObject({ code: "INTERNAL" });
    } finally { log.mockRestore(); }
  });

  it("also swallows network exceptions during writes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = { schema: () => { throw new Error("secret-network-token"); } } as unknown as SupabaseClient;
    const store = supabaseStore({ client, schema: "public", agentAccessEnabled: async () => true });
    try {
      await expect(store.createJob(owner, { clientId: "agent-1", task: "triage", expertise: "expert" })).resolves.toMatch(/^[0-9a-f-]{36}$/);
      await expect(store.updateJob(owner, "job-1", { status: "failed" })).resolves.toBeUndefined();
      expect(log.mock.calls.flat().join(" ")).not.toContain("secret");
    } finally { log.mockRestore(); }
  });
});
