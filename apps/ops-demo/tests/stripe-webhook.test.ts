import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, subjectOf } from "./support/fixtures";

/**
 * A13 webhook abuse cases against the DEPLOYED endpoint (CONTOUR_TEST_URL).
 * Uses the real webhook signing secret to sign payloads exactly as Stripe
 * would, so these exercise signature verification, authoritative session
 * retrieval, and the dedupe/ownership checks end to end.
 */
const BASE = process.env.CONTOUR_TEST_URL ?? "https://contour-sdk.vercel.app";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const secret = process.env.STRIPE_WEBHOOK_SECRET!;

async function deliver(payload: string, signature?: string) {
  const res = await fetch(`${BASE}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signature ?? stripe.webhooks.generateTestHeaderString({ payload, secret }),
    },
    body: payload,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { result?: string; error?: string } };
}

function eventFor(session: Stripe.Checkout.Session, id = `evt_test_${randomUUID().replace(/-/g, "")}`) {
  return JSON.stringify({
    id,
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    api_version: "2026-09-30",
    data: { object: { id: session.id, object: "checkout.session" } },
  });
}

let alex: { id: string; tenant: string };
let taylor: { id: string; tenant: string };

async function availableCredits(subject: string) {
  const { data } = await admin().from("credits").select("status").eq("subject_id", subject);
  return (data ?? []).filter((c) => c.status === "available").length;
}

async function pendingOrder(owner: { id: string; tenant: string }) {
  const { data, error } = await admin()
    .from("billing_orders")
    .insert({ tenant_id: owner.tenant, app_id: "ops-demo", subject_id: owner.id, amount: 100, currency: "usd", price_id: process.env.STRIPE_PRICE_ID })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  alex = await subjectOf("alex@contour.demo");
  taylor = await subjectOf("taylor@contour.demo");
});

describe("A13 deployed webhook", () => {
  it("rejects an invalid signature and a missing signature", async () => {
    const payload = JSON.stringify({ id: "evt_forged", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_test_x" } } });
    expect((await deliver(payload, "t=1,v1=deadbeef")).status).toBe(400);
    const res = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", body: payload });
    expect(res.status).toBe(400);
  });

  it("an unpaid (open) Checkout Session grants nothing even with a valid signature", async () => {
    const before = await availableCredits(alex.id);
    const orderId = await pendingOrder(alex);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      client_reference_id: orderId,
      metadata: { order_id: orderId, tenant_id: alex.tenant, subject_id: alex.id, app_id: "ops-demo" },
      success_url: `${BASE}/billing?checkout=success`,
      cancel_url: `${BASE}/billing?checkout=canceled`,
    });
    await admin().from("billing_orders").update({ stripe_session_id: session.id }).eq("id", orderId);
    const r = await deliver(eventFor(session));
    expect(r.status).toBe(200);
    expect(r.body.result).toBe("unpaid");
    expect(await availableCredits(alex.id)).toBe(before);
    await stripe.checkout.sessions.expire(session.id);
  });

  it("re-delivery of the real paid event is deduplicated (no extra credit)", async () => {
    const { data: granted } = await admin()
      .from("billing_orders")
      .select("id, stripe_session_id")
      .eq("subject_id", alex.id)
      .eq("status", "granted")
      .order("granted_at", { ascending: false })
      .limit(1);
    expect(granted?.length, "run the e2e Stripe checkout first").toBe(1);
    const { data: ev } = await admin().from("stripe_events").select("event_id").eq("order_id", granted![0].id).eq("result", "granted").single();
    const real = await stripe.events.retrieve(ev!.event_id);
    const { count: before } = await admin().from("credits").select("*", { count: "exact", head: true }).eq("subject_id", alex.id);
    // Same event ID again → duplicate_event. New event ID for the same paid session → already_granted.
    const dup = await deliver(JSON.stringify(real));
    expect(dup.body.result).toBe("duplicate_event");
    const session = await stripe.checkout.sessions.retrieve(granted![0].stripe_session_id!);
    const replay = await deliver(eventFor(session));
    expect(replay.body.result).toBe("already_granted");
    const { count: after } = await admin().from("credits").select("*", { count: "exact", head: true }).eq("subject_id", alex.id);
    expect(after).toBe(before);
  });

  it("a session pointing at another tenant's order grants nothing", async () => {
    const before = { alex: await availableCredits(alex.id), taylor: await availableCredits(taylor.id) };
    const taylorOrder = await pendingOrder(taylor);
    // Attacker-controlled session claims Taylor's order but carries Alex's identity.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      client_reference_id: taylorOrder,
      metadata: { order_id: taylorOrder, tenant_id: alex.tenant, subject_id: alex.id, app_id: "ops-demo" },
      success_url: `${BASE}/billing`,
      cancel_url: `${BASE}/billing`,
    });
    const r = await deliver(eventFor(session));
    expect(["unpaid", "order_mismatch"]).toContain(r.body.result);
    expect(await availableCredits(alex.id)).toBe(before.alex);
    expect(await availableCredits(taylor.id)).toBe(before.taylor);
    await stripe.checkout.sessions.expire(session.id);
  });
});
