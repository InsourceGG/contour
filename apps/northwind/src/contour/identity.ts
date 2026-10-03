import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { ContourError, type VerifiedContext } from "@contour/sdk/core";
import type { HostUser, Membership } from "@contour/sdk/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import type { Role, Session } from "@/data/types";
import { getAppDb } from "./db";

/**
 * Maps Northwind's own signed session onto Contour identity (checkpoint 3).
 * The tenant is the company; support teams stay a data scope inside it.
 * Every lookup reads the live users row, so role, team, and role_version
 * changes apply on the next call.
 */

export const APP_ID = "northwind";
export const TENANT_ID = "northwind";
const CONTOUR_SCHEMA = "northwind_contour";
/** Owner-approved roles that may use agents. */
const allowedRoles = new Set<Role>(["agent", "lead", "admin"]);

type UserRow = { id: string; email: string; name: string; role: Role; team: string; role_version: number };

async function loadUser(subjectId: string): Promise<UserRow | null> {
  const { data, error } = await getDb().from("users").select("id,email,name,role,team,role_version").eq("id", subjectId).maybeSingle<UserRow>();
  if (error) throw new Error("Membership lookup failed");
  return data;
}

async function getMembership(subjectId: string, tenantId: string, appId: string): Promise<Membership | null> {
  if (tenantId !== TENANT_ID || appId !== APP_ID) return null;
  const user = await loadUser(subjectId);
  if (!user) return null;
  return {
    subjectId: user.id, tenantId, appId, role: user.role, roleVersion: user.role_version,
    displayName: user.name, status: "active", dataAccess: allowedRoles.has(user.role),
  };
}

async function currentUser(): Promise<HostUser | null> {
  const session = await getSession();
  if (!session) return null;
  const membership = await getMembership(session.userId, TENANT_ID, APP_ID);
  if (!membership || membership.status !== "active") throw new ContourError("FORBIDDEN", "No active membership");
  const cookie = (await cookies()).get("nw_session")?.value;
  if (!cookie) throw new ContourError("FORBIDDEN", "Verified session cookie missing");
  return {
    subjectId: session.userId,
    sessionId: createHash("sha256").update(cookie).digest("hex"),
    tenantId: membership.tenantId, role: membership.role,
    roleVersion: membership.roleVersion, displayName: session.name, email: session.email,
  };
}

export const identity = {
  currentUser,
  loginUrl: (nextPath: string) => `/login?next=${encodeURIComponent(
    nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/desk",
  )}`,
  getMembership,
};

/**
 * Rebuilds the original Northwind Session for an agent reader from live
 * records, never from reader input. The data functions then apply their own
 * team scope to it.
 */
export async function sessionForContext(ctx: VerifiedContext): Promise<Session> {
  if (ctx.tenantId !== TENANT_ID || ctx.appId !== APP_ID) throw new ContourError("FORBIDDEN", "Unknown company or app");
  const user = await loadUser(ctx.subjectId);
  if (!user) throw new ContourError("FORBIDDEN", "No active membership");
  if (!allowedRoles.has(user.role)) throw new ContourError("FORBIDDEN", "Data access is not allowed for this role");
  if (String(user.role_version) !== ctx.roleVersion) throw new ContourError("FORBIDDEN", "Your role changed; reconnect to continue");
  return { userId: user.id, email: user.email, name: user.name, role: user.role, team: user.team };
}

/**
 * Agent access for the company. Missing row, another company or app, or a
 * failed lookup all mean disabled. The admin kill switch stores false here.
 */
export async function agentAccessEnabled(tenantId: string, appId: string): Promise<boolean> {
  if (tenantId !== TENANT_ID || appId !== APP_ID) return false;
  const { data, error } = await getAppDb().schema(CONTOUR_SCHEMA).from("tenant_app_settings")
    .select("agent_access_enabled").eq("tenant_id", tenantId).eq("app_id", appId).maybeSingle<{ agent_access_enabled: boolean }>();
  if (error || !data) return false;
  return data.agent_access_enabled === true;
}

/** Admin-only write of the kill switch. Callers must verify admin, origin, and CSRF first. */
export async function setAgentAccess(enabled: boolean, adminSubjectId: string): Promise<void> {
  const { error } = await getAppDb().schema(CONTOUR_SCHEMA).from("tenant_app_settings").upsert(
    { tenant_id: TENANT_ID, app_id: APP_ID, agent_access_enabled: enabled, updated_at: new Date().toISOString(), updated_by: adminSubjectId },
    { onConflict: "tenant_id,app_id" },
  );
  if (error) throw new Error("Could not save the agent access setting.");
}
