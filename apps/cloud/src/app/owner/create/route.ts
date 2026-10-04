import { authenticatedForm, formFailure, go } from "@/server/forms";
import { cloudDb } from "@/server/db";
import { auditUser, createProject, ProjectLimitError } from "@/server/registry";
import { rateLimit, RateLimitError } from "@/server/rate-limit";
export async function POST(request: Request) {
  try {
    const { user, form } = await authenticatedForm(request), db = cloudDb();
    rateLimit(user.subjectId, "create");
    const id = await createProject(db, user.subjectId, { name: String(form.get("name") ?? ""), company: String(form.get("company") ?? ""), description: String(form.get("description") ?? ""), base_url: String(form.get("base_url") ?? ""), surfaces: [...new Set(String(form.get("surfaces") ?? "").split(",").map(s => s.trim()).filter(Boolean))] });
    await auditUser(db,user.subjectId,"project_created",id);
    return go(`/owner?created=${id}`);
  } catch (error) {
    if (error instanceof RateLimitError) return go("/owner?error=rate");
    if (error instanceof ProjectLimitError) return go("/owner?error=limit");
    return formFailure(error,"/owner");
  }
}
