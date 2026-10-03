/**
 * A03 evidence run: the selected real MCP client (Claude Code, headless)
 * completes discovery → scoped read → proposal → host approval → saved-view
 * verification against the deployed app.
 *
 * The OAuth authorization (DCR + PKCE S256 + resource binding) is performed
 * through the real consent page in a browser signed in as the demo user; the
 * resulting audience-bound token is handed to Claude Code as a bearer header.
 * (Interactive `claude mcp add` + /mcp login is the same server flow, with
 * Claude Code driving the browser itself.)
 *
 *   pnpm tsx scripts/agent-run.ts [email]
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE = process.env.CONTOUR_TEST_URL ?? "https://contour-sdk.vercel.app";
const EMAIL = process.argv.slice(2).find((a) => a.includes("@")) ?? "sam@contour.demo";
const PASSWORD = "contour-demo-2026";
const REDIRECT = "http://127.0.0.1:53682/callback";
const b64url = (b: Buffer) => b.toString("base64url");
const log = (...a: unknown[]) => console.log("[agent-run]", ...a);

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function ensureCredit(page: Page) {
  await page.goto(`${BASE}/billing`);
  const text = await page.locator("body").innerText();
  if (/\b[1-9]\d* (credits? )?available/i.test(text)) return;
  log("buying one test credit via Stripe Checkout");
  await page.getByRole("button", { name: /Buy 1 credit/ }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });
  await page.locator("#email").fill(EMAIL).catch(() => {});
  await page.locator("#cardNumber").fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("Demo User").catch(() => {});
  const zip = page.locator("#billingPostalCode");
  if (await zip.isVisible().catch(() => false)) await zip.fill("94103");
  const save = page.getByRole("checkbox", { name: /Save my information/i });
  if (await save.isChecked().catch(() => false)) await save.uncheck({ force: true });
  await page.locator("button[type=submit], .SubmitButton").first().click();
  await page.waitForURL(/\/billing\?checkout=success/, { timeout: 60000 });
  await page.waitForTimeout(6000); // signed webhook delivery
}

async function authorize(page: Page): Promise<string> {
  const reg = await fetch(`${BASE}/api/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude Code (headless evidence run)",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  }).then((r) => r.json());
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(12));
  const url = new URL(`${BASE}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: reg.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${BASE}/api/mcp`,
    scope: "view:read data:read view:propose",
    state,
  }).toString();

  let callback = "";
  // Redirect hops aren't interceptable via route(); observe the request instead.
  page.on("request", (r) => {
    if (r.url().startsWith("http://127.0.0.1:53682/")) callback = r.url();
  });
  await page.goto(url.toString());
  await page.screenshot({ path: "../../docs/evidence/oauth-consent.png", fullPage: true });
  await page.getByRole("button", { name: /^(Allow|Approve|Authorize)/i }).first().click().catch(() => {});
  for (let i = 0; i < 30 && !callback; i++) await page.waitForTimeout(250);
  const cb = new URL(callback);
  if (cb.searchParams.get("state") !== state) throw new Error("state mismatch");
  const tok = await fetch(`${BASE}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: cb.searchParams.get("code")!,
      redirect_uri: REDIRECT,
      client_id: reg.client_id,
      code_verifier: verifier,
      resource: `${BASE}/api/mcp`,
    }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`token exchange failed: ${JSON.stringify(tok)}`);
  log("token issued; scope:", tok.scope, "expires_in:", tok.expires_in);
  return tok.access_token as string;
}

function claude(token: string, prompt: string, file: string): { text: string; tools: { name: string; input: unknown }[] } {
  const mcpConfig = JSON.stringify({
    mcpServers: { contour: { type: "http", url: `${BASE}/api/mcp`, headers: { Authorization: `Bearer ${token}` } } },
  });
  const out = execFileSync(
    "claude",
    ["-p", prompt, "--mcp-config", mcpConfig, "--strict-mcp-config", "--allowedTools", "mcp__contour__describe_surface,mcp__contour__read_component_data,mcp__contour__propose_view,mcp__contour__get_view", "--output-format", "stream-json", "--verbose"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000 },
  );
  const redacted = out.split(token).join("<redacted-access-token>");
  writeFileSync(file, redacted);
  const tools: { name: string; input: unknown }[] = [];
  let text = "";
  for (const line of redacted.split("\n")) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      for (const c of msg.message?.content ?? []) if (c.type === "tool_use") tools.push({ name: c.name, input: c.input });
      if (msg.type === "result") text = msg.result ?? "";
    } catch {
      // ignore non-JSON lines
    }
  }
  return { text, tools };
}

async function main() {
  mkdirSync("../../docs/evidence", { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await signIn(page);
  await ensureCredit(page);
  const token = await authorize(page);
  if (process.argv.includes("--token-only")) {
    writeFileSync("/tmp/contour-agent-token", token, { mode: 0o600 });
    log("token written to /tmp/contour-agent-token");
    await browser.close();
    return;
  }

  log("phase 1: Claude Code describes, reads and proposes");
  const p1 = claude(
    token,
    "You are my personal agent for the company dashboard exposed by the `contour` MCP server. 1) Call describe_surface for surfaceId 'overview'. 2) Read the active alerts and my task list with read_component_data. 3) I'm an EXPERT and I'm about to TRIAGE WORK; I like compact density. Call propose_view with surfaceId 'overview', the current baseRevision from describe_surface, task {id:'triage_work',source:'explicit'}, expertise {level:'expert',source:'explicit'}, preferences {density:'compact'}, and a fresh unique requestId. 4) Reply with ONLY a JSON object: {\"outcome\":..., \"proposalId\":..., \"previewUrl\":..., \"baseRevision\":..., \"alertsSeen\":<number>, \"tasksSeen\":<number>}.",
    "../../docs/evidence/claude-code-phase1.jsonl",
  );
  log("tools called:", p1.tools.map((t) => t.name).join(" → "));
  const json = JSON.parse(p1.text.slice(p1.text.indexOf("{"), p1.text.lastIndexOf("}") + 1));
  log("agent result:", json);
  if (json.outcome !== "READY") throw new Error(`expected READY, got ${json.outcome}`);

  log("host approval in the authenticated browser session");
  await page.goto(new URL(json.previewUrl).pathname.replace(/^/, BASE));
  await page.screenshot({ path: "../../docs/evidence/preview-from-agent.png", fullPage: true });
  await page.getByRole("button", { name: "Accept proposed view" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30000 });
  await page.screenshot({ path: "../../docs/evidence/dashboard-after-accept.png", fullPage: true });

  log("phase 2: Claude Code verifies the saved view");
  const p2 = claude(
    token,
    `Using the contour MCP server, call get_view with surfaceId 'overview' and proposalId '${json.proposalId}'. Reply with ONLY a JSON object: {"revision":<snapshot.revision>, "source":<snapshot.source>, "proposalStatus":<proposal.status>, "templateId":<snapshot.config.templateId>, "densityToken":<snapshot.config.densityToken>}.`,
    "../../docs/evidence/claude-code-phase2.jsonl",
  );
  log("tools called:", p2.tools.map((t) => t.name).join(" → "));
  const v = JSON.parse(p2.text.slice(p2.text.indexOf("{"), p2.text.lastIndexOf("}") + 1));
  log("saved view:", v);
  if (v.proposalStatus !== "APPLIED" || v.revision !== json.baseRevision + 1) throw new Error("saved view verification failed");

  writeFileSync(
    "../../docs/evidence/agent-run-summary.json",
    JSON.stringify(
      {
        client: `Claude Code ${execFileSync("claude", ["--version"], { encoding: "utf8" }).trim()} (headless, -p)`,
        deployment: BASE,
        user: EMAIL,
        phase1Tools: p1.tools.map((t) => t.name),
        proposal: json,
        phase2Tools: p2.tools.map((t) => t.name),
        savedView: v,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  log("A03 PASSED");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
