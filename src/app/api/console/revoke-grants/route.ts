import { NextResponse } from "next/server";
import { ContourError } from "@/sdk/types";
import { APP_ID, resolveHostUser } from "@/server/context";
import { assertCsrf } from "@/server/csrf";
import { errorResponse } from "@/server/http";
import { revokeAllGrantsForApp } from "@/server/oauth/grants";

/** Operator kill switch: revoke every agent grant for the operator's tenant + app. */
export async function POST(request: Request) {
  try {
    const user = await resolveHostUser();
    if (user.role !== "operator") throw new ContourError("FORBIDDEN", "Operator role required");
    assertCsrf(request, user.subjectId);
    const revoked = await revokeAllGrantsForApp(user.tenantId, APP_ID, user.subjectId);
    return NextResponse.json({ revoked, tenantId: user.tenantId, appId: APP_ID }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
