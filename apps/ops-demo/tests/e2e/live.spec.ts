import { createHmac, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Run against the local Next dev server on port 3000. For deterministic
// selector timing, preload tests/support/live-gateway-fixture.mjs into that
// server with NODE_OPTIONS=--import=<absolute path>. Never preload production.

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Same verified-grant fixture as the integration suite. No payment is claimed.
async function grantCredit(subjectId: string, tenantId: string) {
  const sessionId = `cs_test_fixture_${randomUUID()}`;
  const { data: order, error } = await db.from("billing_orders").insert({
    tenant_id: tenantId, app_id: "ops-demo", subject_id: subjectId,
    amount: 100, currency: "usd", price_id: "price_fixture", stripe_session_id: sessionId,
  }).select("id").single();
  if (error) throw new Error("Could not create the fixture billing order");
  const { data, error: grantError } = await db.rpc("contour_grant_credit", { p: {
    event_id: `evt_fixture_${subjectId.slice(0, 8)}_${randomUUID()}`,
    event_type: "checkout.session.completed", livemode: false, order_id: order.id,
    session_id: sessionId, tenant_id: tenantId, subject_id: subjectId,
    app_id: "ops-demo", amount: 100, currency: "usd", payment_intent: null,
  } });
  if (grantError || data?.result !== "granted") throw new Error("Could not grant the fixture credit");
}

// Compute the existing session-bound token in the test process. Credentials
// never enter page code; only the normal host CSRF token enters its fetch.
async function csrfFor(page: Page) {
  const cookies = await page.context().cookies();
  const pieces = cookies.filter((c) => /^sb-.+-auth-token(?:\.\d+)?$/.test(c.name))
    .sort((a, b) => Number(a.name.split(".").at(-1) ?? 0) - Number(b.name.split(".").at(-1) ?? 0));
  const encoded = pieces.map((c) => c.value).join("");
  const session = JSON.parse(encoded.startsWith("base64-")
    ? Buffer.from(encoded.slice(7), "base64url").toString("utf8") : encoded);
  const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));
  if (!claims.sub || !claims.session_id) throw new Error("Missing signed-in test session");
  return createHmac("sha256", process.env.CONTOUR_CSRF_SECRET!)
    .update(`csrf:${claims.sub}:${claims.session_id}`).digest("base64url");
}

async function settlePanels(page: Page) {
  // Let responsive measurements and the movement animation begin before
  // checking completion. Shimmer belongs to descendants, not these slots.
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(async () => await page.locator(".cs-root").evaluate((root) =>
    [...root.querySelectorAll(".cs-slot")].flatMap((node) => node.getAnimations())
      .filter((animation) => animation.playState === "running").length)).toBe(0);
}

test("an agent proposal arrives inline, waits for typing, and Accept preserves the draft", async ({ page }) => {
  await mkdir(".screenshots/live", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("alex@contour.demo");
  await page.getByLabel("Password").fill("contour-demo-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");

  const { data: users, error: usersError } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (usersError) throw new Error("Could not resolve the test identity");
  const alex = users.users.find((user) => user.email === "alex@contour.demo")!;
  const { data: membership } = await db.from("memberships").select("tenant_id")
    .eq("subject_id", alex.id).eq("app_id", "ops-demo").single();
  await grantCredit(alex.id, membership!.tenant_id);
  const initial = await (await page.request.get("/api/host/view")).json();
  const csrf = await csrfFor(page);
  const draft = page.getByTestId("task-draft-note").first();
  const before = "Carrier call at 3pm, confirm West lane";
  await draft.fill(before);
  await draft.evaluate((node) => {
    (window as Window & { originalDraftNode?: Element }).originalDraftNode = node;
  });
  // Keep editing when READY arrives: the layout must stay saved until blur.
  await draft.focus();
  const originalTemplate = await page.locator(".cs-root").getAttribute("data-template");
  const density = await page.locator(".cs-root").getAttribute("data-density") === "comfortable" ? "compact" : "comfortable";

  // Starting the fetch without awaiting it lets the assertions observe WORKING.
  await page.evaluate(({ token, revision, density }) => {
    (window as Window & { liveProposalRequest?: Promise<unknown> }).liveProposalRequest = fetch("/api/host/proposals", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-contour-csrf": token },
      body: JSON.stringify({ surfaceId: "overview", baseRevision: revision,
        task: { id: "review_performance", source: "explicit" },
        expertise: { level: "beginner", source: "explicit" },
        preferences: { density, help: "show" }, requestId: crypto.randomUUID() }),
    }).then(async (response) => ({ ok: response.ok, body: await response.json() }));
  }, { token: csrf, revision: initial.revision, density });

  const bar = page.getByTestId("live-status");
  await expect(bar).toContainText("preparing a view");
  await expect(page.getByTestId("live-skeleton").first()).toBeVisible();
  await settlePanels(page);
  await page.screenshot({ path: ".screenshots/live/01-working.png", fullPage: true });
  const result = await page.evaluate(async () =>
    await (window as Window & { liveProposalRequest?: Promise<{ ok: boolean; body: { outcome?: string } }> }).liveProposalRequest);
  expect(result?.ok).toBe(true);
  expect(result?.body.outcome).toBe("READY");
  await expect(bar).toContainText("A new view is ready. Review when you're done.");
  await expect(page.locator(".cs-root")).toHaveAttribute("data-template", originalTemplate!);
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue(before);
  await expect(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  await page.screenshot({ path: ".screenshots/live/02-deferred.png", fullPage: true });
  await draft.blur();
  const accept = page.getByRole("button", { name: "Accept", exact: true });
  await expect(accept).toBeVisible();
  await expect(page.locator(".cs-root")).toHaveAttribute("data-preview", "true");
  await expect(page.locator('[data-changed="true"]').first()).toBeVisible();
  await expect.poll(async () => await page.locator(".cs-root").evaluate((root) => {
    const revenue = root.querySelector('[data-component="revenue"]')!.getBoundingClientRect();
    const metrics = root.querySelector('[data-component="metrics"]')!.getBoundingClientRect();
    return metrics.top - revenue.bottom;
  })).toBeLessThan(40);
  expect((await (await page.request.get("/api/host/view")).json()).revision).toBe(initial.revision);
  await settlePanels(page);
  await page.screenshot({ path: ".screenshots/live/03-ready.png", fullPage: true });
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(async () => await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByText("West lane capacity below forecast", { exact: true })).toBeVisible();
    await expect(accept).toBeVisible();
    await settlePanels(page);
    await page.screenshot({ path: `.screenshots/live/03-ready-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => await page.locator(".cs-root").evaluate((node) =>
    node.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length)).toBe(0);

  const after = `${before}. Leave the draft for the next shift.`;
  await draft.fill(after);
  await expect(draft).toBeFocused();
  await expect(page.locator(".cs-root")).toHaveAttribute("data-preview", "true");
  await accept.click();
  await expect.poll(async () => (await (await page.request.get("/api/host/view")).json()).revision)
    .toBe(initial.revision + 1);
  await expect(draft).toHaveValue(after);
  expect(await draft.evaluate((node) => node === (window as Window & { originalDraftNode?: Element }).originalDraftNode)).toBe(true);
  await expect(page.locator(".cs-root")).not.toHaveAttribute("data-preview", "true");
  const live = await page.request.get("/api/host/live");
  expect(live.headers()["cache-control"]).toContain("no-store");
  expect((await live.json()).proposal).toBeNull();
  expect(new URL(page.url()).pathname).toBe("/");
  await settlePanels(page);
  await page.screenshot({ path: ".screenshots/live/04-accepted.png", fullPage: true });
});
