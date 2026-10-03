import "server-only";
import Stripe from "stripe";
import { env } from "./env";

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) {
    if (!env.stripeSecretKey.startsWith("sk_test_") && !env.stripeSecretKey.startsWith("rk_test_")) {
      throw new Error("Contour MVP billing runs in Stripe test mode only");
    }
    client = new Stripe(env.stripeSecretKey);
  }
  return client;
}

/** Server-configured demo price (test mode). Clients can never choose price,
 *  quantity, customer or credit recipient. */
export async function configuredPrice() {
  const price = await stripe().prices.retrieve(env.stripePriceId);
  if (!price.active || price.unit_amount === null || price.livemode) throw new Error("Configured price unavailable");
  return { id: price.id, amount: price.unit_amount, currency: price.currency };
}
