/**
 * Integration tests for Contour's OAuth 2.1 authorization server and the
 * authenticated MCP endpoint. Runs against a live server:
 *
 *   CONTOUR_TEST_URL=http://localhost:3000 pnpm exec vitest run tests/oauth-mcp.test.ts
 *
 * Requires .env.local (Supabase URL + publishable key for the password
 * sign-in, the secret key for test-only DB manipulation such as expiring a
 * token, and CONTOUR_CSRF_SECRET for the host revoke endpoint) and the seeded
 * demo users alex@contour.demo (acme), taylor@contour.demo (globex) and
 * morgan@contour.demo (acme operator).
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });

const BASE = (process.env.CONTOUR_TEST_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = "contour-demo-2026";
const ALEX = "alex@contour.demo";
const TAYLOR = "taylor@contour.demo";
const MORGAN = "morgan@contour.demo";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let RESOURCE = "";
let ISSUER = "";
let PRM_URL = "";

// ------------------------------------------------------------------ helpers

const b64url = (b: Buffer) => b.toString("base64url");
const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

function pkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

type Session = { cookie: string; subjectId: string };
const sessions = new Map<string, Session>();

/** Signs in with Supabase password grant and returns the @supabase/ssr cookies. */
async function signIn(email: string): Promise<Session> {
  const cached = sessions.get(email);
  if (cached) return cached;
  const jar = new Map<string, string>();
  const supa = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { data, error } = await supa.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.user) throw new Error(`Sign-in failed for ${email}: ${error?.message ?? "no user"} (are the demo users seeded?)`);
  await new Promise((r) => setTimeout(r, 50));
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const s = { cookie, subjectId: data.user.id };
  sessions.set(email, s);
  return s;
}

async function register(redirectUri = "http://127.0.0.1:53682/callback", extra: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/api/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Contour integration test",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...extra,
    }),
  });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

type AuthParams = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource?: string;
  scope?: string;
  state?: string;
  response_type?: string;
  code_challenge_method?: string;
};

function authorizeParams(p: AuthParams): Record<string, string> {
  const out: Record<string, string> = {
    response_type: p.response_type ?? "code",
    client_id: p.client_id,
    redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge,
    code_challenge_method: p.code_challenge_method ?? "S256",
    resource: p.resource ?? RESOURCE,
    state: p.state ?? "st-" + randomUUID(),
  };
  if (p.scope !== undefined) out.scope = p.scope;
  return out;
}

async function getAuthorize(params: Record<string, string>, cookie?: string) {
  return fetch(`${BASE}/oauth/authorize?${new URLSearchParams(params)}`, {
    redirect: "manual",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function consent(params: Record<string, string>, session: Session, decision = "approve", extra: [string, string][] = []) {
  const page = await getAuthorize(params, session.cookie);
  expect(page.status).toBe(200);
  const html = await page.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  expect(csrf, "consent page renders a CSRF token").toBeTruthy();
  const form = new URLSearchParams({ ...params, csrf: csrf!, decision });
  for (const [k, v] of extra) form.append(k, v);
  const res = await fetch(`${BASE}/oauth/authorize/decision`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: session.cookie, Origin: BASE },
    body: form,
  });
  return { res, html, location: res.headers.get("location") };
}

async function token(form: Record<string, string>) {
  const res = await fetch(`${BASE}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  return { res, body: (await res.json()) as Record<string, string | number> };
}

type Flow = { clientId: string; redirectUri: string; accessToken: string; refreshToken: string; scope: string };

async function fullFlow(email: string, opts: { scope?: string; clientId?: string; redirectUri?: string } = {}): Promise<Flow> {
  const session = await signIn(email);
  const redirectUri = opts.redirectUri ?? "http://127.0.0.1:53682/callback";
  const clientId = opts.clientId ?? ((await register(redirectUri)).body.client_id as string);
  const { verifier, challenge } = pkce();
  const params = authorizeParams({ client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, scope: opts.scope });
  const { res, location } = await consent(params, session);
  expect(res.status).toBe(303);
  const cb = new URL(location!);
  expect(cb.searchParams.get("state")).toBe(params.state);
  expect(cb.searchParams.get("iss")).toBe(ISSUER);
  const code = cb.searchParams.get("code")!;
  const t = await token({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource: RESOURCE,
  });
  expect(t.res.status, JSON.stringify(t.body)).toBe(200);
  return {
    clientId,
    redirectUri,
    accessToken: t.body.access_token as string,
    refreshToken: t.body.refresh_token as string,
    scope: t.body.scope as string,
  };
}

let rpcId = 1;
async function mcp(accessToken: string | null, method: string, params?: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, ...(params ? { params } : {}) }),
  });
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : null };
}

const callTool = (t: string, name: string, args: Record<string, unknown>) => mcp(t, "tools/call", { name, arguments: args });

async function grantIdForToken(accessToken: string): Promise<string> {
  const { data } = await admin.from("oauth_tokens").select("grant_id").eq("token_hash", sha256hex(accessToken)).single();
  return data!.grant_id as string;
}

function csrfFor(subjectId: string) {
  return createHmac("sha256", process.env.CONTOUR_CSRF_SECRET!).update(`csrf:${subjectId}`).digest("base64url");
}

// -------------------------------------------------------------------- tests

beforeAll(async () => {
  // Each run registers ~25 clients; reset the per-IP DCR/token limiter
  // buckets so repeated runs don't trip the production limits (60 DCR/hour).
  for (const prefix of ["dcr:", "token:", "revoke:"]) {
    await admin.from("rate_limits").delete().like("bucket", `${prefix}%`);
  }
  const prm = await fetch(`${BASE}/.well-known/oauth-protected-resource/api/mcp`);
  expect(prm.status).toBe(200);
  const body = await prm.json();
  RESOURCE = body.resource;
  ISSUER = body.authorization_servers[0];
  PRM_URL = `${new URL(RESOURCE).origin}/.well-known/oauth-protected-resource/api/mcp`;
}, 30_000);

describe("discovery", () => {
  it("serves protected resource metadata at the path-inserted and root well-known URLs", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await fetch(`${BASE}${path}`);
      expect(res.status).toBe(200);
      const m = await res.json();
      expect(m.resource).toBe(RESOURCE);
      expect(m.authorization_servers).toEqual([ISSUER]);
      expect(m.scopes_supported).toEqual(["view:read", "data:read", "view:propose"]);
      expect(m.bearer_methods_supported).toEqual(["header"]);
    }
    expect((await fetch(`${BASE}/.well-known/oauth-protected-resource/other`)).status).toBe(404);
  });

  it("serves RFC 8414 authorization server metadata", async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(m.issuer).toBe(ISSUER);
    expect(m.authorization_endpoint).toBe(`${ISSUER}/oauth/authorize`);
    expect(m.token_endpoint).toBe(`${ISSUER}/api/oauth/token`);
    expect(m.registration_endpoint).toBe(`${ISSUER}/api/oauth/register`);
    expect(m.revocation_endpoint).toBe(`${ISSUER}/api/oauth/revoke`);
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(m.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(m.client_id_metadata_document_supported).toBe(true);
    expect(m.authorization_response_iss_parameter_supported).toBe(true);
    expect(m.scopes_supported).not.toContain("view:commit");
  });

  it("returns 401 with a resource_metadata challenge when no token is presented", async () => {
    const { res, body } = await mcp(null, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate")!;
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${PRM_URL}"`);
    expect(challenge).not.toContain("error=");
    expect(body.error).toBeTruthy();
  });

  it("rejects GET/DELETE with 405 and foreign origins with 403", async () => {
    const g = await fetch(`${BASE}/api/mcp`);
    expect(g.status).toBe(405);
    expect(g.headers.get("allow")).toBe("POST");
    expect((await fetch(`${BASE}/api/mcp`, { method: "DELETE" })).status).toBe(405);
    const o = await mcp(null, "ping", undefined, { Origin: "https://evil.example" });
    expect(o.res.status).toBe(403);
  });
});

describe("dynamic client registration", () => {
  it("accepts loopback and https redirect URIs", async () => {
    for (const uri of ["http://localhost:4567/callback", "http://127.0.0.1:9999/cb", "https://client.example.com/oauth/callback"]) {
      const { res, body } = await register(uri);
      expect(res.status).toBe(201);
      expect(body.client_id).toMatch(/^ctr_dcr_/);
      expect(body.token_endpoint_auth_method).toBe("none");
      expect(body).not.toHaveProperty("client_secret");
    }
  });

  it("rejects non-loopback http, custom schemes, fragments and oversized bodies", async () => {
    for (const uri of ["http://evil.example/cb", "myapp://cb", "https://x.example/cb#frag", "javascript:alert(1)"]) {
      const { res, body } = await register(uri);
      expect(res.status).toBe(400);
      expect(body.error).toBe("invalid_redirect_uri");
    }
    const big = await fetch(`${BASE}/api/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://localhost/cb"], client_name: "x".repeat(20_000) }),
    });
    expect(big.status).toBe(413);
  });
});

describe("authorization endpoint", () => {
  it("sends signed-out users to /login with a relative next URL", async () => {
    const { body } = await register();
    const res = await getAuthorize(
      authorizeParams({ client_id: body.client_id as string, redirect_uri: "http://127.0.0.1:53682/callback", code_challenge: pkce().challenge }),
    );
    expect([302, 303, 307]).toContain(res.status);
    const loc = new URL(res.headers.get("location")!, BASE);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toMatch(/^\/oauth\/authorize\?/);
  });

  it("renders (does not redirect) for an unregistered redirect_uri or unknown client", async () => {
    const s = await signIn(ALEX);
    const { body } = await register();
    const bad = await getAuthorize(
      authorizeParams({ client_id: body.client_id as string, redirect_uri: "http://127.0.0.1:53682/other", code_challenge: pkce().challenge }),
      s.cookie,
    );
    expect(bad.status).toBe(200);
    expect(await bad.text()).toContain("not registered");
    const unknown = await getAuthorize(
      authorizeParams({ client_id: "ctr_dcr_doesnotexist000000", redirect_uri: "http://127.0.0.1:53682/callback", code_challenge: pkce().challenge }),
      s.cookie,
    );
    expect(unknown.status).toBe(200);
  });

  it("allows any port for a registered loopback redirect (RFC 8252)", async () => {
    const s = await signIn(ALEX);
    const { body } = await register("http://localhost/callback");
    const page = await getAuthorize(
      authorizeParams({ client_id: body.client_id as string, redirect_uri: "http://localhost:3118/callback", code_challenge: pkce().challenge }),
      s.cookie,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('name="csrf"');
  });

  it("requires PKCE S256 and the exact MCP resource (errors go back to the client)", async () => {
    const s = await signIn(ALEX);
    const redirectUri = "http://127.0.0.1:53682/callback";
    const { body } = await register(redirectUri);
    const clientId = body.client_id as string;
    const cases: [Partial<AuthParams>, string][] = [
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge: "" }, "invalid_request"],
      [{ resource: "https://evil.example/api/mcp" }, "invalid_target"],
      [{ resource: `${RESOURCE}/other` }, "invalid_target"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ scope: "view:commit" }, "invalid_scope"],
    ];
    for (const [override, expected] of cases) {
      const params = authorizeParams({ client_id: clientId, redirect_uri: redirectUri, code_challenge: pkce().challenge, ...override });
      const res = await getAuthorize(params, s.cookie);
      expect([302, 303, 307], JSON.stringify(override)).toContain(res.status);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.origin + loc.pathname).toBe(redirectUri);
      expect(loc.searchParams.get("error"), JSON.stringify(override)).toBe(expected);
      expect(loc.searchParams.get("state")).toBe(params.state);
      expect(loc.searchParams.get("iss")).toBe(ISSUER);
    }
    const noResource = authorizeParams({ client_id: clientId, redirect_uri: redirectUri, code_challenge: pkce().challenge });
    delete noResource.resource;
    const r = await getAuthorize(noResource, s.cookie);
    expect(new URL(r.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
  });

  it("rejects a consent POST without a valid CSRF token or from another origin", async () => {
    const s = await signIn(ALEX);
    const redirectUri = "http://127.0.0.1:53682/callback";
    const { body } = await register(redirectUri);
    const params = authorizeParams({ client_id: body.client_id as string, redirect_uri: redirectUri, code_challenge: pkce().challenge });
    const post = (headers: Record<string, string>, csrf: string) =>
      fetch(`${BASE}/oauth/authorize/decision`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: s.cookie, ...headers },
        body: new URLSearchParams({ ...params, csrf, decision: "approve" }),
      });
    expect((await post({ Origin: BASE }, "forged")).status).toBe(403);
    expect((await post({ Origin: "https://evil.example" }, csrfFor(s.subjectId))).status).toBe(403);
    expect((await post({}, csrfFor(s.subjectId))).status).toBe(403);
  });

  it("deny redirects with access_denied", async () => {
    const s = await signIn(ALEX);
    const redirectUri = "http://127.0.0.1:53682/callback";
    const { body } = await register(redirectUri);
    const params = authorizeParams({ client_id: body.client_id as string, redirect_uri: redirectUri, code_challenge: pkce().challenge });
    const { res, location } = await consent(params, s, "deny");
    expect(res.status).toBe(303);
    expect(new URL(location!).searchParams.get("error")).toBe("access_denied");
  });

  it("resolves Claude Code's Client ID Metadata Document (CIMD)", async () => {
    const s = await signIn(ALEX);
    const res = await getAuthorize(
      authorizeParams({
        client_id: "https://claude.ai/oauth/claude-code-client-metadata",
        redirect_uri: "http://localhost:3118/callback",
        code_challenge: pkce().challenge,
      }),
      s.cookie,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Claude Code");
    expect(html).toContain("claude.ai");
    expect(html).toContain('name="csrf"');
  }, 20_000);
});

describe("token endpoint and MCP happy path", () => {
  let flow: Flow;
  beforeAll(async () => {
    flow = await fullFlow(ALEX);
  }, 60_000);

  it("issues bearer + refresh tokens with agent scopes only", () => {
    expect(flow.accessToken).toMatch(/^ctr_at_/);
    expect(flow.refreshToken).toMatch(/^ctr_rt_/);
    expect(flow.scope.split(" ").sort()).toEqual(["data:read", "view:propose", "view:read"]);
  });

  it("initialize / tools/list / describe_surface over MCP (legacy era)", async () => {
    const init = await mcp(flow.accessToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(init.res.status).toBe(200);
    expect(init.body.result.protocolVersion).toBe("2025-06-18");
    expect(init.body.result.serverInfo).toEqual({ name: "contour", version: "0.3.0" });
    expect(init.body.result.capabilities.tools).toEqual({ listChanged: false });
    expect(init.res.headers.get("mcp-session-id")).toBeNull();

    const unknownVersion = await mcp(flow.accessToken, "initialize", { protocolVersion: "1999-01-01", capabilities: {} });
    expect(unknownVersion.body.result.protocolVersion).toBe("2025-11-25");

    const note = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${flow.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe("");

    const list = await mcp(flow.accessToken, "tools/list");
    const names = list.body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["describe_surface", "get_view", "propose_view", "read_component_data"]);
    for (const t of list.body.result.tools) {
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.inputSchema.properties.surfaceId.enum).toEqual(["overview"]);
      expect(t.annotations.destructiveHint).toBe(false);
    }

    const d = await callTool(flow.accessToken, "describe_surface", { surfaceId: "overview" });
    expect(d.res.status).toBe(200);
    expect(d.body.result.isError).toBeFalsy();
    expect(d.body.result.structuredContent.surfaceId).toBe("overview");
    expect(d.body.result.structuredContent.grantedScopes).not.toContain("view:commit");
    expect(JSON.parse(d.body.result.content[0].text).surfaceId).toBe("overview");
  });

  it("read_component_data and get_view work; reader output is labelled untrusted", async () => {
    const r = await callTool(flow.accessToken, "read_component_data", { surfaceId: "overview", readerId: "alerts.active" });
    expect(r.body.result.isError, JSON.stringify(r.body)).toBeFalsy();
    expect(r.body.result.structuredContent.untrustedContent).toBe(true);
    const g = await callTool(flow.accessToken, "get_view", { surfaceId: "overview" });
    expect(g.body.result.isError, JSON.stringify(g.body)).toBeFalsy();
    expect(typeof g.body.result.structuredContent.snapshot.revision).toBe("number");
  });

  it("supports modern (2026-07-28) stateless requests with mirrored headers", async () => {
    const meta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    };
    const ok = await mcp(
      flow.accessToken,
      "tools/call",
      { name: "describe_surface", arguments: { surfaceId: "overview" }, _meta: meta },
      { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "describe_surface" },
    );
    expect(ok.res.status).toBe(200);
    expect(ok.body.result.resultType).toBe("complete");
    expect(ok.body.result.structuredContent.surfaceId).toBe("overview");

    const mismatch = await mcp(
      flow.accessToken,
      "tools/call",
      { name: "describe_surface", arguments: { surfaceId: "overview" }, _meta: meta },
      { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "get_view" },
    );
    expect(mismatch.res.status).toBe(400);
    expect(mismatch.body.error.code).toBe(-32020);

    const unsupported = await mcp(
      flow.accessToken,
      "server/discover",
      { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "2030-01-01" } },
      { "MCP-Protocol-Version": "2030-01-01", "Mcp-Method": "server/discover" },
    );
    expect(unsupported.res.status).toBe(400);
    expect(unsupported.body.error.code).toBe(-32022);
    expect(unsupported.body.error.data.supported).toContain("2026-07-28");

    const discover = await mcp(flow.accessToken, "server/discover", { _meta: meta }, {
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "server/discover",
    });
    expect(discover.body.result.supportedVersions).toContain("2026-07-28");
    expect(discover.body.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("contour");

    // Regression (found with Claude Code 2.1.288): modern list results must carry caching hints.
    const list = await mcp(flow.accessToken, "tools/list", { _meta: meta }, { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" });
    expect(list.res.status).toBe(200);
    expect(list.body.result.resultType).toBe("complete");
    expect(typeof list.body.result.ttlMs).toBe("number");
    expect(["public", "private"]).toContain(list.body.result.cacheScope);
    expect(list.body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(["describe_surface", "get_view", "propose_view", "read_component_data"]);
  });

  it("ignores spoofed identity: extra tenant/subject arguments are rejected by the closed schema", async () => {
    const r = await callTool(flow.accessToken, "describe_surface", {
      surfaceId: "overview",
      tenantId: "globex",
      subjectId: "00000000-0000-0000-0000-000000000000",
    });
    expect(r.res.status).toBe(200);
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.structuredContent.error.code).toBe("INVALID_INPUT");
    const s = await callTool(flow.accessToken, "describe_surface", { surfaceId: "billing" });
    expect(s.body.result.isError).toBe(true);
    const p = await callTool(flow.accessToken, "propose_view", { surfaceId: "overview", baseRevision: 0, commit: true });
    expect(p.body.result.isError).toBe(true);
    expect(p.body.result.structuredContent.error.code).toBe("INVALID_INPUT");
  });

  it("does not expose commit/reset tools", async () => {
    const r = await callTool(flow.accessToken, "commit_view", { surfaceId: "overview" });
    expect(r.body.error.code).toBe(-32602);
  });

  it("refresh rotates; reusing a rotated refresh token revokes the grant", async () => {
    const f = await fullFlow(ALEX);
    const r1 = await token({ grant_type: "refresh_token", refresh_token: f.refreshToken, client_id: f.clientId, resource: RESOURCE });
    expect(r1.res.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.res.headers.get("cache-control")).toBe("no-store");
    expect(r1.body.refresh_token).not.toBe(f.refreshToken);
    expect((await mcp(r1.body.access_token as string, "tools/list")).res.status).toBe(200);

    const reuse = await token({ grant_type: "refresh_token", refresh_token: f.refreshToken, client_id: f.clientId });
    expect(reuse.res.status).toBe(400);
    expect(reuse.body.error).toBe("invalid_grant");
    // The whole grant is now revoked: the fresh access token and refresh token are dead.
    expect((await mcp(r1.body.access_token as string, "tools/list")).res.status).toBe(401);
    const after = await token({ grant_type: "refresh_token", refresh_token: r1.body.refresh_token as string, client_id: f.clientId });
    expect(after.body.error).toBe("invalid_grant");
  });
});

describe("token endpoint negative cases", () => {
  async function codeFor(email = ALEX, scope?: string) {
    const s = await signIn(email);
    const redirectUri = "http://127.0.0.1:53682/callback";
    const clientId = (await register(redirectUri)).body.client_id as string;
    const { verifier, challenge } = pkce();
    const params = authorizeParams({ client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, scope });
    const { location } = await consent(params, s);
    return { clientId, redirectUri, verifier, code: new URL(location!).searchParams.get("code")! };
  }

  it("rejects a wrong PKCE verifier (and the code is then spent)", async () => {
    const c = await codeFor();
    const bad = await token({
      grant_type: "authorization_code",
      code: c.code,
      redirect_uri: c.redirectUri,
      client_id: c.clientId,
      code_verifier: pkce().verifier,
    });
    expect(bad.res.status).toBe(400);
    expect(bad.body.error).toBe("invalid_grant");
    const retry = await token({ grant_type: "authorization_code", code: c.code, redirect_uri: c.redirectUri, client_id: c.clientId, code_verifier: c.verifier });
    expect(retry.body.error).toBe("invalid_grant");
  });

  it("rejects a reused code and revokes tokens issued from it", async () => {
    const c = await codeFor();
    const form = { grant_type: "authorization_code", code: c.code, redirect_uri: c.redirectUri, client_id: c.clientId, code_verifier: c.verifier };
    const first = await token(form);
    expect(first.res.status).toBe(200);
    const second = await token(form);
    expect(second.res.status).toBe(400);
    expect(second.body.error).toBe("invalid_grant");
    expect((await mcp(first.body.access_token as string, "tools/list")).res.status).toBe(401);
  });

  it("rejects a mismatched resource, redirect_uri or client_id", async () => {
    const c1 = await codeFor();
    const r1 = await token({
      grant_type: "authorization_code",
      code: c1.code,
      redirect_uri: c1.redirectUri,
      client_id: c1.clientId,
      code_verifier: c1.verifier,
      resource: "https://evil.example/api/mcp",
    });
    expect(r1.body.error).toBe("invalid_target");

    const c2 = await codeFor();
    const r2 = await token({
      grant_type: "authorization_code",
      code: c2.code,
      redirect_uri: "http://127.0.0.1:1/callback",
      client_id: c2.clientId,
      code_verifier: c2.verifier,
    });
    expect(r2.body.error).toBe("invalid_grant");

    const c3 = await codeFor();
    const other = (await register()).body.client_id as string;
    const r3 = await token({ grant_type: "authorization_code", code: c3.code, redirect_uri: c3.redirectUri, client_id: other, code_verifier: c3.verifier });
    expect(r3.body.error).toBe("invalid_grant");
  });

  it("rejects client secrets and unsupported grant types", async () => {
    const r = await token({ grant_type: "client_credentials", client_id: "ctr_dcr_whatever0000" });
    expect(r.body.error).toBe("unsupported_grant_type");
    const s = await token({ grant_type: "authorization_code", client_id: "x", client_secret: "y", code: "z" });
    expect(s.res.status).toBe(401);
    expect(s.body.error).toBe("invalid_client");
  });

  it("never grants view:commit, even when requested alongside agent scopes", async () => {
    const f = await fullFlow(ALEX, { scope: "view:read view:commit" });
    expect(f.scope).toBe("view:read");
    const { data } = await admin.from("oauth_tokens").select("scopes").eq("token_hash", sha256hex(f.accessToken)).single();
    expect(data!.scopes).toEqual(["view:read"]);
    // A view:read-only token gets 403 insufficient_scope for data reads (MCP step-up).
    const r = await callTool(f.accessToken, "read_component_data", { surfaceId: "overview", readerId: "alerts.active" });
    expect(r.res.status).toBe(403);
    const ch = r.res.headers.get("www-authenticate")!;
    expect(ch).toContain('error="insufficient_scope"');
    expect(ch).toContain('scope="data:read"');
    expect(ch).toContain("resource_metadata=");
  });
});

describe("bearer token validation on /api/mcp", () => {
  it("rejects garbage, expired and wrong-audience tokens with 401 invalid_token", async () => {
    const garbage = await mcp("ctr_at_not-a-real-token-value-000000000000", "tools/list");
    expect(garbage.res.status).toBe(401);
    expect(garbage.res.headers.get("www-authenticate")).toContain('error="invalid_token"');

    const f = await fullFlow(ALEX);
    expect((await mcp(f.accessToken, "tools/list")).res.status).toBe(200);
    await admin
      .from("oauth_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("token_hash", sha256hex(f.accessToken));
    const expired = await mcp(f.accessToken, "tools/list");
    expect(expired.res.status).toBe(401);
    expect(expired.res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(expired.res.headers.get("www-authenticate")).toContain(`resource_metadata="${PRM_URL}"`);

    // A token minted for a different resource (audience) is refused.
    const g = await fullFlow(ALEX);
    const grantId = await grantIdForToken(g.accessToken);
    const { data: grant } = await admin.from("oauth_grants").select("grant_revision").eq("id", grantId).single();
    const foreign = `ctr_at_${b64url(randomBytes(32))}`;
    const ins = await admin.from("oauth_tokens").insert({
      token_hash: sha256hex(foreign),
      grant_id: grantId,
      kind: "access",
      resource: "https://other-service.example/api/mcp",
      scopes: ["view:read"],
      grant_revision: grant!.grant_revision,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(ins.error).toBeNull();
    const wrongAud = await mcp(foreign, "tools/list");
    expect(wrongAud.res.status).toBe(401);

    // A refresh token is not an access token.
    expect((await mcp(g.refreshToken, "tools/list")).res.status).toBe(401);
  }, 60_000);

  it("re-consent bumps grant_revision and invalidates earlier tokens", async () => {
    const first = await fullFlow(ALEX);
    const second = await fullFlow(ALEX, { clientId: first.clientId, redirectUri: first.redirectUri });
    expect((await mcp(first.accessToken, "tools/list")).res.status).toBe(401);
    expect((await mcp(second.accessToken, "tools/list")).res.status).toBe(200);
  }, 60_000);

  it("user revocation from the host app kills the grant immediately", async () => {
    const f = await fullFlow(ALEX);
    const s = await signIn(ALEX);
    const grantId = await grantIdForToken(f.accessToken);
    // Without CSRF: refused.
    const noCsrf = await fetch(`${BASE}/api/host/agents/${grantId}/revoke`, { method: "POST", headers: { Cookie: s.cookie, Origin: BASE } });
    expect(noCsrf.status).toBe(403);
    // Another user cannot revoke Alex's grant.
    const t = await signIn(TAYLOR);
    const foreign = await fetch(`${BASE}/api/host/agents/${grantId}/revoke`, {
      method: "POST",
      headers: { Cookie: t.cookie, Origin: BASE, "x-contour-csrf": csrfFor(t.subjectId) },
    });
    expect(foreign.status).toBe(404);
    expect((await mcp(f.accessToken, "tools/list")).res.status).toBe(200);

    const ok = await fetch(`${BASE}/api/host/agents/${grantId}/revoke`, {
      method: "POST",
      headers: { Cookie: s.cookie, Origin: BASE, "x-contour-csrf": csrfFor(s.subjectId) },
    });
    expect(ok.status).toBe(200);
    expect((await mcp(f.accessToken, "tools/list")).res.status).toBe(401);
    const r = await token({ grant_type: "refresh_token", refresh_token: f.refreshToken, client_id: f.clientId });
    expect(r.body.error).toBe("invalid_grant");
  }, 60_000);

  it("RFC 7009 revocation endpoint revokes an access token", async () => {
    const f = await fullFlow(TAYLOR);
    const res = await fetch(`${BASE}/api/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: f.accessToken, client_id: f.clientId, token_type_hint: "access_token" }),
    });
    expect(res.status).toBe(200);
    expect((await mcp(f.accessToken, "tools/list")).res.status).toBe(401);
    // Unknown tokens are not an error (RFC 7009 §2.2).
    const unknown = await fetch(`${BASE}/api/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: "nope" }),
    });
    expect(unknown.status).toBe(200);
  }, 60_000);

  it("taylor (globex) gets a globex-scoped context; alex's tokens never resolve to globex", async () => {
    const f = await fullFlow(TAYLOR);
    const grantId = await grantIdForToken(f.accessToken);
    const { data } = await admin.from("oauth_grants").select("tenant_id, subject_id").eq("id", grantId).single();
    expect(data!.tenant_id).toBe("globex");
    expect(data!.subject_id).toBe((await signIn(TAYLOR)).subjectId);
    const d = await callTool(f.accessToken, "describe_surface", { surfaceId: "overview", tenantId: "acme" });
    expect(d.body.result.isError).toBe(true);
  }, 60_000);
});

describe("operator kill switch", () => {
  it("only operators may revoke all grants for their tenant + app", async () => {
    const victim = await fullFlow(ALEX);
    const globex = await fullFlow(TAYLOR);
    const a = await signIn(ALEX);
    const denied = await fetch(`${BASE}/api/console/revoke-grants`, {
      method: "POST",
      headers: { Cookie: a.cookie, Origin: BASE, "x-contour-csrf": csrfFor(a.subjectId) },
    });
    expect(denied.status).toBe(403);
    expect((await mcp(victim.accessToken, "tools/list")).res.status).toBe(200);

    let m: Session;
    try {
      m = await signIn(MORGAN);
    } catch {
      console.warn("morgan@contour.demo not available; skipping operator half of the kill-switch test");
      return;
    }
    const ok = await fetch(`${BASE}/api/console/revoke-grants`, {
      method: "POST",
      headers: { Cookie: m.cookie, Origin: BASE, "x-contour-csrf": csrfFor(m.subjectId) },
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.tenantId).toBe("acme");
    expect((await mcp(victim.accessToken, "tools/list")).res.status).toBe(401);
    // Other tenants are unaffected.
    expect((await mcp(globex.accessToken, "tools/list")).res.status).toBe(200);
  }, 90_000);
});
