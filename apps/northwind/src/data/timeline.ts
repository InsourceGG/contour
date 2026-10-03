import "server-only";
import { boundedLimit, checkDbError, scopedQuery } from "./shared";
import type { CustomerEvent, Session } from "./types";
/** Read recent customer events only from tickets within the verified session's team. */
export async function getCustomerTimeline(session: Session, options: { limit?: number; customerId?: string } = {}): Promise<CustomerEvent[]> {
  let query = scopedQuery(session, "customer_events", "id,customer_id,ticket_id,team,kind,description,created_at,customer:customers!inner(name,company),ticket:tickets!inner(number)");
  if (options.customerId) query = query.eq("customer_id", options.customerId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(boundedLimit(options.limit, 8)).returns<{ id: string; customer_id: string; ticket_id: string; team: string; kind: CustomerEvent["kind"]; description: string; created_at: string; customer: { name: string; company: string }; ticket: { number: number } }[]>();
  checkDbError(error);
  return (data ?? []).map(row => ({ id: row.id, customerId: row.customer_id, ticketId: row.ticket_id, team: row.team, kind: row.kind, description: row.description, createdAt: row.created_at, customerName: row.customer.name, customerCompany: row.customer.company, ticketNumber: row.ticket.number }));
}
