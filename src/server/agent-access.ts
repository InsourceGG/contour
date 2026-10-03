import "server-only";
import { adminClient } from "./supabase";

/**
 * Agent (MCP) access requires BOTH the company-wide master switch
 * (apps.agent_access_enabled) and the tenant's own switch
 * (tenant_app_settings), which only that tenant's operators control.
 * A missing tenant row means enabled (the default).
 */
export async function isAgentAccessEnabled(tenantId: string, appId: string): Promise<boolean> {
  const db = adminClient();
  const [app, tenant] = await Promise.all([
    db.from("apps").select("agent_access_enabled").eq("id", appId).maybeSingle(),
    db.from("tenant_app_settings").select("agent_access_enabled").eq("tenant_id", tenantId).eq("app_id", appId).maybeSingle(),
  ]);
  if (app.error || tenant.error) throw new Error("agent access lookup failed");
  return app.data?.agent_access_enabled === true && (tenant.data?.agent_access_enabled ?? true) === true;
}
