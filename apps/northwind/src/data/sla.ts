import "server-only";
import { checkDbError, scopedQuery } from "./shared";
import type { Session, SlaBreach } from "./types";
/** Read overdue, unresolved SLA timers within the session's authorized team. */
export async function getSlaBreaches(session: Session): Promise<SlaBreach[]> {
  const now = Date.now();
  const { data, error } = await scopedQuery(session, "sla_timers", "ticket_id,team,due_at,ticket:tickets!inner(number,subject,status,customer:customers!inner(name))").lt("due_at", new Date(now).toISOString()).neq("ticket.status", "resolved").order("due_at", { ascending: true }).limit(100).returns<{ ticket_id: string; team: string; due_at: string; ticket: { number: number; subject: string; status: string; customer: { name: string } } }[]>();
  checkDbError(error);
  return (data ?? []).filter(row => row.ticket.status !== "resolved").map(row => ({ ticketId: row.ticket_id, ticketNumber: row.ticket.number, team: row.team, subject: row.ticket.subject, customerName: row.ticket.customer.name, dueAt: row.due_at, minutesOverdue: Math.max(0, Math.floor((now - Date.parse(row.due_at)) / 60000)) }));
}
