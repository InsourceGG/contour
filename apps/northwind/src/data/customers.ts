import "server-only";
import { boundedLimit, checkDbError, scopedQuery } from "./shared";
import type { Customer, Session } from "./types";
interface CustomerRow { id: string; name: string; company: string; email: string; plan: string; team: string; created_at: string }
const toCustomer = (row: CustomerRow): Customer => ({ id: row.id, name: row.name, company: row.company, email: row.email, plan: row.plan, team: row.team, createdAt: row.created_at });
/** List customer accounts owned by the session's authorized support team. */
export async function getCustomers(session: Session, options: { limit?: number } = {}): Promise<Customer[]> {
  const { data, error } = await scopedQuery(session, "customers", "id,name,company,email,plan,team,created_at").order("company").limit(boundedLimit(options.limit, 40)).returns<CustomerRow[]>();
  checkDbError(error);
  return (data ?? []).map(toCustomer);
}
/** Return a visible customer or null without revealing another team's account. */
export async function getCustomer(session: Session, id: string): Promise<Customer | null> {
  const { data, error } = await scopedQuery(session, "customers", "id,name,company,email,plan,team,created_at").eq("id", id).maybeSingle<CustomerRow>();
  checkDbError(error);
  return data ? toCustomer(data) : null;
}
