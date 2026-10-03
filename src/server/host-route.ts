import "server-only";
import { NextResponse } from "next/server";
import { ContourError, type VerifiedContext } from "@/sdk/types";
import { contextFromUser, resolveHostUser } from "./context";
import { assertCsrf } from "./csrf";
import { errorResponse } from "./http";

const MAX_BODY = 32 * 1024;

/** Authenticated host-app mutation: verified session + same-origin + CSRF token. */
export async function hostMutation(
  request: Request,
  fn: (ctx: VerifiedContext, body: unknown) => Promise<unknown>,
) {
  try {
    const user = await resolveHostUser();
    assertCsrf(request, user);
    const ctx = contextFromUser(user);
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
    const result = await fn(ctx, body);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
