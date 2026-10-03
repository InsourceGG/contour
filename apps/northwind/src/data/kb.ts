import "server-only";
import { checkDbError, scopedQuery } from "./shared";
import type { KbArticle, Session } from "./types";
/** Read support articles approved for the session's team, optionally narrowing by topic. */
export async function getKbArticles(session: Session, options: { topic?: string } = {}): Promise<KbArticle[]> {
  let query = scopedQuery(session, "kb_articles", "id,title,summary,body,topic,team,read_minutes,updated_at");
  if (options.topic) query = query.eq("topic", options.topic);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(30).returns<{ id: string; title: string; summary: string; body: string; topic: string; team: string; read_minutes: number; updated_at: string }[]>();
  checkDbError(error);
  return (data ?? []).map(row => ({ id: row.id, title: row.title, summary: row.summary, body: row.body, topic: row.topic, team: row.team, readMinutes: row.read_minutes, updatedAt: row.updated_at }));
}
