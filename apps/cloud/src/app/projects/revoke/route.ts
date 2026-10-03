import { authenticatedForm,formFailure,go } from "@/server/forms";
import { contour } from "@/server/contour";
import { cloudDb } from "@/server/db";
import { auditUser } from "@/server/registry";
export async function POST(request: Request) {
  try {
    const {user,form} = await authenticatedForm(request);
    const revoked = await contour.oauth.revokeGrant(user.subjectId,"cloud",String(form.get("grant_id") ?? ""));
    if (!revoked) return go("/projects?error=not-found");
    await auditUser(cloudDb(),user.subjectId,"agent_grant_revoked");
    return go("/projects?revoked=1");
  } catch(error) { return formFailure(error,"/projects"); }
}
