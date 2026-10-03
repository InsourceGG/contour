import "server-only";
import { cookies } from "next/headers";
import { ALL_SCOPES, ContourError, type VerifiedContext } from "@/sdk/types";
import { adminClient, userClient } from "./supabase";

export const APP_ID = "ops-demo";
export const DEFAULT_SURFACE = "overview";
export const TENANT_COOKIE = "contour_tenant";

export type HostUser = {
  subjectId: string;
  email: string;
  displayName: string;
  tenantId: string;
  role: string;
  roleVersion: number;
  /** Supabase auth session ID (JWT `session_id`); binds CSRF tokens to this sign-in. */
  sessionId: string;
};

/**
 * Resolves the verified host-app identity. The subject comes from Supabase
 * Auth (token verified by the Auth server), tenant membership and role come
 * from server-side records. A tenant cookie may only *select* among the
 * user's own active memberships.
 */
export async function resolveHostUser(): Promise<HostUser> {
  const supa = await userClient();
  const { data, error } = await supa.auth.getUser();
  if (error || !data.user) throw new ContourError("UNAUTHENTICATED", "Sign in required");
  const { data: rows, error: mErr } = await adminClient()
    .from("memberships")
    .select("tenant_id, role, role_version, status, display_name")
    .eq("subject_id", data.user.id)
    .eq("app_id", APP_ID)
    .eq("status", "active");
  if (mErr) throw new ContourError("INTERNAL", "Membership lookup failed");
  if (!rows || rows.length === 0) throw new ContourError("FORBIDDEN", "No active membership for this app");
  // getUser() above verified this session's access token with the Auth server;
  // its session_id claim scopes CSRF tokens to this sign-in.
  const { data: sess } = await supa.auth.getSession();
  const sessionId = sessionIdFrom(sess.session?.access_token);
  if (!sessionId) throw new ContourError("UNAUTHENTICATED", "Sign in required");
  const requested = (await cookies()).get(TENANT_COOKIE)?.value;
  const m = rows.find((r) => r.tenant_id === requested) ?? rows[0];
  return {
    subjectId: data.user.id,
    email: data.user.email ?? "",
    displayName: m.display_name,
    tenantId: m.tenant_id,
    role: m.role,
    roleVersion: m.role_version,
    sessionId,
  };
}

function sessionIdFrom(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { session_id?: unknown };
    return typeof payload.session_id === "string" && payload.session_id.length > 0 ? payload.session_id : null;
  } catch {
    return null;
  }
}

export async function resolveHostContext(surfaceId: string = DEFAULT_SURFACE): Promise<VerifiedContext> {
  return contextFromUser(await resolveHostUser(), surfaceId);
}

export function contextFromUser(u: HostUser, surfaceId: string = DEFAULT_SURFACE): VerifiedContext {
  return {
    subjectId: u.subjectId,
    tenantId: u.tenantId,
    appId: APP_ID,
    surfaceId,
    clientId: "host",
    grantRevision: "host-session",
    scopes: new Set(ALL_SCOPES),
    roleVersion: String(u.roleVersion),
    role: u.role,
    channel: "host",
  };
}

/** Returns null instead of throwing when the visitor is signed out. */
export async function tryHostUser(): Promise<HostUser | null> {
  try {
    return await resolveHostUser();
  } catch (e) {
    if (e instanceof ContourError && (e.code === "UNAUTHENTICATED" || e.code === "FORBIDDEN")) return null;
    throw e;
  }
}
