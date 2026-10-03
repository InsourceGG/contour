import { NextResponse } from "next/server";
import { z } from "zod";
import { ContourError } from "@/sdk/types";
import { requireOperator } from "@/server/console";
import { APP_ID } from "@/server/context";
import { assertCsrf } from "@/server/csrf";
import { errorResponse } from "@/server/http";
import { adminClient } from "@/server/supabase";

/** Company kill switch: enable/disable all personal-agent (MCP) access for the app. */
export async function POST(request: Request) {
  try {
    const user = await requireOperator();
    assertCsrf(request, user.subjectId);
    const body = z.strictObject({ enabled: z.boolean() }).safeParse(await request.json().catch(() => null));
    if (!body.success) throw new ContourError("INVALID_INPUT", "Expected {enabled:boolean}");
    const db = adminClient();
    const { error } = await db
      .from("apps")
      .update({ agent_access_enabled: body.data.enabled, updated_at: new Date().toISOString() })
      .eq("id", APP_ID);
    if (error) throw new ContourError("INTERNAL", "Could not update agent access");
    await db.from("audit_events").insert({
      tenant_id: user.tenantId,
      app_id: APP_ID,
      subject_id: user.subjectId,
      kind: body.data.enabled ? "agent_access_enabled" : "agent_access_disabled",
      ref: APP_ID,
    });
    return NextResponse.json({ ok: true, enabled: body.data.enabled });
  } catch (err) {
    return errorResponse(err);
  }
}
