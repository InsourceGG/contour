import "server-only";
import { createJevSelector } from "@contour/sdk/jev";
import { env } from "./env";

/** The JEV selector configured from this deployment's environment. */
export const jevSelector = createJevSelector({
  apiKey: () => env.aiGatewayKey,
  model: () => env.jevModel,
  timeoutMs: () => env.jevTimeoutMs,
});
