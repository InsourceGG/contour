import "server-only";
import { getDb } from "@/lib/db";
import type { Session } from "./types";
export function assertSession(session: Session): void {
  if (!session?.userId || !session.team || !["agent", "lead", "admin"].includes(session.role)) throw new Error("Authentication required.");
}
/** Central query scope supplements the session check in every public data function. */
export function scopedQuery(session: Session, table: string, columns: string) {
  assertSession(session);
  const query = getDb().from(table).select(columns);
  return session.role === "admin" ? query : query.eq("team", session.team);
}
export function boundedLimit(value: number | undefined, fallback: number, max = 100): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value!))) : fallback;
}
export function checkDbError(error: { message: string } | null): void {
  if (error) throw new Error("Northwind could not complete that request. Please try again.");
}
