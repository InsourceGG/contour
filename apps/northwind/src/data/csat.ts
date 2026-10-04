import "server-only";
import { z } from "zod";
import { checkDbError, scopedQuery } from "./shared";
import type { CsatPoint, Session } from "./types";
/** Return a response-weighted daily satisfaction percentage for authorized teams. */
export async function getCsatTrend(session: Session, options: { range: "7d" | "30d" }): Promise<CsatPoint[]> {
  const range = z.enum(["7d", "30d"]).parse(options.range);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (range === "7d" ? 6 : 29));
  const { data, error } = await scopedQuery(session, "csat_scores", "date,score,responses,team").gte("date", cutoff.toISOString().slice(0, 10)).order("date", { ascending: true }).limit(1000).returns<(CsatPoint & { team: string })[]>();
  checkDbError(error);
  const days = new Map<string, { total: number; count: number }>();
  for (const row of data ?? []) {
    const day = days.get(row.date) ?? { total: 0, count: 0 };
    day.total += row.score * row.responses; day.count += row.responses;
    days.set(row.date, day);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({ date, score: Math.round(day.total / day.count * 10) / 10, responses: day.count }));
}
