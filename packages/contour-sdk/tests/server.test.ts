import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdaptiveBroker } from "../src/core/broker";
import { ContourError } from "../src/core/types";
import {
  createContourHandlers,
  defineContourServer,
  isPrivateAddress,
  PinnedFetchError,
  pinnedFetchJson,
  type ContourServerConfig,
  type HostUser,
} from "../src/server";

const USER: HostUser = {
  subjectId: "11111111-1111-1111-1111-111111111111",
  sessionId: "sess-1",
  tenantId: "acme",
  role: "member",
  roleVersion: 3,
  displayName: "Alex",
  email: "alex@example.test",
};

/** Config whose database is never reachable: these tests only cover pure paths. */
function config(over: Partial<ContourServerConfig> = {}): ContourServerConfig {
  return {
    appUrl: "https://app.example.test",
    appId: "demo-app",
    resourceName: "Demo resource",
    surfaces: ["overview"],
    get db(): SupabaseClient {
      throw new Error("database must not be touched");
    },
    schema: "public",
    csrfSecret: "test-secret-0123456789abcdef0123456789",
    identity: {
      currentUser: async () => USER,
      loginUrl: (next) => `/login?next=${encodeURIComponent(next)}`,
      getMembership: async () => null,
    },
    agentAccessEnabled: async () => true,
    ...over,
  };
}

describe("defineContourServer", () => {
  it("derives issuer and resource from appUrl at call time", () => {
    let appUrl = "https://one.example.test/";
    const cfg = config();
    Object.defineProperty(cfg, "appUrl", { get: () => appUrl });
    const server = defineContourServer(cfg);
    expect(server.oauth.protectedResourceMetadata()).toEqual({
      resource: "https://one.example.test/api/mcp",
      authorization_servers: ["https://one.example.test"],
      scopes_supported: ["view:read", "data:read", "view:propose"],
      bearer_methods_supported: ["header"],
      resource_name: "Demo resource",
    });
    appUrl = "https://two.example.test";
    const as = server.oauth.authorizationServerMetadata() as Record<string, unknown>;
    expect(as.issuer).toBe("https://two.example.test");
    expect(as.token_endpoint).toBe("https://two.example.test/api/oauth/token");
    expect(as.scopes_supported).not.toContain("view:commit");
  });

  it("binds CSRF to the session and rejects cross-origin requests", () => {
    const server = defineContourServer(config());
    const token = server.oauth.csrfTokenFor(USER);
    expect(token).not.toBe(server.oauth.csrfTokenFor({ ...USER, sessionId: "sess-2" }));
    const req = (origin: string | null, csrf: string) =>
      new Request("https://app.example.test/api/host/view/undo", {
        method: "POST",
        headers: { ...(origin ? { origin } : {}), "x-contour-csrf": csrf },
      });
    expect(() => server.assertCsrf(req("https://app.example.test", token), USER)).not.toThrow();
    expect(() => server.assertCsrf(req("https://evil.example.test", token), USER)).toThrow(ContourError);
    expect(() => server.assertCsrf(req(null, token), USER)).toThrow(ContourError);
    expect(() => server.assertCsrf(req("https://app.example.test", "wrong"), USER)).toThrow(ContourError);
  });

  it("builds host contexts from the verified user, never from the request", () => {
    const server = defineContourServer(config());
    const vc = server.contextFromUser(USER);
    expect(vc).toMatchObject({ subjectId: USER.subjectId, tenantId: "acme", appId: "demo-app", surfaceId: "overview", channel: "host", roleVersion: "3" });
    expect(vc.scopes.has("view:commit")).toBe(true);
  });

  it("redirects a signed-out consent POST to the host login", async () => {
    const server = defineContourServer(config({ identity: { ...config().identity, currentUser: async () => null } }));
    const res = await server.oauth.decision(
      new Request("https://app.example.test/oauth/authorize/decision", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://app.example.test" },
        body: "client_id=abc&state=s",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/login?next=${encodeURIComponent("/oauth/authorize?client_id=abc&state=s")}`);
  });

  it("shows the no-membership error when identity throws FORBIDDEN", async () => {
    const server = defineContourServer(
      config({
        identity: {
          ...config().identity,
          currentUser: async () => {
            throw new ContourError("FORBIDDEN", "No active membership for this app");
          },
        },
      }),
    );
    const res = await server.oauth.decision(
      new Request("https://app.example.test/oauth/authorize/decision", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "client_id=abc",
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("createContourHandlers", () => {
  const broker = {} as AdaptiveBroker;

  it("serves RFC 9728 / RFC 8414 metadata at the root and the /api/mcp suffix only", async () => {
    const h = createContourHandlers(defineContourServer(config()), { broker });
    const at = (path?: string[]) => ({ params: Promise.resolve({ path }) });
    const root = await h["GET /.well-known/oauth-protected-resource"](new Request("https://x/"), at(undefined));
    expect(root.status).toBe(200);
    expect((await root.json()).resource).toBe("https://app.example.test/api/mcp");
    const suffixed = await h["GET /.well-known/oauth-authorization-server"](new Request("https://x/"), at(["api", "mcp"]));
    expect((await suffixed.json()).issuer).toBe("https://app.example.test");
    const other = await h["GET /.well-known/oauth-protected-resource"](new Request("https://x/"), at(["other"]));
    expect(other.status).toBe(404);
    expect((await h["OPTIONS /api/oauth/token"](new Request("https://x/"))).status).toBe(204);
    expect((await h["GET /api/mcp"](new Request("https://x/"))).status).toBe(405);
  });

  it("serves contour-project.json only when the project ID and nonce are configured", async () => {
    const server = defineContourServer(config());
    const off = createContourHandlers(server, { broker });
    expect((await off["GET /.well-known/contour-project.json"](new Request("https://x/"))).status).toBe(404);
    const on = createContourHandlers(server, { broker, projectId: "prj_123", wellKnownNonce: "nonce-abc" });
    const res = await on["GET /.well-known/contour-project.json"](new Request("https://x/"));
    expect(await res.json()).toEqual({
      projectId: "prj_123",
      nonce: "nonce-abc",
      agentApiResource: "https://app.example.test/api/mcp",
      authorizationServer: "https://app.example.test",
    });
  });

  it("answers MCP without a bearer token with 401 and the resource metadata challenge", async () => {
    const h = createContourHandlers(defineContourServer(config()), { broker });
    const res = await h["POST /api/mcp"](
      new Request("https://app.example.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://app.example.test/.well-known/oauth-protected-resource/api/mcp"',
    );
  });
});

describe("pinnedFetchJson", () => {
  it("classifies private and public addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
      expect(isPrivateAddress(a, 4)).toBe(true);
    }
    for (const a of ["::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"]) expect(isPrivateAddress(a, 6)).toBe(true);
    expect(isPrivateAddress("93.184.216.34", 4)).toBe(false);
    expect(isPrivateAddress("2606:4700::1111", 6)).toBe(false);
  });

  it("refuses non-https URLs and hosts that resolve to private addresses", async () => {
    const reason = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof PinnedFetchError ? e.reason : "other"));
    expect(await reason(pinnedFetchJson("http://example.com/x", { maxBytes: 1024, timeoutMs: 1000 }))).toBe("invalid_url");
    expect(await reason(pinnedFetchJson("https://localhost/x", { maxBytes: 1024, timeoutMs: 1000 }))).toBe("private_address");
    expect(await reason(pinnedFetchJson("https://127.0.0.1/x", { maxBytes: 1024, timeoutMs: 1000 }))).toBe("private_address");
    expect(await reason(pinnedFetchJson("https://[::1]/x", { maxBytes: 1024, timeoutMs: 1000 }))).toBe("private_address");
  });
});
