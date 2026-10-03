import "server-only";
import { NextResponse } from "next/server";
import { ALL_SCOPES, ContourError, type VerifiedContext } from "../../core/types";
import type { HostUser } from "../config";
import type { ServerContext } from "../context";
import type { Csrf } from "./csrf";
import { errorResponse } from "./http";

const MAX_BODY = 32 * 1024;

export function createHostRoute(ctx: ServerContext, csrf: Csrf) {
  /** The verified host session. Signed out is UNAUTHENTICATED; identity may also throw FORBIDDEN. */
  async function requireUser(): Promise<HostUser> {
    const user = await ctx.cfg.identity.currentUser();
    if (!user) throw new ContourError("UNAUTHENTICATED", "Sign in required");
    return user;
  }

  /** Broker context for a verified host session: every scope, host channel. */
  function contextFromUser(u: HostUser, surfaceId: string = ctx.defaultSurface()): VerifiedContext {
    return {
      subjectId: u.subjectId,
      tenantId: u.tenantId,
      appId: ctx.cfg.appId,
      surfaceId,
      clientId: "host",
      grantRevision: "host-session",
      scopes: new Set(ALL_SCOPES),
      roleVersion: String(u.roleVersion),
      role: u.role,
      channel: "host",
    };
  }

  /** Authenticated host-app mutation: verified session + same-origin + CSRF token. */
  async function hostMutation(request: Request, fn: (ctx: VerifiedContext, body: unknown) => Promise<unknown>) {
    try {
      const user = await requireUser();
      csrf.assertCsrf(request, user);
      const vc = contextFromUser(user);
      const text = await request.text();
      if (text.length > MAX_BODY) throw new ContourError("INVALID_INPUT", "Request too large");
      let body: unknown = {};
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new ContourError("INVALID_INPUT", "Body must be JSON");
        }
      }
      const result = await fn(vc, body);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  }

  return { requireUser, contextFromUser, hostMutation };
}
