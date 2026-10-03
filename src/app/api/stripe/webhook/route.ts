import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { env } from "@/server/env";
import { configuredPrice, stripe } from "@/server/stripe";
import { adminClient } from "@/server/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Stripe webhook. Verifies Stripe-Signature against the raw body, accepts
 * only test-mode events for the expected account, re-retrieves the session
 * from Stripe, checks paid status, price, amount and currency, then grants
 * exactly one credit atomically (deduplicated by event ID and by order).
 * A browser redirect or client flag can never grant credit.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, env.stripeWebhookSecret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  if (event.livemode) return NextResponse.json({ error: "live events are not accepted" }, { status: 400 });
  if (env.stripeAccountId && event.account && event.account !== env.stripeAccountId) {
    return NextResponse.json({ error: "unexpected account" }, { status: 400 });
  }

  const db = adminClient();
  const record = async (orderId: string | null, result: string) => {
    await db
      .from("stripe_events")
      .upsert(
        { event_id: event.id, type: event.type, livemode: event.livemode, order_id: orderId, result },
        { onConflict: "event_id", ignoreDuplicates: true },
      );
  };

  if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const orderId = s.client_reference_id && UUID.test(s.client_reference_id) ? s.client_reference_id : null;
    if (orderId) {
      await db.from("billing_orders").update({ status: "canceled" }).eq("id", orderId).eq("stripe_session_id", s.id).eq("status", "pending");
    }
    await record(orderId, "canceled");
    return NextResponse.json({ received: true, result: "canceled" });
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    await record(null, "ignored_type");
    return NextResponse.json({ received: true, result: "ignored" });
  }

  const eventSession = event.data.object as Stripe.Checkout.Session;
  // Authoritative state comes from Stripe, not from the event payload alone.
  const session = await stripe().checkout.sessions.retrieve(eventSession.id, { expand: ["line_items"] });
  const orderId = session.client_reference_id;
  if (!orderId || !UUID.test(orderId) || session.metadata?.order_id !== orderId) {
    await record(null, "missing_order");
    return NextResponse.json({ received: true, result: "missing_order" });
  }
  if (session.payment_status !== "paid" || session.status !== "complete") {
    await record(orderId, "unpaid");
    return NextResponse.json({ received: true, result: "unpaid" });
  }
  const price = await configuredPrice();
  const lines = session.line_items?.data ?? [];
  const lineOk = lines.length === 1 && lines[0].price?.id === price.id && lines[0].quantity === 1;
  if (!lineOk || session.amount_total !== price.amount || session.currency !== price.currency || session.livemode) {
    await record(orderId, "price_mismatch");
    return NextResponse.json({ received: true, result: "price_mismatch" });
  }

  const { data, error } = await db.rpc("contour_grant_credit", {
    p: {
      event_id: event.id,
      event_type: event.type,
      livemode: event.livemode,
      order_id: orderId,
      session_id: session.id,
      tenant_id: session.metadata?.tenant_id ?? "",
      subject_id: session.metadata?.subject_id ?? "",
      app_id: session.metadata?.app_id ?? "",
      amount: session.amount_total,
      currency: session.currency,
      payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
    },
  });
  if (error) {
    console.error("[contour] grant credit failed", error.message);
    // 500 lets Stripe retry; the grant is idempotent.
    return NextResponse.json({ error: "grant failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true, result: (data as { result?: string })?.result ?? "unknown" });
}
