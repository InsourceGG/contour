import { NextResponse } from "next/server";
import { ContourError } from "@contour/sdk/core";
import { resolveHostUser } from "@/server/context";
import { errorResponse } from "@contour/sdk/server";
import { contour } from "@/server/contour";

/** The signed-in user disconnects one of their own agent grants. */
export async function POST(request: Request, ctx: RouteContext<"/api/host/agents/[grantId]/revoke">) {
  try {
    const { grantId } = await ctx.params;
    const user = await resolveHostUser();
    contour.assertCsrf(request, user);
    const ok = await contour.oauth.revokeGrant(user.subjectId, user.tenantId, grantId);
    if (!ok) throw new ContourError("NOT_FOUND", "Agent connection not found");
    return NextResponse.json({ revoked: true, grantId }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
