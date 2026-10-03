import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Membership } from "../src/core/broker";
import { defineContourServer, supabaseStore } from "../src/server";

const M: Membership = {
  tenantId: "t1",
  subjectId: "s1",
  appId: "app",
  role: "member",
  roleVersion: 4,
  dataAccess: true,
  status: "active",
  displayName: "Sam",
};

/** A client that records every table it is asked for. */
function recordingClient(row: Record<string, unknown> | null = null) {
  const tables: string[] = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  const client = {
    schema: () => ({
      from: (table: string) => {
        tables.push(table);
        return chain;
      },
    }),
  } as unknown as SupabaseClient;
  return { client, tables };
}

describe("supabaseStore membership", () => {
  it("delegates to a getMembership override and never queries memberships", async () => {
    const { client, tables } = recordingClient();
    const calls: unknown[][] = [];
    const store = supabaseStore({
      client,
      schema: "northwind",
      agentAccessEnabled: async () => true,
      getMembership: async (...args) => {
        calls.push(args);
        return M;
      },
    });
    expect(await store.getMembership("s1", "t1", "app")).toEqual(M);
    expect(calls).toEqual([["s1", "t1", "app"]]);
    expect(tables).toEqual([]);
  });

  it("passes a null from the override through without a table read", async () => {
    const { client, tables } = recordingClient();
    const store = supabaseStore({ client, schema: "x", agentAccessEnabled: async () => true, getMembership: async () => null });
    expect(await store.getMembership("s1", "t1", "app")).toBeNull();
    expect(tables).toEqual([]);
  });

  it("reads the memberships table in the store schema when there is no override", async () => {
    const { client, tables } = recordingClient({
      tenant_id: "t1",
      subject_id: "s1",
      app_id: "app",
      role: "member",
      role_version: 4,
      data_access: true,
      status: "active",
      display_name: "Sam",
    });
    const store = supabaseStore({ client, schema: "public", agentAccessEnabled: async () => true });
    expect(await store.getMembership("s1", "t1", "app")).toEqual(M);
    expect(tables).toEqual(["memberships"]);
  });

  it("defineContourServer builds its store on identity.getMembership", async () => {
    const { client, tables } = recordingClient();
    const server = defineContourServer({
      appUrl: "https://app.example.test",
      appId: "app",
      resourceName: "App",
      surfaces: ["overview"],
      db: client,
      schema: "northwind",
      csrfSecret: "test-secret-0123456789abcdef0123456789",
      identity: {
        currentUser: async () => null,
        loginUrl: (next) => `/login?next=${next}`,
        getMembership: async () => M,
      },
      agentAccessEnabled: async () => true,
    });
    expect(await server.store.getMembership("s1", "t1", "app")).toEqual(M);
    expect(tables).toEqual([]);
  });
});
