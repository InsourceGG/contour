import "server-only";
import { validateViewConfig, type ViewConfig, type ViewSnapshot } from "@contour/sdk/core";
import { getCsatTrend, getCustomerTimeline, getKbArticles, getSlaBreaches, getTickets, getWorkload } from "@/data";
import type { Session } from "@/data/types";
import { getBroker } from "./broker";
import type { DeskHostData } from "./components";
import { manifest } from "./manifest";
import { contour } from "./server";

/** The desk's existing URL controls. Present values override the saved view for one page load. */
export type DeskQuery = { filter?: string; density?: string; view?: string; range?: string; kb?: string };

type QueueFilter = DeskHostData["ticket-queue"]["filter"];
const filters: QueueFilter[] = ["all", "open", "pending", "resolved", "mine"];

function patch(config: ViewConfig, componentId: string, change: (p: ViewConfig["placements"][number]) => ViewConfig["placements"][number]): ViewConfig {
  return { ...config, placements: config.placements.map((p) => (p.componentId === componentId ? change(p) : p)) };
}

/** Applies the original desk links and forms on top of a validated view, then validates again. */
export function withQuery(config: ViewConfig, query: DeskQuery): ViewConfig {
  let next = config;
  if (filters.includes(query.filter as QueueFilter)) next = patch(next, "ticket-queue", (p) => ({ ...p, settings: { ...p.settings, filter: query.filter! } }));
  if (query.view === "list" || query.view === "cards") next = patch(next, "ticket-queue", (p) => ({ ...p, variantId: query.view! }));
  if (query.range === "7d" || query.range === "30d") next = patch(next, "csat-trend", (p) => ({ ...p, settings: { ...p.settings, range: query.range! } }));
  if (query.kb === "guided" || query.kb === "collapsed") next = patch(next, "knowledge-base", (p) => ({ ...p, variantId: query.kb! }));
  if (query.density === "comfortable" || query.density === "compact") {
    // The desk's spacing control has always set queue, workload, and timeline together.
    next = { ...next, densityToken: `density.${query.density}` };
    next = patch(next, "workload", (p) => ({ ...p, variantId: query.density! }));
    next = patch(next, "customer-timeline", (p) => ({ ...p, variantId: query.density! }));
  }
  const result = validateViewConfig(manifest, next);
  return result.ok ? result.config : config;
}

async function settle<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch {
    // The component renders its own error state; other panels keep working.
    return undefined;
  }
}

/**
 * Loads host rendering data for a view with the verified host session. The
 * original data functions keep their team scope. Hidden panels are not loaded.
 */
export async function loadDeskData(session: Session, config: ViewConfig): Promise<Partial<DeskHostData>> {
  const placement = (id: string) => config.placements.find((p) => p.componentId === id);
  const shown = (id: string) => placement(id)?.visible === true;
  const filter = (placement("ticket-queue")?.settings.filter as QueueFilter | undefined) ?? "all";
  const range = placement("csat-trend")?.settings.range === "30d" ? "30d" : "7d";
  const kb = placement("knowledge-base")?.variantId === "collapsed" ? "collapsed" : "guided";
  const density = config.densityToken === "density.compact" ? "compact" : "comfortable";
  const view = placement("ticket-queue")?.variantId === "cards" ? "cards" : "list";
  const now = Date.now();
  const href = (changes: Record<string, string>) => `/desk?${new URLSearchParams({ filter, density, view, range, kb, limit: "40", ...changes }).toString()}`;

  const [breaches, tickets, points, workload, articles, events] = await Promise.all([
    shown("sla-alerts") ? settle(() => getSlaBreaches(session)) : undefined,
    shown("ticket-queue") ? settle(() => getTickets(session, { filter, limit: 40 })) : undefined,
    shown("csat-trend") ? settle(() => getCsatTrend(session, { range })) : undefined,
    shown("workload") ? settle(() => getWorkload(session)) : undefined,
    shown("knowledge-base") ? settle(() => getKbArticles(session, {})) : undefined,
    shown("customer-timeline") ? settle(() => getCustomerTimeline(session, { limit: 6 })) : undefined,
  ]);

  const data: Partial<DeskHostData> = {};
  if (breaches) data["sla-alerts"] = { breaches };
  if (tickets) data["ticket-queue"] = {
    tickets, currentUserId: session.userId, now, filter,
    filterLinks: [["all", "All tickets"], ["open", "Open"], ["pending", "Pending"]].map(([value, label]) => ({ value, label, href: href({ filter: value }) })),
    query: { range, kb },
  };
  if (points) data["csat-trend"] = { points, range, periodHrefs: { "7d": href({ range: "7d" }), "30d": href({ range: "30d" }) } };
  if (workload) data.workload = { workload };
  if (articles) data["knowledge-base"] = { articles, modeHrefs: { guided: href({ kb: "guided" }), collapsed: href({ kb: "collapsed" }) } };
  if (events) data["customer-timeline"] = { events, now };
  return data;
}

/**
 * The signed-in user's saved desk view, validated by the broker. If Contour
 * cannot be reached the company default renders, which mirrors the original
 * desk; data access still comes only from the host session.
 */
export async function loadSavedView(): Promise<{ snapshot: ViewSnapshot | null; config: ViewConfig; notice?: string }> {
  try {
    const user = await contour.requireUser();
    const snapshot = await getBroker().getSnapshot(contour.contextFromUser(user));
    return { snapshot, config: snapshot.config, notice: snapshot.source === "fallback" ? snapshot.fallbackReason : undefined };
  } catch (error) {
    console.error("[contour] saved view unavailable; showing the company default:", error instanceof Error ? error.message : "unknown error");
    return { snapshot: null, config: manifest.defaultConfig };
  }
}
