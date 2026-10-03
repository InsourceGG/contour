import { pageUser } from "@/server/page-auth";
import { cloudDb } from "@/server/db";
import { contour } from "@/server/contour";
import type { RegistryProject } from "@/server/registry";
import { SubmitButton } from "@/components/SubmitButton";
import type { Search } from "@/components/AuthPage";
export default async function Owner({ searchParams }: { searchParams: Search }) {
  const user = await pageUser("/owner"), query = await searchParams, csrf = contour.oauth.csrfTokenFor(user);
  const { data, error } = await cloudDb().from("projects").select("id,owner_id,name,company,description,base_url,surfaces,verify_nonce,status,verified_at").eq("owner_id",user.subjectId).order("created_at",{ascending:false});
  if (error) throw new Error("Unable to load owned projects");
  const projects = (data ?? []) as RegistryProject[];
  return <><div className="page-intro"><h1>Bring your app to Contour.</h1><p>Register a company project, prove that you own its site, and make it available for people to connect.</p></div>
  {query.created && <p className="notice success" role="status">Project created. Publish the verification document below, then verify your site.</p>}
  {query.verified && <p className="notice success" role="status">Project verified. People can now link it from their projects page.</p>}
  {query.error && <p className="notice error" role="alert">{query.error === "rate" ? "Too many verification attempts. Wait a minute and try again." : query.error === "verification" ? "Verification failed. Check the published document, HTTPS URL and OAuth metadata, then try again." : query.error === "permission" ? "This form has expired. Reload the page and try again." : "Unable to save this project. Check the fields and try again."}</p>}
  <div className="owner-grid"><section className="panel"><h2>Create a project</h2><p className="muted">Use the public base URL of the app that runs Contour.</p><form className="form-stack" action="/owner/create" method="post"><input type="hidden" name="csrf" value={csrf}/><div className="form-grid">
    <div className="field"><label htmlFor="name">Project name</label><input id="name" className="input" name="name" required maxLength={100}/></div>
    <div className="field"><label htmlFor="company">Company</label><input id="company" className="input" name="company" required maxLength={100}/></div>
    <div className="field full"><label htmlFor="base-url">App base URL</label><input id="base-url" className="input" name="base_url" type="url" required placeholder="https://app.yourcompany.com" aria-describedby="url-hint"/><p id="url-hint" className="muted small">HTTPS is required for public projects.</p></div>
    <div className="field full"><label htmlFor="description">Description</label><textarea id="description" className="input" name="description" rows={3} maxLength={1000}/></div>
    <div className="field full"><label htmlFor="surfaces">Surface IDs</label><input id="surfaces" className="input" name="surfaces" required placeholder="overview, support" aria-describedby="surface-hint"/><p id="surface-hint" className="muted small">Separate the surface IDs from your Contour configuration with commas.</p></div>
  </div><SubmitButton>Create project</SubmitButton></form></section>
  <section className="owner-projects" aria-labelledby="owner-projects-heading"><div className="section-head"><h2 id="owner-projects-heading">Your projects</h2><span className="section-count">{projects.length}</span></div>
  {!projects.length && <div className="empty"><h3>Your app starts here</h3><p>Create a project to get its ID and verification nonce. Only you can see and verify your registered projects.</p></div>}
  {projects.map(p => <article className="owner-project" key={p.id} data-project-id={p.id}><header><h3>{p.name}</h3><span className={`badge ${p.status === "verified" ? "active" : "warning"}`}>{p.status === "verified" ? "Verified" : p.status === "disabled" ? "Disabled" : "Needs verification"}</span></header><p className="muted">{p.company}</p><p className="small break-anywhere">{p.base_url}</p><details open={p.status === "pending"}><summary>Verification document</summary><p className="muted small">Serve this JSON at <code>/.well-known/contour-project.json</code> on your app. The nonce proves that this project belongs to you.</p><pre className="identity-doc"><code>{JSON.stringify({projectId:p.id,nonce:p.verify_nonce},null,2)}</code></pre><p className="muted small">Your app also needs Contour’s OAuth authorization-server and MCP protected-resource metadata routes.</p></details><form action="/owner/verify" method="post"><input type="hidden" name="csrf" value={csrf}/><input type="hidden" name="project_id" value={p.id}/><SubmitButton className="button">{p.status === "verified" ? "Verify again" : "Verify project"}</SubmitButton></form></article>)}
  </section></div></>;
}
