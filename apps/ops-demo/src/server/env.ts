import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabasePublishableKey() {
    return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  },
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY");
  },
  /** Public origin of this deployment, no trailing slash. */
  get appUrl() {
    const explicit = process.env.APP_URL;
    if (explicit) return explicit.replace(/\/$/, "");
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    return "http://localhost:3000";
  },
  get mcpResource() {
    return `${this.appUrl}/api/mcp`;
  },
  get aiGatewayKey() {
    return process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN ?? "";
  },
  get jevModel() {
    return process.env.JEV_MODEL ?? "typesafe-ai/jev";
  },
  get jevConfidenceFloor() {
    return Number(process.env.JEV_CONFIDENCE_FLOOR ?? "0.70");
  },
  get jevTimeoutMs() {
    return Number(process.env.JEV_TIMEOUT_MS ?? "4000");
  },
  get csrfSecret() {
    return required("CONTOUR_CSRF_SECRET");
  },
  get stripeSecretKey() {
    return required("STRIPE_SECRET_KEY");
  },
  get stripeWebhookSecret() {
    return required("STRIPE_WEBHOOK_SECRET");
  },
  get stripePriceId() {
    return required("STRIPE_PRICE_ID");
  },
  get stripeAccountId() {
    return process.env.STRIPE_ACCOUNT_ID ?? "";
  },
};
