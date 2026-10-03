import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ContourError } from "../../core/types";
import type { ServerContext } from "../context";

export const CSRF_HEADER = "x-contour-csrf";

export type Csrf = ReturnType<typeof createCsrf>;

export function createCsrf(ctx: ServerContext) {
  /** Session-bound CSRF token: HMAC(secret, subject, auth session). Rendered
   *  into host pages; changes on every sign-in and dies with the session. */
  function csrfTokenFor(user: { subjectId: string; sessionId: string }): string {
    return createHmac("sha256", ctx.cfg.csrfSecret).update(`csrf:${user.subjectId}:${user.sessionId}`).digest("base64url");
  }

  /** True when the request's Origin is this deployment (configured or serving origin). */
  function isSameOrigin(request: Request): boolean {
    const origin = request.headers.get("origin");
    const expectedOrigin = new URL(ctx.cfg.appUrl).origin;
    const requestOrigin = new URL(request.url).origin;
    return !!origin && (origin === expectedOrigin || origin === requestOrigin);
  }

  /**
   * Host mutations must come from our own origin and carry the session-bound
   * token. Combined with SameSite=Lax auth cookies this blocks cross-site
   * approval forgery; a model or preview link alone can never approve.
   */
  function assertCsrf(request: Request, user: { subjectId: string; sessionId: string }) {
    if (!isSameOrigin(request)) {
      throw new ContourError("FORBIDDEN", "Cross-origin request rejected");
    }
    const provided = request.headers.get(CSRF_HEADER) ?? "";
    const expected = csrfTokenFor(user);
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ContourError("FORBIDDEN", "Missing or invalid CSRF token");
    }
  }

  return { csrfTokenFor, assertCsrf, isSameOrigin };
}
