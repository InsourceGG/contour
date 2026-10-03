import { NextResponse } from "next/server";
import { ContourError } from "@contour/sdk/core";
import { errorResponse } from "@contour/sdk/server";
import { getBroker } from "@/server/broker";
import { resolveHostContext } from "@/server/context";

/** Host session only: a pending proposal never grants commit permission. */
export async function GET() {
  try {
    const ctx = await resolveHostContext();
    if (!ctx.scopes.has("view:read")) throw new ContourError("FORBIDDEN", "View read permission required");
    // getLive uses the shared service-only limiter: 150 requests per 60 seconds.
    return NextResponse.json(await getBroker().getLive(ctx), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const response = errorResponse(err);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
