import type { SlaBreach } from "@/data/types";
import { durationLabel, PanelState, type DataStateProps } from "./shared";

export interface SlaAlertsProps extends DataStateProps {
  breaches: SlaBreach[];
  variant?: "banner" | "expanded";
}

/** Keeps overdue response commitments visible above the ticket queue. */
export function SlaAlerts({ breaches, variant = "banner", loading, error, className = "" }: SlaAlertsProps) {
  const visible = variant === "expanded" ? breaches : breaches.slice(0, 3);
  return <section className={`sla-alerts ${breaches.length ? "has-breaches" : ""} ${className}`} aria-labelledby="sla-heading" aria-busy={loading}>
    <div className="sla-heading-row">
      <div className="sla-heading"><span className="sla-symbol" aria-hidden="true">!</span><div><h2 id="sla-heading">{breaches.length ? `${breaches.length} SLA ${breaches.length === 1 ? "breach needs" : "breaches need"} attention` : "Response SLAs are on track"}</h2><p>{breaches.length ? "These customers are waiting past the response deadline." : "No overdue tickets in your team's queue."}</p></div></div>
      {breaches.length > 0 && <a className="sla-jump" href="#ticket-queue">Review queue <span aria-hidden="true">→</span></a>}
    </div>
    <PanelState loading={loading} error={error} empty={false} emptyTitle="" emptyDescription="">
      {breaches.length > 0 && <ul className={`sla-items sla-${variant}`}>
        {visible.map((breach) => <li key={breach.ticketId}><a href={`/tickets/${breach.ticketId}`}><span className="sla-ticket"><span className="desk-number">#{breach.ticketNumber}</span><span className="sla-subject" title={breach.subject}>{breach.subject}</span><span className="sla-customer">{breach.customerName}</span></span><span className="sla-overdue desk-number">{durationLabel(breach.minutesOverdue)} overdue</span></a></li>)}
      </ul>}
      {breaches.length > visible.length && <p className="sla-more">{breaches.length - visible.length} more overdue {breaches.length - visible.length === 1 ? "ticket" : "tickets"} in the queue</p>}
    </PanelState>
  </section>;
}
