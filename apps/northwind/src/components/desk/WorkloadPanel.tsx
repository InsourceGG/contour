import type { Workload } from "@/data/types";
import { initials, PanelState, type DataStateProps } from "./shared";

export interface WorkloadPanelProps extends DataStateProps {
  data: Workload[];
  density?: "comfortable" | "compact";
}

/** Agent ownership and available capacity, keeping all counts right aligned. */
export function WorkloadPanel({ data, density = "comfortable", loading, error, className = "" }: WorkloadPanelProps) {
  const total = data.reduce((sum, person) => sum + person.open + person.pending, 0);
  return <section className={`desk-panel workload-panel density-${density} ${className}`} aria-labelledby="workload-heading" aria-busy={loading}>
    <header className="desk-panel-header"><div><h2 id="workload-heading">Team workload</h2><p><span className="desk-number">{total}</span> assigned tickets</p></div><span className="workload-legend"><span className="legend-mark" aria-hidden="true" />Open<span className="legend-mark pending" aria-hidden="true" />Pending</span></header>
    <PanelState loading={loading} error={error} empty={!data.length} emptyTitle="No agents in this team" emptyDescription="Ask an administrator to add agents to your team.">
      <ul className="workload-list">{data.map((person) => {
        const owned = person.open + person.pending;
        const denominator = Math.max(person.capacity, owned, 1);
        const overCapacity = owned > person.capacity;
        return <li key={person.userId}><div className="workload-person"><span className="desk-avatar" aria-hidden="true">{initials(person.name)}</span><div><span className="workload-name">{person.name}</span>{density === "comfortable" && <span className="workload-team">{person.team}</span>}</div><span className={`workload-count desk-number ${overCapacity ? "over-capacity" : ""}`}>{owned}<span> / {person.capacity}</span></span></div><div className="workload-track" role="img" aria-label={`${person.name}: ${person.open} open, ${person.pending} pending. Capacity ${person.capacity} tickets.${overCapacity ? " Above capacity." : ""}`}><span className="workload-open" style={{ width: `${person.open / denominator * 100}%` }} /><span className="workload-pending" style={{ width: `${person.pending / denominator * 100}%` }} /></div>{overCapacity && <span className="workload-capacity-note">Above capacity by {owned - person.capacity} {owned - person.capacity === 1 ? "ticket" : "tickets"}</span>}</li>;
      })}</ul>
      <p className="workload-footnote">Capacity includes open and pending tickets.</p>
    </PanelState>
  </section>;
}
