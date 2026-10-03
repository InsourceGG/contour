import { z } from "zod";
import { ContourError } from "@contour/sdk/core";
import { contour } from "@/server/contour";
import { adminClient } from "@/server/supabase";

/** Company-owned business action (not part of adaptation). Only the
 *  assignee may acknowledge; identity comes from the verified session. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return contour.hostMutation(request, async (vc) => {
    const taskId = z.uuid().safeParse(id);
    if (!taskId.success) throw new ContourError("INVALID_INPUT", "Invalid task id");
    const { data, error } = await adminClient()
      .from("demo_tasks")
      .update({ status: "acknowledged" })
      .eq("id", taskId.data)
      .eq("tenant_id", vc.tenantId)
      .eq("assignee_id", vc.subjectId)
      .select("id");
    if (error) throw new ContourError("INTERNAL", "Could not acknowledge");
    if (!data || data.length === 0) throw new ContourError("FORBIDDEN", "Only the assignee can acknowledge this task");
    return { ok: true, status: "acknowledged" };
  });
}
