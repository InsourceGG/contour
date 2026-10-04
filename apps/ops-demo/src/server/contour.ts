import "server-only";
import { defineContourServer, type Membership } from "@contour/sdk/server";
import { ContourError } from "@contour/sdk/core";
import { isAgentAccessEnabled } from "./agent-access";
import { APP_ID, resolveHostUser } from "./context";
import { env } from "./env";
import { adminClient } from "./supabase";

/**
 * Acme's membership lookup: the same `memberships` row the store used to read
 * itself. It reads the table directly. The store delegates to this adapter, so
 * calling `contour.store.getMembership` here would recurse forever.
 */
async function getMembership(subjectId: string, tenantId: string, appId: string): Promise<Membership | null> {
  const { data, error } = await adminClient()
    .schema("public")
    .from("memberships")
    .select("tenant_id,subject_id,app_id,role,role_version,data_access,status,display_name")
    .eq("subject_id", subjectId)
    .eq("tenant_id", tenantId)
    .eq("app_id", appId)
    .maybeSingle();
  if (error) {
    console.error("[contour] identity.getMembership failed", error.message);
    throw new ContourError("INTERNAL", "Preference store unavailable");
  }
  if (!data) return null;
  return {
    tenantId: data.tenant_id,
    subjectId: data.subject_id,
    appId: data.app_id,
    role: data.role,
    roleVersion: data.role_version,
    dataAccess: data.data_access,
    status: data.status,
    displayName: data.display_name,
  };
}

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
    getMembership,
  },
  agentAccessEnabled: isAgentAccessEnabled,
});
