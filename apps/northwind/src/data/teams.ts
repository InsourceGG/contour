import "server-only";
import { getDb } from "@/lib/db";
import { assertSession, checkDbError } from "./shared";
import type { Session, Team } from "./types";
/** Return the team management directory exclusively to Northwind administrators. */
export async function getTeams(session: Session): Promise<Team[]> {
  assertSession(session);
  if (session.role !== "admin") throw new Error("Administrator access required.");
  const { data, error } = await getDb().from("teams").select("id,name,description,members:users(id,name,email,role)").order("name").returns<Team[]>();
  checkDbError(error);
  return data ?? [];
}
