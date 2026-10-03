"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { SurfaceComponentMap, SurfaceComponentProps } from "@contour/sdk/react";
import type { CsatPoint, CustomerEvent, KbArticle, SlaBreach, Ticket, Workload } from "@/data/types";
import { CsatTrend, CustomerTimeline, KnowledgeBase, SlaAlerts, TicketQueue, WorkloadPanel } from "@/components/desk";

/**
 * Host renderers for the adaptive desk. Each adapter maps an approved
 * placement (variant, settings, density) onto the existing component's props.
 * Data, user IDs, time, and links come from the host's own permission-scoped
 * loaders in surface-data.ts, never from an agent.
 */

type TicketQueueData = {
  tickets: Ticket[];
  currentUserId: string;
  now: number;
  filter: "all" | "open" | "pending" | "resolved" | "mine";
  filterLinks: { value: string; label: string; href: string }[];
  query: { range: string; kb: string };
};
type CsatTrendData = { points: CsatPoint[]; range: "7d" | "30d"; periodHrefs: Record<"7d" | "30d", string> };

export type DeskHostData = {
  "sla-alerts": { breaches: SlaBreach[] };
  /** `alternates` holds host-loaded data for a pending proposal's other filter, so a live preview shows matching rows. */
  "ticket-queue": TicketQueueData & { alternates?: TicketQueueData[] };
  "csat-trend": CsatTrendData & { alternates?: CsatTrendData[] };
  workload: { workload: Workload[] };
  "knowledge-base": { articles: KbArticle[]; modeHrefs: Record<"guided" | "collapsed", string> };
  "customer-timeline": { events: CustomerEvent[]; now: number };
};

type Props<K extends keyof DeskHostData> = SurfaceComponentProps<DeskHostData[K]>;

const unavailable = "This section is unavailable right now.";

/** Previews are read-only: every action and link inside is inert. */
function PreviewGuard({ preview, children }: { preview?: boolean; children: ReactNode }) {
  return preview ? <div inert>{children}</div> : <>{children}</>;
}

function SlaAlertsAdapter({ placement, data, preview }: Props<"sla-alerts">) {
  return <PreviewGuard preview={preview}>
    <SlaAlerts breaches={data?.breaches ?? []} error={data ? undefined : unavailable} variant={placement.variantId === "expanded" ? "expanded" : "banner"} />
  </PreviewGuard>;
}

/** The loaded data set that matches the placement being rendered (current view or live proposal). */
function matching<T>(data: (T & { alternates?: T[] }) | undefined, matches: (d: T) => boolean): T | undefined {
  if (!data) return undefined;
  return matches(data) ? data : data.alternates?.find(matches) ?? data;
}

function TicketQueueAdapter({ placement, data: loaded, density, preview }: Props<"ticket-queue">) {
  const variant = placement.variantId === "cards" ? "cards" : "list";
  const data = matching(loaded, (d) => d.filter === (placement.settings.filter ?? "all"));
  if (!data) return <TicketQueue tickets={[]} currentUserId="" now={0} error={unavailable} density={density} variant={variant} />;
  return <PreviewGuard preview={preview}><div>
    <div className="desk-toolbar"><nav className="filter-tabs" aria-label="Ticket queue filters">{data.filterLinks.map(({ value, label, href }) => <Link href={href} key={value} aria-current={data.filter === value ? "page" : undefined}>{label}</Link>)}</nav><div className="view-options"><details><summary>Queue view</summary><div className="view-option-menu"><form action="/desk" method="get"><input type="hidden" name="filter" value={data.filter} /><input type="hidden" name="range" value={data.query.range} /><input type="hidden" name="kb" value={data.query.kb} /><label>Spacing<select name="density" defaultValue={density}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button className="button button-small" type="submit">Apply view</button></form></div></details></div></div>
    <TicketQueue tickets={data.tickets} key={`${data.filter}-${variant}`} currentUserId={data.currentUserId} density={density} variant={variant} now={data.now} />
  </div></PreviewGuard>;
}

function CsatTrendAdapter({ placement, data: loaded, preview }: Props<"csat-trend">) {
  const range = placement.settings.range === "30d" ? "30d" : "7d";
  const data = matching(loaded, (d) => d.range === range);
  return <PreviewGuard preview={preview}><div>
    <CsatTrend data={data?.points ?? []} error={data ? undefined : unavailable} range={range} presentation={placement.variantId === "summary" ? "summary" : "chart"} periodHrefs={data?.periodHrefs} />
  </div></PreviewGuard>;
}

function WorkloadAdapter({ placement, data, preview }: Props<"workload">) {
  return <PreviewGuard preview={preview}>
    <WorkloadPanel data={data?.workload ?? []} error={data ? undefined : unavailable} density={placement.variantId === "compact" ? "compact" : "comfortable"} />
  </PreviewGuard>;
}

function KnowledgeBaseAdapter({ placement, data, preview }: Props<"knowledge-base">) {
  const mode = placement.variantId === "collapsed" ? "collapsed" : "guided";
  return <PreviewGuard preview={preview}><div>
    <KnowledgeBase articles={data?.articles ?? []} error={data ? undefined : unavailable} mode={mode} />
    {data && <Link className="panel-variant-link" href={data.modeHrefs[mode === "guided" ? "collapsed" : "guided"]}>{mode === "guided" ? "Use compact article list" : "Use guided article list"}</Link>}
  </div></PreviewGuard>;
}

function CustomerTimelineAdapter({ placement, data, preview }: Props<"customer-timeline">) {
  return <PreviewGuard preview={preview}>
    <CustomerTimeline events={data?.events ?? []} error={data ? undefined : unavailable} density={placement.variantId === "compact" ? "compact" : "comfortable"} now={data?.now ?? 0} />
  </PreviewGuard>;
}

export const componentMap = {
  "sla-alerts": SlaAlertsAdapter,
  "ticket-queue": TicketQueueAdapter,
  "csat-trend": CsatTrendAdapter,
  workload: WorkloadAdapter,
  "knowledge-base": KnowledgeBaseAdapter,
  "customer-timeline": CustomerTimelineAdapter,
} as SurfaceComponentMap;
