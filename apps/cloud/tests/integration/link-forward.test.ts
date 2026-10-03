/**
 * Opt-in, request-only integration against the linked Supabase demo project.
 * Starts its own Cloud (:3100) and Acme (:3000) processes. No browser is opened.
 *
 * CLOUD_E2E=1 pnpm -F cloud exec vitest run tests/integration/link-forward.test.ts
 *
 * Requires Cloud's .env.local and the seeded alex@contour.demo account with
 * no available adaptation credits. Only isolated test fixtures are removed.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { request, type APIRequestContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLOUD = "http://localhost:3100";
const ACME = "http://localhost:3000";
const PASSWORD = "contour-demo-2026";
const cloudDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoDir = resolve(cloudDir, "../..");
const projectName = "Acme operations";
const consumers: { id: string; email: string; context: APIRequestContext }[] = [];
const contexts: APIRequestContext[] = [];
const servers: ChildProcess[] = [];
const cloudClients: string[] = [];
let acmeClientId: string | undefined;
let projectId: string | undefined;
let admin: SupabaseClient;
let anonymous: APIRequestContext;
let acme: APIRequestContext;
let consumerToken: string;
let outsiderToken: string;
let callbackUrl: string;
let acmeSubject: string;
let rpcId = 1;
let signupEmailFallbacks = 0;

// Keep secrets out of errors and child-process output. Environment files are
// read locally; neither their contents nor token responses are printed.
function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2];
    result[match[1]] = /^(["']).*\1$/.test(value)
      ? value.slice(1, -1)
      : value.replace(/\s+#.*$/, "");
  }
  return result;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function hidden(html: string, name: string): string {
  const tag = html.match(new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*>`, "i"))?.[0];
  const value = tag?.match(/\bvalue="([^"]*)"/)?.[1];
  if (value === undefined) throw new Error(`Expected a ${name} form field`);
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

async function context() {
  const ctx = await request.newContext({ timeout: 60_000 });
  contexts.push(ctx);
  return ctx;
}

async function assertFreePort(port: number) {
  await new Promise<void>((yes, no) => {
    const socket = createServer();
    socket.once("error", () => no(new Error(`Port ${port} is occupied; stop the existing app before CLOUD_E2E`)));
    socket.listen(port, () => socket.close(() => yes()));
  });
}

async function startServer(name: "cloud" | "ops-demo", env: NodeJS.ProcessEnv, base: string) {
  const child = spawn("pnpm", ["-F", name, "dev"], {
    cwd: repoDir, env, stdio: "ignore", detached: process.platform !== "win32",
  });
  servers.push(child);
  let launchError = false;
  child.once("error", () => { launchError = true; });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (launchError || child.exitCode !== null) throw new Error(`${name} server failed to start; run its dev command for diagnostics`);
    try {
      const response = await anonymous.get(`${base}/.well-known/oauth-authorization-server`, { timeout: 10_000 });
      if (response.status() === 200) return;
    } catch { /* The process has not begun listening yet. */ }
    await new Promise(done => setTimeout(done, 400));
  }
  throw new Error(`${name} server did not become ready within two minutes`);
}

async function findConsumer(email: string) {
  // The admin API offers pagination rather than email filtering. Return only
  // the exact fixture identity; never inspect or alter another user's data.
  for (let page = 1; page <= 20; page++) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error("Unable to look up the isolated signup fixture");
    const user = result.data.users.find(item => item.email === email);
    if (user) return user;
    if (result.data.users.length < 1000) break;
  }
  throw new Error("The signup route did not create the isolated consumer account");
}

async function signupConsumer() {
  const ctx = await context();
  const email = `cloud-e2e-${randomUUID()}@example.com`;
  const page = await ctx.get(`${CLOUD}/signup`);
  expect(page.status()).toBe(200);
  const signup = await ctx.post(`${CLOUD}/auth/password`, {
    maxRedirects: 0, headers: { Origin: CLOUD },
    form: { csrf: hidden(await page.text(), "csrf"), email, password: PASSWORD, mode: "signup", next: "/projects" },
  });
  expect(signup.status()).toBe(303);
  const signupLocation = new URL(signup.headers().location, CLOUD);
  if (signupLocation.searchParams.has("error")) {
    const reason = signupLocation.searchParams.get("error");
    // Hosted Supabase's outgoing-email quota can reject a valid signup before
    // creating its account. Generate a signup confirmation locally through the
    // admin API only for the route's explicit email-quota error. Permission,
    // validation, credentials and other provider failures must still fail.
    if (reason !== "email-rate") throw new Error(`Cloud signup failed: ${reason}`);
    const generated = await admin.auth.admin.generateLink({ type: "signup", email, password: PASSWORD });
    if (generated.error) throw new Error("Unable to generate the isolated signup confirmation fixture");
    signupEmailFallbacks++;
  }
  const user = await findConsumer(email);
  consumers.push({ id: user.id, email, context: ctx });
  // Real email delivery is outside this flow. Confirm this test-owned account
  // with the same admin API used by the seed script, then use app password auth.
  const confirmed = await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
  if (confirmed.error) throw new Error("Unable to confirm the isolated consumer fixture");
  const login = await ctx.get(`${CLOUD}/login`, { maxRedirects: 0 });
  if (login.status() === 200) {
    const signedIn = await ctx.post(`${CLOUD}/auth/password`, {
      maxRedirects: 0, headers: { Origin: CLOUD },
      form: { csrf: hidden(await login.text(), "csrf"), email, password: PASSWORD, mode: "login", next: "/projects" },
    });
    expect(signedIn.status()).toBe(303);
  }
  expect((await ctx.get(`${CLOUD}/projects`, { maxRedirects: 0 })).status()).toBe(200);
  return consumers[consumers.length - 1];
}

async function acmeSession(env: NodeJS.ProcessEnv) {
  const jar = new Map<string, string>();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: values => {
        for (const { name, value } of values) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const result = await supabase.auth.signInWithPassword({ email: "alex@contour.demo", password: PASSWORD });
  if (result.error || !result.data.user) throw new Error("Acme integration requires the seeded Alex demo account");
  acmeSubject = result.data.user.id;
  const ctx = await request.newContext({
    timeout: 60_000,
    storageState: {
      origins: [],
      cookies: [...jar].map(([name, value]) => ({
        name, value, domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" as const,
      })),
    },
  });
  contexts.push(ctx);
  return ctx;
}

async function approve(ctx: APIRequestContext, url: string, origin: string) {
  const params = Object.fromEntries(new URL(url).searchParams);
  const consent = await ctx.get(url, { maxRedirects: 0 });
  expect(consent.status()).toBe(200);
  const form = new URLSearchParams({ ...params, csrf: hidden(await consent.text(), "csrf"), decision: "approve", scope_choice: "1" });
  for (const scope of ["view:read", "data:read", "view:propose"]) form.append("grant_scope", scope);
  const response = await ctx.post(`${origin}/oauth/authorize/decision`, {
    maxRedirects: 0, headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, data: form.toString(),
  });
  expect(response.status()).toBe(303);
  const location = response.headers().location;
  if (!location) throw new Error("The consent decision did not return a callback");
  return new URL(location, origin).toString();
}

async function cloudToken(ctx: APIRequestContext) {
  const redirectUri = "http://127.0.0.1:53682/callback";
  let clientId: string | undefined;
  // The SDK migration is applied by a parallel task. If PostgREST has not
  // refreshed the cloud.oauth_clients table yet, wait briefly and retry.
  for (let attempt = 0; attempt < 12; attempt++) {
    const registered = await anonymous.post(`${CLOUD}/api/oauth/register`, { data: {
      client_name: "Cloud integration", redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
    } });
    if (registered.status() === 201) {
      clientId = (await registered.json()).client_id as string;
      break;
    }
    if (registered.status() < 500) throw new Error(`Cloud client registration failed with HTTP ${registered.status()}`);
    await new Promise(done => setTimeout(done, 1000));
  }
  if (!clientId) throw new Error("Cloud OAuth tables are unavailable; apply the SDK cloud schema migration and retry");
  cloudClients.push(clientId);
  const { verifier, challenge } = pkce();
  const state = randomUUID();
  const params = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: "S256", state,
    resource: `${CLOUD}/api/mcp`, scope: "view:read data:read view:propose",
  });
  const callback = new URL(await approve(ctx, `${CLOUD}/oauth/authorize?${params}`, CLOUD));
  expect(callback.searchParams.get("state")).toBe(state);
  expect(callback.searchParams.get("iss")).toBe(CLOUD);
  expect(callback.searchParams.has("code")).toBe(true);
  const exchange = await anonymous.post(`${CLOUD}/api/oauth/token`, { form: {
    grant_type: "authorization_code", client_id: clientId, code: callback.searchParams.get("code")!,
    redirect_uri: redirectUri, code_verifier: verifier, resource: `${CLOUD}/api/mcp`,
  } });
  expect(exchange.status()).toBe(200);
  const token = await exchange.json();
  expect(typeof token.access_token).toBe("string");
  expect(String(token.scope).split(" ").sort()).toEqual(["data:read", "view:propose", "view:read"]);
  return token.access_token as string;
}

async function tool(token: string, name: string, args: Record<string, unknown>) {
  const response = await anonymous.post(`${CLOUD}/api/mcp`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
    data: { jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Boolean(body.result)).toBe(true);
  return body.result as { isError?: boolean; structuredContent?: unknown; content: { type: string; text: string }[] };
}

function content(result: Awaited<ReturnType<typeof tool>>) {
  // MCP structuredContent must be an object, so the SDK wraps array results.
  // Its text content retains the original array/object consistently.
  return JSON.parse(result.content.find(item => item.type === "text")!.text);
}

describe.skipIf(process.env.CLOUD_E2E !== "1")("consumer link and forwarded MCP", () => {
  beforeAll(async () => {
    await assertFreePort(3100);
    await assertFreePort(3000);
    const opsEnv = readEnv(existsSync(resolve(repoDir, "apps/ops-demo/.env.local"))
      ? resolve(repoDir, "apps/ops-demo/.env.local")
      : resolve(repoDir, "../contour/apps/ops-demo/.env.local"));
    const cloudEnv: NodeJS.ProcessEnv = { ...opsEnv, ...process.env, ...readEnv(resolve(cloudDir, ".env.local")), APP_URL: CLOUD, CLOUD_CLIENT_MODE: "dcr", CLOUD_ALLOW_LOCAL_PROJECTS: "1" };
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "CLOUD_VAULT_KEY", "CONTOUR_CSRF_SECRET"]) {
      if (!cloudEnv[key]) throw new Error(`Cloud integration is missing ${key}`);
    }
    admin = createClient(cloudEnv.NEXT_PUBLIC_SUPABASE_URL!, cloudEnv.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    anonymous = await context();
    await startServer("cloud", cloudEnv, CLOUD);
    const owner = await signupConsumer();
    await signupConsumer();
    if (signupEmailFallbacks) console.info(`Cloud E2E: ${signupEmailFallbacks} fresh consumer signup fixtures used generated confirmation links because hosted email delivery was rate-limited.`);
    const ownerPage = await owner.context.get(`${CLOUD}/owner`);
    expect(ownerPage.status()).toBe(200);
    const created = await owner.context.post(`${CLOUD}/owner/create`, {
      maxRedirects: 0, headers: { Origin: CLOUD }, form: {
        csrf: hidden(await ownerPage.text(), "csrf"), name: projectName, company: "Acme",
        description: "Revenue, tasks and operations overview", base_url: ACME, surfaces: "overview",
      },
    });
    expect(created.status()).toBe(303);
    const project = await admin.schema("cloud").from("projects").select("id,verify_nonce,status")
      .eq("owner_id", owner.id).eq("name", projectName).single();
    if (project.error || !project.data) throw new Error("Owner create did not save the isolated project");
    projectId = project.data.id as string;
    expect(project.data.status).toBe("pending");
    const projectEnv: NodeJS.ProcessEnv = { ...cloudEnv, ...opsEnv, APP_URL: ACME, CONTOUR_PROJECT_ID: projectId, CONTOUR_PROJECT_NONCE: project.data.verify_nonce as string };
    await startServer("ops-demo", projectEnv, ACME);
    acme = await acmeSession(projectEnv);
    const verifyPage = await owner.context.get(`${CLOUD}/owner`);
    const verified = await owner.context.post(`${CLOUD}/owner/verify`, {
      maxRedirects: 0, headers: { Origin: CLOUD }, form: { csrf: hidden(await verifyPage.text(), "csrf"), project_id: projectId },
    });
    expect(verified.status()).toBe(303);
    const row = await admin.schema("cloud").from("projects").select("status,mcp_resource,as_issuer")
      .eq("id", projectId).eq("owner_id", owner.id).single();
    if (row.error || !row.data) throw new Error("Cannot inspect the isolated verified project");
    expect(row.data.status).toBe("verified");
    expect(row.data.mcp_resource).toBe(`${ACME}/api/mcp`);
    expect(row.data.as_issuer).toBe(ACME);
    const linkPage = await owner.context.get(`${CLOUD}/link/start?project=${projectId}`);
    expect(linkPage.status()).toBe(200);
    const started = await owner.context.post(`${CLOUD}/link/start`, {
      maxRedirects: 0, headers: { Origin: CLOUD }, form: { csrf_token: hidden(await linkPage.text(), "csrf_token"), project: projectId },
    });
    expect(started.status()).toBe(303);
    const authorizeUrl = new URL(started.headers().location);
    acmeClientId = authorizeUrl.searchParams.get("client_id")!;
    expect(acmeClientId.startsWith("ctr_dcr_")).toBe(true);
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("resource")).toBe(`${ACME}/api/mcp`);
    expect(authorizeUrl.searchParams.get("scope")).toBe("view:read data:read view:propose");
    callbackUrl = await approve(acme, authorizeUrl.toString(), ACME);
    expect(new URL(callbackUrl).searchParams.get("iss")).toBe(ACME);
    const linked = await owner.context.get(callbackUrl, { maxRedirects: 0 });
    expect(linked.status()).toBe(303);
    expect(new URL(linked.headers().location, CLOUD).searchParams.get("linked")).toBe(projectId);
    consumerToken = await cloudToken(owner.context);
    outsiderToken = await cloudToken(consumers[1].context);
    if (process.env.CLOUD_SCREENSHOTS === "1") {
      // Render a fresh consent request without issuing another code or grant.
      const consentUrl = new URL("/oauth/authorize", CLOUD);
      consentUrl.search = new URLSearchParams({
        response_type: "code", client_id: cloudClients[0],
        redirect_uri: "http://127.0.0.1:53682/callback", code_challenge: pkce().challenge,
        code_challenge_method: "S256", state: randomUUID(), resource: `${CLOUD}/api/mcp`,
        scope: "view:read data:read view:propose",
      }).toString();
      const { captureScreenshots } = await import("../../scripts/screenshots");
      await captureScreenshots({ signedIn: owner.context, projectId, consentUrl: consentUrl.toString(), appUrl: CLOUD });
    }
  }, 300_000);

  afterAll(async () => {
    const failed: string[] = [];
    try {
      if (admin) {
        // Remove only IDs created by this suite, in FK-safe order.
        for (const [schema, ids] of [["cloud", cloudClients], ["public", acmeClientId ? [acmeClientId] : []]] as const) {
          for (const id of ids) {
            const grants = await admin.schema(schema).from("oauth_grants").select("id").eq("client_id", id);
            if (grants.error) { failed.push(`${schema} grant lookup`); continue; }
            const grantIds = (grants.data ?? []).map(item => item.id as string);
            if (grantIds.length) {
              for (const table of ["oauth_tokens", "oauth_codes"]) {
                const result = await admin.schema(schema).from(table).delete().in("grant_id", grantIds);
                if (result.error) failed.push(`${schema} ${table}`);
              }
              const removed = await admin.schema(schema).from("oauth_grants").delete().in("id", grantIds);
              if (removed.error) failed.push(`${schema} grants`);
            }
            const removed = await admin.schema(schema).from("oauth_clients").delete().eq("client_id", id);
            if (removed.error) failed.push(`${schema} client`);
          }
        }
        if (projectId) {
          for (const table of ["link_states", "audit_events"]) {
            const result = await admin.schema("cloud").from(table).delete().eq("project_id", projectId);
            if (result.error) failed.push(table);
          }
          const project = await admin.schema("cloud").from("projects").delete().eq("id", projectId).eq("owner_id", consumers[0].id);
          if (project.error) failed.push("project");
        }
        for (const consumer of consumers) {
          const audit = await admin.schema("cloud").from("audit_events").delete().eq("contour_user", consumer.id);
          if (audit.error) failed.push("consumer audit");
          const removed = await admin.auth.admin.deleteUser(consumer.id);
          if (removed.error) failed.push("consumer");
        }
      }
    } finally {
      await Promise.all(contexts.map(ctx => ctx.dispose()));
      for (const child of servers.reverse()) {
        if (!child.pid || child.exitCode !== null) continue;
        try {
          if (process.platform === "win32") child.kill("SIGTERM");
          else process.kill(-child.pid, "SIGTERM");
        } catch { /* The process group has already exited. */ }
      }
    }
    if (failed.length) throw new Error(`Isolated integration cleanup failed: ${[...new Set(failed)].join(", ")}`);
  }, 60_000);

  it("lists only the consumer's linked project", async () => {
    const result = await tool(consumerToken, "list_projects", {});
    expect(Boolean(result.isError)).toBe(false);
    const projects = content(result);
    const items = Array.isArray(projects) ? projects : projects.projects;
    expect(items).toHaveLength(1);
    expect(items[0].projectId).toBe(projectId);
    expect(items[0].status).toBe("active");
  });

  it("describes Acme's surface through the single Cloud MCP endpoint", async () => {
    const result = await tool(consumerToken, "describe_surface", { projectId, surfaceId: "overview" });
    expect(Boolean(result.isError)).toBe(false);
    const surface = content(result);
    expect(surface.surfaceId).toBe("overview");
    expect(Array.isArray(surface.components)).toBe(true);
    expect((surface.components as unknown[]).length).toBeGreaterThan(0);
    expect(surface.grantedScopes).not.toContain("view:commit");
  });

  it("returns NOT_FOUND for a different consumer's project access", async () => {
    for (const [name, extra] of [
      ["describe_surface", {}], ["get_view", {}], ["read_component_data", { readerId: "alerts.active" }],
      ["propose_view", { baseRevision: 0, task: { id: "review_performance", source: "explicit" }, expertise: { level: "expert", source: "explicit" }, requestId: randomUUID() }],
    ] as const) {
      const result = await tool(outsiderToken, name, { projectId, surfaceId: "overview", ...extra });
      expect(result.isError).toBe(true);
      expect(content(result).error.code).toBe("NOT_FOUND");
    }
  });

  it("refuses a replayed link state and leaves the successful link active", async () => {
    const replay = await consumers[0].context.get(callbackUrl, { maxRedirects: 0 });
    const success = replay.status() === 303 && new URL(replay.headers().location, CLOUD).searchParams.has("linked");
    expect(success).toBe(false);
    expect([400, 403, 303]).toContain(replay.status());
    const row = await admin.schema("cloud").from("links").select("status")
      .eq("contour_user", consumers[0].id).eq("project_id", projectId!).single();
    expect(row.error).toBeNull();
    expect(row.data?.status).toBe("active");
  });

  it("preserves Acme's PAYMENT_REQUIRED code for a proposal with no credits", async () => {
    const balance = await admin.from("credits").select("id", { count: "exact", head: true })
      .eq("tenant_id", "acme").eq("app_id", "ops-demo").eq("subject_id", acmeSubject).eq("status", "available");
    if (balance.error) throw new Error("Unable to verify Acme's seeded no-credit fixture");
    if (balance.count !== 0) throw new Error("Alex has available adaptation credits; this test requires a no-credit seeded Alex account and does not change his billing data");
    const described = await tool(consumerToken, "describe_surface", { projectId, surfaceId: "overview" });
    expect(Boolean(described.isError)).toBe(false);
    const surface = content(described);
    const result = await tool(consumerToken, "propose_view", {
      projectId, surfaceId: "overview", baseRevision: surface.currentRevision,
      task: { id: "review_performance", source: "explicit" }, expertise: { level: "expert", source: "explicit" }, requestId: randomUUID(),
    });
    expect(result.isError).toBe(true);
    expect(content(result).error.code).toBe("PAYMENT_REQUIRED");
  });
});
