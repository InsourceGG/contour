import "server-only";
import { ContourError } from "@contour/sdk/core";
import type { HostUser } from "@contour/sdk/server";
import { userClient } from "./supabase";

export type { HostUser };
export const APP_ID = "contour-cloud";

export async function resolveHostUser(): Promise<HostUser> {
  const supabase = await userClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new ContourError("UNAUTHENTICATED", "Sign in required");
  // Verify the session's signature and obtain the session binding from claims,
  // rather than trusting a user-supplied cookie payload.
  const { data: verified, error: claimsError } = await supabase.auth.getClaims();
  const sessionId = verified?.claims.session_id;
  if (claimsError || verified?.claims.sub !== data.user.id || typeof sessionId !== "string" || !sessionId) {
    throw new ContourError("UNAUTHENTICATED", "Sign in required");
  }
  return {
    subjectId: data.user.id,
    sessionId,
    tenantId: "cloud",
    role: "consumer",
    roleVersion: 1,
    displayName: data.user.email?.split("@")[0] ?? "Contour member",
    email: data.user.email ?? "",
  };
}

export async function tryHostUser(): Promise<HostUser | null> {
  try { return await resolveHostUser(); }
  catch (error) {
    if (error instanceof ContourError && error.code === "UNAUTHENTICATED") return null;
    throw error;
  }
}
