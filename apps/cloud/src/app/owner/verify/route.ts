import { authenticatedForm, formFailure, go } from "@/server/forms";
import { cloudDb } from "@/server/db";
import { auditUser, verifyOwnedProject } from "@/server/registry";
import { rateLimit, RateLimitError } from "@/server/rate-limit";
import { VerifyError } from "@/server/verify";
export async function POST(request: Request) {
  try {
    const { user, form } = await authenticatedForm(request), db = cloudDb();
    rateLimit(user.subjectId,"verify");
    const id = String(form.get("project_id") ?? "");
    await verifyOwnedProject(db,user.subjectId,id); await auditUser(db,user.subjectId,"project_verified",id);
    return go(`/owner?verified=${id}`);
  } catch (error) {
    if (error instanceof RateLimitError) return go("/owner?error=rate");
    if (error instanceof VerifyError) return go(`/owner?error=verification&code=${encodeURIComponent(error.code)}`);
    return formFailure(error,"/owner");
  }
}
