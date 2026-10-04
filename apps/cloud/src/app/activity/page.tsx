import Link from "next/link";
import { pageUser } from "@/server/page-auth";
import { cloudDb } from "@/server/db";
type Event = { id:number; kind:string; created_at:string; projects:{name:string;company:string}|null };
const labels: Record<string,string> = { project_created:"Project registered",project_verified:"Project verified",project_linked:"Project linked",link_created:"Project linked",project_unlinked:"Project unlinked",agent_grant_revoked:"Agent access revoked" };
export default async function Activity() {
  const user = await pageUser("/activity");
  const {data,error} = await cloudDb().from("audit_events").select("id,kind,created_at,projects(name,company)").eq("contour_user",user.subjectId).order("created_at",{ascending:false}).limit(100);
  if(error) throw new Error("Unable to load activity");
  const events = (data??[]) as Event[];
  return <><div className="page-intro"><h1>Your connection history.</h1><p>A record of the projects you register, link and unlink, and the agent access you revoke. Approvals stay in each company’s own app.</p></div>
  {!events.length ? <div className="empty narrow"><h2>Your history starts with a connection</h2><p>Link a project to see its connection activity here.</p><Link href="/projects">View available projects</Link></div> : <ol className="activity-list">{events.map(e=><li className="activity-item" key={e.id}><div><h2 className="text-lg">{labels[e.kind]??"Account activity"}</h2><p className="muted small">{e.projects ? `${e.projects.name} (${e.projects.company})` : "Your Contour account"}</p></div><time dateTime={e.created_at}>{new Date(e.created_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"UTC"})} UTC</time></li>)}</ol>}
  </>;
}
