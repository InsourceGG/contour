import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Owner } from "../src/core/broker";
import { defineContourServer, supabaseStore } from "../src/server";

const owner: Owner = { tenantId: "t1", appId: "app", subjectId: "s1", surfaceId: "surface" };

/** Records every table and RPC the store touches. */
function recordingClient() {
  const touched: string[] = [];
  const rpcArgs: Record<string, unknown>[] = [];
  const client = {
    schema: () => ({
      from: (table: string) => {
        touched.push(`from:${table}`);
        throw new Error(`unexpected table read: ${table}`);
      },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        touched.push(`rpc:${fn}`);
        rpcArgs.push(args);
        return { data: { ok: true, proposalId: "p1" }, error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, touched, rpcArgs };
}

const base = { schema: "s", agentAccessEnabled: async () => true };

describe("supabaseStore billing", () => {
  it("none: reserve, release and balance never touch the database", async () => {
    const { client, touched } = recordingClient();
    const store = supabaseStore({ ...base, client, billing: "none" });
    expect(await store.reserveCredit(owner, "job")).toEqual({ ok: true, creditId: null, status: "unmetered" });
    expect(await store.releaseCredit("job")).toMatchObject({ ok: true });
    expect(await store.creditBalance(owner)).toEqual({ available: null, reserved: 0, consumed: 0, unmetered: true });
    expect(touched).toEqual([]);
  });

  it("none: createProposal sends billing: none", async () => {
    const { client, rpcArgs } = recordingClient();
    await supabaseStore({ ...base, client, billing: "none" }).createProposal({ request_id: "r" });
    expect(rpcArgs[0]).toEqual({ p: { request_id: "r", billing: "none" } });
  });

  it("credits (default): reserve and release use the RPCs and the payload has no billing key", async () => {
    const { client, touched, rpcArgs } = recordingClient();
    const store = supabaseStore({ ...base, client });
    await store.reserveCredit(owner, "job");
    await store.releaseCredit("job");
    await store.createProposal({ request_id: "r" });
    expect(touched).toEqual(["rpc:contour_reserve_credit", "rpc:contour_release_credit", "rpc:contour_create_proposal"]);
    expect(rpcArgs[2]).toEqual({ p: { request_id: "r" } });
  });

  it("defineContourServer passes billing through to its store", async () => {
    const { client, touched } = recordingClient();
    const server = defineContourServer({
      appUrl: "http://localhost",
      appId: "app",
      resourceName: "App",
      surfaces: ["surface"],
      db: client,
      schema: "s",
      csrfSecret: "x".repeat(32),
      billing: "none",
      identity: { currentUser: async () => null, loginUrl: (n) => n, getMembership: async () => null },
      agentAccessEnabled: async () => true,
    });
    expect(await server.store.reserveCredit(owner, "job")).toMatchObject({ status: "unmetered" });
    expect(touched).toEqual([]);
  });
});
