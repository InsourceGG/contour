import "server-only";
import { checkDbError, scopedQuery } from "./shared";
import type { Session, Workload } from "./types";
/** Count active tickets per teammate without crossing an agent or lead's team boundary. */
export async function getWorkload(session: Session): Promise<Workload[]> {
  const [users, tickets] = await Promise.all([
    scopedQuery(session, "users", "id,name,team,capacity").order("name").limit(100).returns<{ id: string; name: string; team: string; capacity: number }[]>(),
    scopedQuery(session, "tickets", "assignee_id,status,team").neq("status", "resolved").limit(5000).returns<{ assignee_id: string | null; status: string; team: string }[]>(),
  ]);
  checkDbError(users.error); checkDbError(tickets.error);
  return (users.data ?? []).map(user => ({ userId: user.id, name: user.name, team: user.team, capacity: user.capacity, open: (tickets.data ?? []).filter(ticket => ticket.assignee_id === user.id && ticket.status === "open").length, pending: (tickets.data ?? []).filter(ticket => ticket.assignee_id === user.id && ticket.status === "pending").length }));
}
