import { authenticatedForm, formFailure, go } from "@/server/forms";
import { cloudDb } from "@/server/db";
import { decrypt } from "@/server/vault";
import { pinnedFetchJson } from "@/server/pinned-fetch";
import { clientIdFor } from "@/server/project-client";
import { auditUser } from "@/server/registry";
export async function POST(request: Request) {
  try {
    const { user,form } = await authenticatedForm(request), db = cloudDb(), id = String(form.get("project_id") ?? "");
    const { data: link,error } = await db.from("links").select("refresh_ct,key_id,projects(id,name,company,verified_at,mcp_resource,as_issuer,token_endpoint,revocation_endpoint,registration_endpoint,dcr_client_id)").eq("contour_user",user.subjectId).eq("project_id",id).maybeSingle();
    if (error || !link) return go("/projects?error=not-found");
    // Read metadata only through this user's owned grant. A disabled registry
    // project still needs company-side revocation when its link is removed.
    const row = link.projects;
    const project = row?.verified_at ? { id: row.id, name: row.name, company: row.company,
      mcpResource: row.mcp_resource, asIssuer: row.as_issuer, tokenEndpoint: row.token_endpoint,
      revocationEndpoint: row.revocation_endpoint, registrationEndpoint: row.registration_endpoint,
      dcrClientId: row.dcr_client_id } : null;
    let remoteRevoked = false;
    if (project?.revocationEndpoint) {
      try {
        const clientId = await clientIdFor(project);
        const response = await pinnedFetchJson(project.revocationEndpoint,{ method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body: new URLSearchParams({ token:decrypt(link.refresh_ct,link.key_id),token_type_hint:"refresh_token",client_id:clientId }).toString(),maxBytes:262144,timeoutMs:8000 });
        remoteRevoked = response.status === 200;
      } catch { /* Always remove Cloud access, even if the company is offline. */ }
    }
    const deleted = await db.from("links").delete().eq("contour_user",user.subjectId).eq("project_id",id)
      .eq("refresh_ct",link.refresh_ct).eq("key_id",link.key_id).select("project_id");
    if (deleted.error) throw new Error("Unable to remove connection");
    if (!deleted.data?.length) return go("/projects?error=changed");
    await auditUser(db,user.subjectId,"project_unlinked",id);
    return go(`/projects?unlinked=${id}${remoteRevoked ? "" : "&revocation=unconfirmed"}`);
  } catch(error) { return formFailure(error,"/projects"); }
}
