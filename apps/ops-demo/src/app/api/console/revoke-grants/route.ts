import { NextResponse } from "next/server";
import { ContourError } from "@contour/sdk/core";
import { APP_ID, resolveHostUser } from "@/server/context";
import { errorResponse } from "@contour/sdk/server";
import { contour } from "@/server/contour";

/** Operator kill switch: revoke every agent grant for the operator's tenant + app. */
export async function POST(request: Request) {
  try {
    const user = await resolveHostUser();
    if (user.role !== "operator") throw new ContourError("FORBIDDEN", "Operator role required");
    contour.assertCsrf(request, user);
    const revoked = await contour.oauth.revokeAllGrantsForApp(user.tenantId, APP_ID, user.subjectId);
    return NextResponse.json({ revoked, tenantId: user.tenantId, appId: APP_ID }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
