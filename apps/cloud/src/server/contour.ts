import "server-only";
import { defineContourServer } from "@contour/sdk/server";
import { APP_ID, tryHostUser } from "./context";
import { env } from "./env";
import { adminClient } from "./supabase";

export const contour = defineContourServer({
  get appUrl() { return env.appUrl; },
  appId: APP_ID,
  resourceName: "Contour Cloud",
  schema: "cloud",
  surfaces: ["cloud"],
  get db() { return adminClient(); },
  get csrfSecret() { return env.csrfSecret; },
  identity: {
    currentUser: tryHostUser,
    loginUrl: (next) => `/login?next=${encodeURIComponent(next)}`,
    async getMembership(subjectId, tenantId, appId) {
      if (tenantId !== "cloud" || appId !== APP_ID) return null;
      const { data, error } = await adminClient().auth.admin.getUserById(subjectId);
      if (error && error.status !== 404) throw new Error("Account lookup unavailable");
      if (!data.user) return null;
      return {
        subjectId, tenantId: "cloud", appId: APP_ID, role: "consumer", roleVersion: 1,
        status: "active", dataAccess: true, displayName: data.user.email ?? "Contour member",
      };
    },
  },
  agentAccessEnabled: async () => true,
});
