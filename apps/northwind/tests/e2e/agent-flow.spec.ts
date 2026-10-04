/**
 * Northwind + Contour, end to end against the running app and its real
 * database: live proposals on /desk (unmetered), the MCP auth challenge, OAuth
 * discovery, and a full agent connection (DCR, sign-in, consent, PKCE token,
 * MCP describe and propose) whose proposal appears live on Riley's desk.
 *
 * Gated: it signs in, writes proposals and saved views for riley@northwind.demo,
 * and registers an OAuth client, so it runs only when asked:
 *
 *   pnpm -F northwind dev            # http://localhost:3200, APP_URL=http://localhost:3200
 *   NORTHWIND_E2E=1 pnpm -F northwind test:e2e
 *
 * Needs apps/northwind/.env.local (CONTOUR_CSRF_SECRET to derive the host CSRF
 * token the page itself uses; AI_GATEWAY_API_KEY in the server for the real
 * selector). The real selector often answers in under a second, faster than
 * the desk's 1.2 s live poll, so start the server with the latency preload to
 * make WORKING observable (the gateway call and model decision stay real):
 *
 *   NODE_OPTIONS=--import=$PWD/apps/northwind/tests/e2e/support/slow-gateway.mjs JEV_TIMEOUT_MS=10000 pnpm -F northwind dev   # from the repo root
 *
 * Screenshots go to .screenshots/ (git-ignored).
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

test.skip(process.env.NORTHWIND_E2E !== "1", "Set NORTHWIND_E2E=1 to run against a live Northwind");
test.describe.configure({ mode: "serial" });

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const RILEY = "riley@northwind.demo";
const PASSWORD = "northwind-demo-2026";
const SHOTS = ".screenshots";
const REDIRECT_URI = "http://127.0.0.1:53682/callback";
mkdirSync(SHOTS, { recursive: true });

type Live = { revision: number; configHash: string; job: { status: string } | null; proposal: { proposal: { id: string; configHash: string } } | null };

async function signIn(page: Page) {
  await page.goto("/login");
  await page.fill("#email", RILEY);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL(/\/(desk|oauth\/authorize)/), page.locator('form button[type="submit"]').first().click()]);
}

/** The session-bound host CSRF token, derived exactly as the server derives it for this cookie. */
async function hostCsrf(context: BrowserContext) {
  const cookie = (await context.cookies()).find((c) => c.name === "nw_session")?.value;
  if (!cookie) throw new Error("Not signed in");
  const subjectId = JSON.parse(Buffer.from(cookie.split(".")[0], "base64url").toString("utf8")).userId as string;
  const sessionId = createHash("sha256").update(cookie).digest("hex");
  return createHmac("sha256", process.env.CONTOUR_CSRF_SECRET!).update(`csrf:${subjectId}:${sessionId}`).digest("base64url");
}

const live = (page: Page) => page.evaluate(async () => (await fetch("/api/host/live", { cache: "no-store" })).json()) as Promise<Live>;

/** Host-only reset to the company default, so a triage proposal is a real change on every run. */
async function resetView(page: Page, csrf: string) {
  const start = await live(page);
  const reset = await page.evaluate(async ({ csrf, expectedRevision, idempotencyKey }) => {
    const r = await fetch("/api/host/view/reset", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-contour-csrf": csrf },
      body: JSON.stringify({ expectedRevision, idempotencyKey }),
    });
    return { status: r.status, body: await r.text() };
  }, { csrf, expectedRevision: start.revision, idempotencyKey: `nw-e2e-reset-${randomUUID()}` });
  expect(reset.status, reset.body).toBe(200);
  await page.reload();
  await expect(page.locator(".contour-live")).toHaveAttribute("data-live-state", "idle");
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(() => page.locator(".cs-root").evaluate((root) =>
    [...root.querySelectorAll(".cs-slot")].flatMap((n) => n.getAnimations()).filter((a) => a.playState === "running").length)).toBe(0);
}

test("desk shows a host proposal live, unmetered, and Accept persists", async ({ page, context }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/desk/);
  await expect(page.locator(".cs-root")).toBeVisible();
  await expect(page.locator(".contour-live")).toHaveAttribute("data-live-state", "idle");

  const csrf = await hostCsrf(context);
  await resetView(page, csrf);
  const before = await live(page);
  const body = {
    surfaceId: "desk", baseRevision: before.revision,
    task: { id: "triage_queue", source: "explicit" }, expertise: { level: "new", source: "explicit" },
    requestId: `nw-e2e-${randomUUID()}`,
  };
  // Fire from the page context with the integration's CSRF header; do not await yet.
  await page.evaluate(({ body, csrf }) => {
    (window as unknown as { __propose: Promise<unknown> }).__propose = fetch("/api/host/proposals", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-contour-csrf": csrf },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  }, { body, csrf });

  // Working: the bar and skeletons appear without a reload.
  await expect(page.locator(".contour-live")).toHaveAttribute("data-live-state", "working", { timeout: 15_000 });
  await expect(page.getByTestId("live-status")).toContainText("preparing a view");
  await expect(page.getByTestId("live-skeleton").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/desk-working.png`, fullPage: true });

  const result = await page.evaluate(() => (window as unknown as { __propose: Promise<{ status: number; body: Record<string, unknown> }> }).__propose);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.outcome, JSON.stringify(result.body)).toBe("READY");
  expect(result.body.creditConsumed).toBe(false); // billing: "none"

  // Ready: the proposal in place with inline Accept / Keep current.
  await expect(page.locator(".contour-live")).toHaveAttribute("data-live-state", "ready");
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep current" })).toBeVisible();
  await settle(page);
  // The preview renders the proposal's own rows (its queue filter), not the current view's.
  const previewFilter = await page.locator('.filter-tabs [aria-current="page"]').textContent();
  const previewCount = await page.locator(".contour-live [class*='queue'] h2 + *, .contour-live .count-badge").first().textContent().catch(() => null);
  await page.screenshot({ path: `${SHOTS}/desk-ready.png`, fullPage: true });

  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page).toHaveURL(new RegExp(`/desk\\?applied=${before.revision + 1}`));
  await expect(page.getByText("Your new desk view is saved.")).toBeVisible();
  await expect(page.locator(".contour-live")).toHaveAttribute("data-live-state", "idle");
  const after = await live(page);
  expect(after.revision).toBe(before.revision + 1);
  await settle(page);
  await expect(page.locator('.filter-tabs [aria-current="page"]')).toHaveText(previewFilter ?? "");
  await page.screenshot({ path: `${SHOTS}/desk-accepted.png`, fullPage: true });

  await page.goto("/desk");
  await expect(page.locator(".cs-root")).toBeVisible();
  const reloaded = await live(page);
  expect(reloaded.revision).toBe(before.revision + 1);
  expect(reloaded.configHash).toBe(after.configHash);
});

test("unauthenticated MCP is challenged and OAuth discovery is served", async ({ request }) => {
  const mcp = await request.post("/api/mcp", {
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
    data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } },
  });
  expect(mcp.status()).toBe(401);
  expect(mcp.headers()["www-authenticate"]).toContain('resource_metadata="');
  for (const path of ["/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

let rpcId = 1;
async function mcpCall(request: APIRequestContext, token: string, method: string, params?: Record<string, unknown>) {
  const res = await request.post("/api/mcp", {
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18", Authorization: `Bearer ${token}` },
    data: { jsonrpc: "2.0", id: rpcId++, method, ...(params ? { params } : {}) },
  });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}
const toolResult = (body: { result?: { structuredContent?: Record<string, unknown>; isError?: boolean } }) => {
  expect(body.result?.isError, JSON.stringify(body)).toBeFalsy();
  return body.result!.structuredContent!;
};

test("an agent connects through consent and its proposal appears live on Riley's desk", async ({ page, context, request }) => {
  const prm = await (await request.get("/.well-known/oauth-protected-resource/api/mcp")).json();
  const resource = prm.resource as string;
  const issuer = prm.authorization_servers[0] as string;

  // 1. Dynamic client registration.
  const reg = await request.post("/api/oauth/register", { data: {
    client_name: "Northwind e2e agent", redirect_uris: [REDIRECT_URI], grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"], token_endpoint_auth_method: "none",
  } });
  expect(reg.status()).toBe(201);
  const clientId = (await reg.json()).client_id as string;

  // 2. Authorize while signed out: Northwind's login with a return path.
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = `st-${randomUUID()}`;
  const params = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI, code_challenge: challenge,
    code_challenge_method: "S256", resource, state, scope: "view:read data:read view:propose",
  });
  await page.goto(`/oauth/authorize?${params}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  const next = new URL(page.url()).searchParams.get("next")!;
  expect(next.startsWith("/oauth/authorize?")).toBe(true);

  // 3. Sign in as Riley; consent resumes with a session-bound CSRF token.
  await page.fill("#email", RILEY);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL(/\/oauth\/authorize\?/), page.locator('form button[type="submit"]').first().click()]);
  await expect(page.getByRole("heading", { name: /Allow Northwind e2e agent to use your Northwind desk\?/ })).toBeVisible();
  const csrf = await page.locator('input[name="csrf"]').inputValue();
  expect(csrf).toBe(await hostCsrf(context));

  // 4. Approve. Read the loopback redirect from the decision response (nothing listens there).
  const [decision] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/oauth/authorize/decision") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Allow" }).click(),
  ]);
  expect(decision.status()).toBe(303);
  const callback = new URL(decision.headers()["location"]);
  expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI);
  expect(callback.searchParams.get("code")).toBeTruthy();
  expect(callback.searchParams.get("state")).toBe(state);
  expect(callback.searchParams.get("iss")).toBe(issuer);

  // 5. Token exchange with PKCE.
  const tok = await request.post("/api/oauth/token", { form: {
    grant_type: "authorization_code", code: callback.searchParams.get("code")!, redirect_uri: REDIRECT_URI,
    client_id: clientId, code_verifier: verifier, resource,
  } });
  expect(tok.status(), await tok.text()).toBe(200);
  const token = (await tok.json()).access_token as string;

  // 6. Riley's desk is open (at the company default) before the agent proposes.
  await page.goto("/desk");
  await resetView(page, csrf);
  const before = await live(page);

  // 7. MCP: describe, then propose with the Riley token.
  await mcpCall(request, token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Northwind e2e agent", version: "1" } });
  const described = toolResult(await mcpCall(request, token, "tools/call", { name: "describe_surface", arguments: { surfaceId: "desk" } }));
  expect(described.currentRevision).toBe(before.revision);
  const proposed = toolResult(await mcpCall(request, token, "tools/call", { name: "propose_view", arguments: {
    surfaceId: "desk", baseRevision: described.currentRevision,
    task: { id: "triage_queue", source: "explicit" }, expertise: { level: "new", source: "explicit" },
    requestId: `nw-e2e-agent-${randomUUID()}`,
  } }));
  expect(proposed.outcome, JSON.stringify(proposed)).toBe("READY");
  expect(proposed.creditConsumed).toBe(false);

  // 8. It shows up live, without a reload; Keep current leaves the view alone.
  await expect(page.locator(".contour-live")).toHaveAttribute("data-live-state", "ready");
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/desk-agent-ready.png`, fullPage: true });
  await page.getByRole("button", { name: "Keep current" }).click();
  await expect(page.locator(".contour-live")).toHaveAttribute("data-live-state", "idle");
  expect((await live(page)).revision).toBe(before.revision);

  // Clean up: revoke the agent's token.
  const revoke = await request.post("/api/oauth/revoke", { form: { token, client_id: clientId } });
  expect(revoke.status()).toBe(200);
});
