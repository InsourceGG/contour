import "server-only";
import { NextResponse } from "next/server";
import { ContourError } from "@contour/sdk/core";
import { errorResponse, type HostUser } from "@contour/sdk/server";
import { contour } from "./server";

const MAX_BODY = 1024;

/**
 * Admin-only Contour mutation: verified live session, administrator role from
 * the current users row, same origin, and the session-bound CSRF header.
 */
export async function adminMutation(request: Request, fn: (admin: HostUser, body: unknown) => Promise<unknown>): Promise<Response> {
  try {
    const user = await contour.requireUser();
    contour.assertCsrf(request, user);
    if (user.role !== "admin") throw new ContourError("FORBIDDEN", "Administrator access required");
    const text = await request.text();
    if (text.length > MAX_BODY) throw new ContourError("INVALID_INPUT", "Request too large");
    let body: unknown = {};
    if (text) {
      try { body = JSON.parse(text); } catch { throw new ContourError("INVALID_INPUT", "Body must be JSON"); }
    }
    return NextResponse.json(await fn(user, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
