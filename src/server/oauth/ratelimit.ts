import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "../supabase";

/**
 * Best-effort client IP. On Vercel `x-forwarded-for` is set by the platform
 * edge (client-supplied values are overwritten), so the first hop is the
 * client. Locally it falls back to "local".
 */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "local";
}

/** Fixed-window limiter backed by `contour_rate_limit`. Fails closed. */
export async function allowRequest(scope: string, key: string, windowSeconds: number, max: number): Promise<boolean> {
  // Hash the key so IPs are not stored in clear text.
  const bucket = `${scope}:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
  const { data, error } = await adminClient().rpc("contour_rate_limit", {
    p_bucket: bucket,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error) {
    console.error("[contour] rate limit check failed", error.code ?? "unknown");
    return false;
  }
  return data === true;
}
