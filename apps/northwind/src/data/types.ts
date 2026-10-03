export type Role = "agent" | "lead" | "admin";
export interface Session { userId: string; email: string; name: string; role: Role; team: string }
export type TicketStatus = "open" | "pending" | "resolved";
export type TicketPriority = "urgent" | "high" | "normal" | "low";
export interface Ticket {
  id: string; number: number; subject: string; description: string; status: TicketStatus;
  priority: TicketPriority; team: string; customerId: string; customerName: string;
  customerCompany: string; assigneeId: string | null; assigneeName: string | null;
  createdAt: string; updatedAt: string; dueAt: string; channel: "email" | "chat" | "phone";
}
export interface SlaBreach { ticketId: string; ticketNumber: number; subject: string; customerName: string; team: string; dueAt: string; minutesOverdue: number }
export interface CsatPoint { date: string; score: number; responses: number }
export interface Workload { userId: string; name: string; team: string; open: number; pending: number; capacity: number }
export interface KbArticle { id: string; title: string; summary: string; body: string; topic: string; team: string; readMinutes: number; updatedAt: string }
export interface CustomerEvent { id: string; customerId: string; customerName: string; customerCompany: string; ticketId: string; ticketNumber: number; team: string; kind: "reply" | "opened" | "resolved" | "note"; description: string; createdAt: string }
export interface Customer { id: string; name: string; company: string; email: string; plan: string; team: string; createdAt: string }
export interface UserSettings { displayName: string; emailNotifications: boolean; slaNotifications: boolean; dailyDigest: boolean }
export interface Team { id: string; name: string; description: string; members: { id: string; name: string; email: string; role: Role }[] }
export interface TicketReply { id: string; ticketId: string; authorName: string; body: string; createdAt: string }
