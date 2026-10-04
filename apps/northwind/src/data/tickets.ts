import "server-only";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { assertSession, boundedLimit, checkDbError, scopedQuery } from "./shared";
import type { Session, Ticket, TicketReply, TicketStatus } from "./types";
interface TicketRow {
  id: string; number: number; subject: string; description: string; status: Ticket["status"]; priority: Ticket["priority"]; team: string;
  customer_id: string; assignee_id: string | null; created_at: string; updated_at: string; due_at: string; channel: Ticket["channel"];
  customer: { name: string; company: string }; assignee: { name: string } | null;
}
const columns = "id,number,subject,description,status,priority,team,customer_id,assignee_id,created_at,updated_at,due_at,channel,customer:customers!inner(name,company),assignee:users!tickets_assignee_id_fkey(name)";
function toTicket(row: TicketRow): Ticket {
  return { id: row.id, number: row.number, subject: row.subject, description: row.description, status: row.status, priority: row.priority, team: row.team, customerId: row.customer_id, customerName: row.customer.name, customerCompany: row.customer.company, assigneeId: row.assignee_id, assigneeName: row.assignee?.name ?? null, createdAt: row.created_at, updatedAt: row.updated_at, dueAt: row.due_at, channel: row.channel };
}
/** Read tickets within the verified user's team; admins may read every team. */
export async function getTickets(session: Session, options: { filter?: TicketStatus | "all" | "mine"; limit?: number } = {}): Promise<Ticket[]> {
  let query = scopedQuery(session, "tickets", columns);
  if (options.filter === "mine") query = query.eq("assignee_id", session.userId);
  else if (options.filter && options.filter !== "all") query = query.eq("status", z.enum(["open", "pending", "resolved"]).parse(options.filter));
  const { data, error } = await query.order("due_at", { ascending: true }).limit(boundedLimit(options.limit, 40)).returns<TicketRow[]>();
  checkDbError(error);
  return (data ?? []).map(toTicket);
}
/** Read one ticket, concealing tickets belonging to another team. */
export async function getTicket(session: Session, id: string): Promise<Ticket | null> {
  const { data, error } = await scopedQuery(session, "tickets", columns).eq("id", id).maybeSingle<TicketRow>();
  checkDbError(error);
  return data ? toTicket(data) : null;
}
/** Assign a visible ticket to the current user; the UPDATE independently repeats its team scope. */
export async function assignTicket(session: Session, id: string): Promise<void> {
  assertSession(session);
  const ticket = await getTicket(session, id);
  if (!ticket) throw new Error("Ticket not found.");
  let query = getDb().from("tickets").update({ assignee_id: session.userId, updated_at: new Date().toISOString() }).eq("id", id);
  if (session.role !== "admin") query = query.eq("team", session.team);
  const { data, error } = await query.select("id");
  checkDbError(error);
  if (!data?.length) throw new Error("Ticket not found.");
}
/** Persist a reply only after confirming the ticket is visible to this verified session. */
export async function replyToTicket(session: Session, id: string, body: string): Promise<void> {
  assertSession(session);
  const text = z.string().trim().min(1, "Write a reply first.").max(5000, "Replies can contain up to 5,000 characters.").parse(body);
  const ticket = await getTicket(session, id);
  if (!ticket) throw new Error("Ticket not found.");
  const { error } = await getDb().from("ticket_replies").insert({ ticket_id: id, team: ticket.team, author_id: session.userId, body: text });
  checkDbError(error);
}
/** Read a ticket's reply history after checking visibility of its parent ticket. */
export async function getTicketReplies(session: Session, id: string): Promise<TicketReply[]> {
  assertSession(session);
  if (!await getTicket(session, id)) throw new Error("Ticket not found.");
  const { data, error } = await scopedQuery(session, "ticket_replies", "id,ticket_id,body,created_at,author:users(name)").eq("ticket_id", id).order("created_at", { ascending: true }).limit(100).returns<{ id: string; ticket_id: string; body: string; created_at: string; author: { name: string } }[]>();
  checkDbError(error);
  return (data ?? []).map(row => ({ id: row.id, ticketId: row.ticket_id, body: row.body, authorName: row.author.name, createdAt: row.created_at }));
}
