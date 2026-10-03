import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ContourError } from "@/sdk/types";
import { env } from "./env";

export const CSRF_HEADER = "x-contour-csrf";

/** Session-bound CSRF token: HMAC(secret, subject). Rendered into host pages. */
export function csrfTokenFor(subjectId: string): string {
  return createHmac("sha256", env.csrfSecret).update(`csrf:${subjectId}`).digest("base64url");
}

/**
 * Host mutations must come from our own origin and carry the session-bound
 * token. Combined with SameSite=Lax auth cookies this blocks cross-site
 * approval forgery; a model or preview link alone can never approve.
 */
export function assertCsrf(request: Request, subjectId: string) {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(env.appUrl).origin;
  const requestOrigin = new URL(request.url).origin;
  if (!origin || (origin !== expectedOrigin && origin !== requestOrigin)) {
    throw new ContourError("FORBIDDEN", "Cross-origin request rejected");
  }
  const provided = request.headers.get(CSRF_HEADER) ?? "";
  const expected = csrfTokenFor(subjectId);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ContourError("FORBIDDEN", "Missing or invalid CSRF token");
  }
}
