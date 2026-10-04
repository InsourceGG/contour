import "server-only";
import { defineContourServer } from "@contour/sdk/server";
import { getAppDb } from "./db";
import { agentAccessEnabled, APP_ID, identity } from "./identity";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

// Northwind runs Contour without metering (owner decision, checkpoint 3):
// `billing: "none"` means no credits are required, reserved or consumed.
export const contour = defineContourServer({
  get appUrl() { return new URL(required("APP_URL")).origin; },
  appId: APP_ID,
  resourceName: "Northwind Support",
  surfaces: ["desk"],
  get db() { return getAppDb(); },
  schema: "northwind_contour",
  get csrfSecret() { return required("CONTOUR_CSRF_SECRET"); },
  identity,
  agentAccessEnabled,
  billing: "none",
  get trustedClients() {
    const cloudUrl = process.env.CONTOUR_CLOUD_URL;
    return cloudUrl ? [`${new URL(cloudUrl).origin}/oauth/client.json`] : [];
  },
  consent: {
    productName: "Northwind Support",
    dataCategories: ["Authorized support tickets", "SLA alerts", "Service metrics", "Knowledge articles", "Customer activity"],
  },
});
