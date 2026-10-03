import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/**
 * Browser acceptance run against a real deployment (CONTOUR_TEST_URL).
 * Covers A13 (live Stripe test Checkout + signed webhook → exactly one
 * credit), A03/A06 host approval, A08 reload/undo, A10 state + focus +
 * widths. Uses demo identity alex@contour.demo; resets alex's Contour state first.
 */

const ALEX = "alex@contour.demo";
const PASSWORD = "contour-demo-2026";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let alexId = "";

async function resetAlex() {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  alexId = data.users.find((u) => u.email === ALEX)!.id;
  for (const t of ["approvals", "credit_ledger", "credits", "billing_orders", "proposals", "idempotency_keys", "view_history", "user_views", "user_preferences", "decision_events", "usage_events"]) {
    await db.from(t).delete().eq("subject_id", alexId);
  }
  await db.from("rate_limits").delete().like("bucket", `%:${alexId}`);
}

async function credits() {
  const { data } = await db.from("credits").select("status").eq("subject_id", alexId);
  return {
    available: (data ?? []).filter((c) => c.status === "available").length,
    consumed: (data ?? []).filter((c) => c.status === "consumed").length,
    total: (data ?? []).length,
  };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ALEX);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await resetAlex();
});

test("A13: a forged success redirect grants nothing", async ({ page }) => {
  await signIn(page);
  await page.goto(`/billing?checkout=success&order=${crypto.randomUUID()}`);
  await expect(page.getByText(/verif/i).first()).toBeVisible();
  await page.waitForTimeout(3000);
  expect((await credits()).total).toBe(0);
});

test("A13: Stripe test Checkout grants exactly one credit through the signed webhook", async ({ page }) => {
  await signIn(page);
  await page.goto("/billing");
  await page.getByRole("button", { name: /Buy 1 credit/ }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });
  // Stripe hosted Checkout, test card.
  await page.locator("#email").fill("alex@contour.demo").catch(() => {});
  const card = page.locator("#cardNumber");
  if (!(await card.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /card/i }).first().click().catch(() => {});
  }
  await card.fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("Alex Rivera").catch(() => {});
  const zip = page.locator("#billingPostalCode");
  if (await zip.isVisible().catch(() => false)) await zip.fill("94103");
  const country = page.locator("#billingCountry");
  if (await country.isVisible().catch(() => false)) await country.selectOption("US").catch(() => {});
  const savePass = page.getByRole("checkbox", { name: /Save my information/i });
  if (await savePass.isChecked().catch(() => false)) await savePass.uncheck({ force: true });
  await page.locator("button[type=submit], .SubmitButton").first().click();
  await page.waitForURL(/\/billing\?checkout=success/, { timeout: 60000 });

  // Credit appears only after the verified webhook, never from the redirect itself.
  await expect.poll(async () => (await credits()).available, { timeout: 45000, intervals: [1000, 2000, 3000] }).toBe(1);
  const { data: orders } = await db.from("billing_orders").select("status, stripe_session_id").eq("subject_id", alexId);
  expect(orders?.filter((o) => o.status === "granted")).toHaveLength(1);
  const { data: events } = await db
    .from("stripe_events")
    .select("event_id, type, result, livemode")
    .eq("order_id", (await db.from("billing_orders").select("id").eq("subject_id", alexId).eq("status", "granted").single()).data!.id);
  expect(events?.some((e) => e.result === "granted" && e.livemode === false)).toBe(true);
  console.log("[stripe evidence]", JSON.stringify({ orders, events }));
});

test("A03/A06/A08/A10: propose → keyboard Accept keeps the draft; reload persists; undo restores", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  const draft = page.getByTestId("task-draft-note").first();
  await draft.fill("Carrier call at 3pm — confirm West lane");

  await page.getByRole("button", { name: /Choose task and expertise|Adapt my view/ }).first().click();
  await page.getByRole("radio", { name: /Review performance/ }).check();
  await page.getByRole("radio", { name: /Beginner/ }).check();
  await page.getByRole("button", { name: /Request a proposed view/ }).click();
  await page.waitForURL(/\/preview\//, { timeout: 30000 });
  expect((await credits()).consumed).toBe(1);

  // Focus starts at the preview heading; the stated task/expertise are shown.
  await expect(page.locator(":focus")).toHaveText(/./);
  await expect(page.getByText(/Review performance/).first()).toBeVisible();
  await expect(page.getByText(/Beginner/i).first()).toBeVisible();

  // A forged approval without the session CSRF token is rejected.
  const proposalId = page.url().split("/preview/")[1];
  const forged = await page.request.post(`/api/host/proposals/${proposalId}/apply`, {
    data: { configHash: "sha256:forged", idempotencyKey: "forged-12345", approved: true },
  });
  expect(forged.status()).toBe(403);

  // Keyboard-only accept.
  await page.getByRole("button", { name: "Accept proposed view" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => u.pathname === "/" , { timeout: 30000 });
  await expect(page.getByTestId("task-draft-note").first()).toHaveValue("Carrier call at 3pm — confirm West lane");

  const view = await (await page.request.get("/api/host/view")).json();
  expect(view.revision).toBe(1);
  await page.reload();
  expect((await (await page.request.get("/api/host/view")).json()).revision).toBe(1);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await (await page.request.get("/api/host/view")).json()).revision).toBe(2);
  expect((await credits()).consumed).toBe(1); // apply/undo cost nothing
});

for (const width of [390, 768, 1440]) {
  test(`A10: required content stays usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto("/");
    await expect(page.getByText(/West lane capacity below forecast/).first()).toBeVisible();
    const ack = page.getByRole("button", { name: /^Acknowledge:/ }).first();
    await ack.scrollIntoViewIfNeeded();
    await expect(ack).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `docs/evidence/dashboard-${width}.png`, fullPage: true });
  });
}
