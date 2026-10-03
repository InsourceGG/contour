import { ContourError } from "@/sdk/types";
import { env } from "@/server/env";
import { hostMutation } from "@/server/host-route";
import { configuredPrice, stripe } from "@/server/stripe";
import { adminClient } from "@/server/supabase";

/** Creates a server-owned pending order bound to the verified subject,
 *  tenant and app, then a hosted Checkout Session for exactly one credit. */
export async function POST(request: Request) {
  return hostMutation(request, async (ctx) => {
    const db = adminClient();
    const { data: allowed } = await db.rpc("contour_rate_limit", {
      p_bucket: `checkout:${ctx.tenantId}:${ctx.subjectId}`,
      p_window_seconds: 300,
      p_max: 10,
    });
    if (!allowed) throw new ContourError("RATE_LIMITED", "Too many checkout attempts");

    const price = await configuredPrice();
    const { data: order, error } = await db
      .from("billing_orders")
      .insert({
        tenant_id: ctx.tenantId,
        app_id: ctx.appId,
        subject_id: ctx.subjectId,
        amount: price.amount,
        currency: price.currency,
        price_id: price.id,
      })
      .select("id")
      .single();
    if (error || !order) throw new ContourError("INTERNAL", "Could not create order");

    const metadata = { order_id: order.id, tenant_id: ctx.tenantId, subject_id: ctx.subjectId, app_id: ctx.appId };
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ price: price.id, quantity: 1 }],
        client_reference_id: order.id,
        metadata,
        payment_intent_data: { metadata },
        success_url: `${env.appUrl}/billing?checkout=success&order=${order.id}`,
        cancel_url: `${env.appUrl}/billing?checkout=canceled&order=${order.id}`,
      },
      { idempotencyKey: `contour-checkout-${order.id}` },
    );
    const { error: upErr } = await db
      .from("billing_orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id)
      .eq("subject_id", ctx.subjectId)
      .eq("status", "pending");
    if (upErr) throw new ContourError("INTERNAL", "Could not bind checkout session");
    return { url: session.url, orderId: order.id };
  });
}
