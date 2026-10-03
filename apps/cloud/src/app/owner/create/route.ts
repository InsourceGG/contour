import { authenticatedForm, formFailure, go } from "@/server/forms";
import { cloudDb } from "@/server/db";
import { auditUser, createProject } from "@/server/registry";
export async function POST(request: Request) {
  try {
    const { user, form } = await authenticatedForm(request), db = cloudDb();
    const id = await createProject(db, user.subjectId, { name: String(form.get("name") ?? ""), company: String(form.get("company") ?? ""), description: String(form.get("description") ?? ""), base_url: String(form.get("base_url") ?? ""), surfaces: [...new Set(String(form.get("surfaces") ?? "").split(",").map(s => s.trim()).filter(Boolean))] });
    await auditUser(db,user.subjectId,"project_created",id);
    return go(`/owner?created=${id}`);
  } catch (error) { return formFailure(error,"/owner"); }
}
