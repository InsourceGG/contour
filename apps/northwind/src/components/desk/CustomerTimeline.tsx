import type { CustomerEvent } from "@/data/types";
import { initials, PanelState, relativeTime, type DataStateProps } from "./shared";

export interface CustomerTimelineProps extends DataStateProps {
  events: CustomerEvent[];
  density?: "comfortable" | "compact";
  now: number;
}

const eventLabels = { reply: "Reply added", opened: "Ticket opened", resolved: "Ticket resolved", note: "Internal note" };

/** A chronological customer activity feed with context linked back to the queue. */
export function CustomerTimeline({ events, density = "comfortable", now, loading, error, className = "" }: CustomerTimelineProps) {
  return <section className={`desk-panel customer-timeline density-${density} ${className}`} aria-labelledby="timeline-heading" aria-busy={loading}>
    <header className="desk-panel-header"><div><h2 id="timeline-heading">Customer timeline</h2><p>Recent conversations and updates</p></div></header>
    <PanelState loading={loading} error={error} empty={!events.length} emptyTitle="No customer activity yet" emptyDescription="Replies, internal notes, and ticket updates will appear here.">
      <ol className="timeline-list">{events.map((event) => <li key={event.id} className={`timeline-${event.kind}`}><span className="timeline-avatar desk-avatar" aria-hidden="true">{initials(event.customerName)}</span><div className="timeline-entry"><div className="timeline-entry-heading"><strong>{event.customerName}</strong><time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC"}>{relativeTime(event.createdAt, now)}</time></div><div className="timeline-event-meta"><span className={`timeline-kind ${event.kind === "resolved" ? "positive" : ""}`}>{eventLabels[event.kind]}</span><a href={`/tickets/${event.ticketId}`} className="desk-number" aria-label={`Open ticket ${event.ticketNumber}`}>#{event.ticketNumber}</a></div>{density === "comfortable" ? <p>{event.description}</p> : <details className="timeline-details"><summary>View update</summary><p>{event.description}</p></details>}</div></li>)}</ol>
    </PanelState>
  </section>;
}
