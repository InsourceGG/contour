import { NextResponse } from "next/server";
import { z } from "zod";
import { ContourError } from "@/sdk/types";
import { requireOperator } from "@/server/console";
import { APP_ID } from "@/server/context";
import { assertCsrf } from "@/server/csrf";
import { errorResponse } from "@/server/http";
import { adminClient } from "@/server/supabase";

/** Tenant kill switch: enable/disable personal-agent (MCP) access for the operator's workspace. */
export async function POST(request: Request) {
  try {
    const user = await requireOperator();
    assertCsrf(request, user);
    const body = z.strictObject({ enabled: z.boolean() }).safeParse(await request.json().catch(() => null));
    if (!body.success) throw new ContourError("INVALID_INPUT", "Expected {enabled:boolean}");
    const db = adminClient();
    // Scoped to the operator's own tenant; the company-wide master switch
    // (apps.agent_access_enabled) is not tenant-operator controllable.
    const { error } = await db.from("tenant_app_settings").upsert(
      {
        tenant_id: user.tenantId,
        app_id: APP_ID,
        agent_access_enabled: body.data.enabled,
        updated_at: new Date().toISOString(),
        updated_by: user.subjectId,
      },
      { onConflict: "tenant_id,app_id" },
    );
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
