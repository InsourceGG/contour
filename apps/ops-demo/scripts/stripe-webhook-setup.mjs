import Stripe from "stripe";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const s = new Stripe(process.env.STRIPE_SECRET_KEY);
const url = process.argv[2];
const existing = (await s.webhookEndpoints.list({ limit: 100 })).data.filter((w) => w.url === url);
for (const w of existing) await s.webhookEndpoints.del(w.id);
const ep = await s.webhookEndpoints.create({
  url,
  enabled_events: ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"],
  description: "Contour adaptation credit fulfillment (test mode)",
});
process.stdout.write(JSON.stringify({ id: ep.id, livemode: ep.livemode, secret: ep.secret }));
