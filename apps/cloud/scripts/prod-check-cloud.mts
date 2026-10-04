/**
 * Production check of the consumer path through Contour Cloud:
 * Jordan signs in to Cloud → links Northwind (company login as Riley + consent)
 * → gets a Cloud MCP token (DCR + PKCE) → list_projects → describe_surface and
 * propose_view on Northwind through Cloud.
 *
 *   ../ops-demo/node_modules/.bin/tsx scripts/prod-check-cloud.mts
 */
import { createHash, randomBytes } from "node:crypto";
import { chromium } from "../../ops-demo/node_modules/@playwright/test/index.mjs";

const CLOUD = "https://contour-sdk.vercel.app";
const NORTHWIND_PROJECT = process.argv[2] ?? "e00df7c8-d97f-41d6-8142-a1c0d9ba458a";
const REDIRECT = "http://127.0.0.1:53682/callback";
const b64 = (b: Buffer) => b.toString("base64url");
const log = (...a: unknown[]) => console.log("[cloud-check]", ...a);

const browser = await chromium.launch();
const page = await browser.newPage();

// 1. Contour account
await page.goto(`${CLOUD}/login`);
const pw = page.locator('form[action="/auth/password"]');
await pw.getByLabel(/email/i).fill("jordan@contour.demo");
await pw.getByLabel(/password/i).fill("contour-demo-2026");
await pw.locator('button[type="submit"]').click();
await page.waitForURL(/\/projects/, { timeout: 30000 });
log("signed in to Cloud");

// 2. Link Northwind through the company's own login + consent
await page.goto(`${CLOUD}/link/start?project=${NORTHWIND_PROJECT}`);
await page.getByRole("button", { name: /continue/i }).first().click();
await page.waitForURL(/northwind-support-app\.vercel\.app/, { timeout: 30000 });
if (page.url().includes("/login")) {
  await page.getByLabel(/email/i).first().fill("riley@northwind.demo");
  await page.getByLabel(/password/i).first().fill("northwind-demo-2026");
  await page.getByRole("button", { name: /^sign in/i }).first().click();
  await page.waitForURL(/oauth\/authorize/, { timeout: 30000 });
}
await page.screenshot({ path: "/tmp/cloud-check-consent.png", fullPage: true });
await page.getByRole("button", { name: /^(approve|allow)/i }).first().click();
await page.waitForURL(/contour-sdk\.vercel\.app\/projects/, { timeout: 30000 });
log("linked:", page.url().replace(CLOUD, ""));

// 3. Cloud MCP token for Jordan (DCR + PKCE), consent in the signed-in session
const reg = await fetch(`${CLOUD}/api/oauth/register`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_name: "Claude Code (prod check)", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
}).then((r) => r.json());
const verifier = b64(randomBytes(32));
const challenge = b64(createHash("sha256").update(verifier).digest());
const state = b64(randomBytes(12));
let callback = "";
page.on("request", (r) => { if (r.url().startsWith(REDIRECT)) callback = r.url(); });
const auth = new URL(`${CLOUD}/oauth/authorize`);
auth.search = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: `${CLOUD}/api/mcp`, scope: "view:read data:read view:propose", state }).toString();
await page.goto(auth.toString());
await page.getByRole("button", { name: /^(approve|allow)/i }).first().click().catch(() => {});
for (let i = 0; i < 40 && !callback; i++) await page.waitForTimeout(250);
const code = new URL(callback).searchParams.get("code")!;
const tok = await fetch(`${CLOUD}/api/oauth/token`, {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier, resource: `${CLOUD}/api/mcp` }),
}).then((r) => r.json());
if (!tok.access_token) throw new Error("no Cloud token");
log("Cloud MCP token issued, scope:", tok.scope);

let id = 0;
async function call(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${CLOUD}/api/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json", Accept: "application/json", "MCP-Protocol-Version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.json();
  return body.result?.structuredContent ?? body.result ?? body;
}

const projects = await call("list_projects", {});
log("list_projects:", JSON.stringify(projects).slice(0, 300));
const desc = await call("describe_surface", { projectId: NORTHWIND_PROJECT, surfaceId: "desk" });
log("describe_surface:", desc.label ?? desc.error?.code, "revision", desc.currentRevision);
const prop = await call("propose_view", {
  projectId: NORTHWIND_PROJECT, surfaceId: "desk", baseRevision: desc.currentRevision,
  task: { id: "triage_queue", source: "explicit" }, expertise: { level: "new", source: "explicit" },
  requestId: `prod-check-${Date.now()}`,
});
log("propose_view:", prop.outcome ?? prop.error?.code, prop.previewUrl ?? "", prop.reason ?? "");
await browser.close();
