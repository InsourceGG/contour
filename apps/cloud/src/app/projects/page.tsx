import Link from "next/link";
import { pageUser } from "@/server/page-auth";
import { cloudDb } from "@/server/db";
import { listLinks } from "@/server/links";
import { contour } from "@/server/contour";
import { env } from "@/server/env";
import { CopyCommand } from "@/components/CopyCommand";
import { SubmitButton } from "@/components/SubmitButton";
import type { Search } from "@/components/AuthPage";
type Available = { id:string; name:string; company:string; description:string };
export default async function Projects({ searchParams }: { searchParams: Search }) {
  const user = await pageUser("/projects"), query = await searchParams, db = cloudDb(), csrf = contour.oauth.csrfTokenFor(user);
  const [links,grants,available] = await Promise.all([
    listLinks(db,user.subjectId),contour.oauth.listGrantsForUser(user.subjectId,"cloud"),
    db.from("projects").select("id,name,company,description").eq("status","verified").order("name"),
  ]);
  if (available.error) throw new Error("Unable to load available projects");
  const ids = new Set(links.map(l=>l.projectId)), projects = ((available.data ?? []) as Available[]).filter(p=>!ids.has(p.id));
  const activeGrants = grants.filter(g=>!g.revokedAt);
  const error = query.error;
  return <><div className="page-intro"><h1>Your projects, together.</h1><p>Link a company project, then let your agent help you find the right view. You stay in control of every change.</p></div>
    {query.linked && <p className="notice success" role="status">Project linked. Your agent can now find it through Contour.</p>}
    {query.declined && <p className="notice" role="status">Connection declined. You can connect this project whenever you are ready.</p>}
    {query.unlinked && <p className="notice" role="status">Project unlinked. Contour has removed its access tokens.{query.revocation === "unconfirmed" ? " Company revocation could not be confirmed. Review connected applications in the company app." : ""}</p>}
    {query.revoked && <p className="notice success" role="status">Agent access revoked. This connection can no longer use your projects.</p>}
    {error && <p className="notice error" role="alert">{error === "INVALID_STATE" || error === "ISSUER_MISMATCH" ? "This connection link is invalid or has expired. Start a new connection below." : error === "RATE_LIMITED" ? "Too many connection attempts. Wait a minute and try again." : error === "changed" ? "This project was reconnected while you were unlinking it. Review the current connection and try again." : error === "permission" ? "This form has expired. Reload the page and try again." : "Unable to complete this connection. Try again below, or sign in at the company to check your access."}</p>}
    <div className="hub-grid"><div className="hub-main"><section aria-labelledby="linked-heading"><div className="section-head"><h2 id="linked-heading">Linked projects</h2><span className="section-count">{links.length}</span></div>
    {!links.length ? <div className="empty"><h3>Connect your first project</h3><p>Choose a company below and sign in there to link your account. Your company decides what your agent can access.</p><a href="#available-heading">Browse available projects</a></div> : <ul className="project-list">{links.map(p=><li className="project-row" key={p.projectId}><span className="project-initial" aria-hidden="true">{p.company[0]}</span><div className="project-info"><h3>{p.name}</h3><p className="muted small">{p.company}</p><span className={`badge ${p.status === "active" ? "active" : "warning"}`}>{p.status === "active" ? "Active" : "Needs reconnect"}</span></div><div className="row-actions">{p.status !== "active" && <Link href={`/link/start?project=${p.projectId}`} className="button">Reconnect</Link>}<form action="/projects/unlink" method="post"><input type="hidden" name="csrf" value={csrf}/><input type="hidden" name="project_id" value={p.projectId}/><SubmitButton className="button">Unlink</SubmitButton></form></div></li>)}</ul>}
    </section><section aria-labelledby="available-heading"><div className="section-head"><h2 id="available-heading">Available projects</h2><span className="section-count">{projects.length}</span></div>
    {!projects.length ? <div className="empty"><h3>{links.length ? "You’re connected to every available project" : "No projects available yet"}</h3><p>{links.length ? "New company projects will appear here when they are verified." : "Ask your company to register its app with Contour. Verified projects appear here for you to connect."}</p><Link href="/owner">Register a company project</Link></div> : <ul className="project-list">{projects.map(p=><li className="project-row" key={p.id}><span className="project-initial" aria-hidden="true">{p.company[0]}</span><div className="project-info"><h3>{p.name}</h3><p className="muted small">{p.company}</p>{p.description && <p className="project-description muted">{p.description}</p>}</div><div className="row-actions"><Link className="button" href={`/link/start?project=${p.id}`}>Connect</Link></div></li>)}</ul>}
    </section></div><aside className="panel agent-panel" aria-labelledby="agent-heading"><h2 id="agent-heading">Connect your AI agent</h2><p>Run this command in your terminal to connect Claude to Contour. Sign in and choose what to share when prompted.</p><CopyCommand command={`claude mcp add --transport http contour ${env.appUrl}/api/mcp`}/><ul className="agent-limits"><li>Find and link company projects.</li><li>Read permitted data and propose views.</li><li>Every change needs your approval in the company app. Agents can never save anything.</li></ul><section className="grants" aria-labelledby="grants-heading"><h3 id="grants-heading">Agent connections</h3>{!activeGrants.length ? <p className="muted small">No agents connected yet. After you approve a connection, you can revoke it here.</p> : activeGrants.map(g=><div className="grant" key={g.id}><div><p>{g.clientName}</p><p className="muted small">{new Date(g.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}</p></div><form action="/projects/revoke" method="post"><input type="hidden" name="csrf" value={csrf}/><input type="hidden" name="grant_id" value={g.id}/><SubmitButton className="button danger">Revoke</SubmitButton></form></div>)}</section></aside></div></>;
}
