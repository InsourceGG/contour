import "server-only";
import { defineContourServer } from "@contour/sdk/server";
import { ContourError } from "@contour/sdk/core";
import { isAgentAccessEnabled } from "./agent-access";
import { APP_ID, resolveHostUser } from "./context";
import { env } from "./env";
import { adminClient } from "./supabase";

/**
 * Contour's OAuth authorization server, MCP resource server, store and host
 * helpers for ops-demo. Config values are getters so the environment is read
 * at request time (as before) and the service-role client is created lazily.
 */
export const contour = defineContourServer({
  get appUrl() {
    return env.appUrl;
  },
  appId: APP_ID,
  resourceName: "Contour adaptive dashboard (ops-demo)",
  surfaces: ["overview"],
  get db() {
    return adminClient();
  },
  schema: "public",
  get csrfSecret() {
    return env.csrfSecret;
  },
  identity: {
    async currentUser() {
      try {
        return await resolveHostUser();
      } catch (e) {
        // Signed out is null; a signed-in user without membership stays FORBIDDEN.
        if (e instanceof ContourError && e.code === "UNAUTHENTICATED") return null;
        throw e;
      }
    },
    loginUrl: (nextPath) => `/login?next=${encodeURIComponent(nextPath)}`,
    getMembership: (subjectId, tenantId, appId) => contour.store.getMembership(subjectId, tenantId, appId),
  },
  agentAccessEnabled: isAgentAccessEnabled,
});
