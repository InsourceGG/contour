"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Ticket } from "@/data/types";
import { durationLabel, PanelState, type DataStateProps } from "./shared";

export interface TicketQueueProps extends DataStateProps {
  tickets: Ticket[];
  currentUserId: string;
  density?: "comfortable" | "compact";
  variant?: "list" | "cards";
  now: number;
}

const statusLabels = { open: "Open", pending: "Pending", resolved: "Resolved" };

function ActionTooltip({ id, text, children }: { id: string; text: string; children: ReactNode }) {
  const [dismissed, setDismissed] = useState(false);
  return <span className="desk-tooltip-target" data-tooltip-dismissed={dismissed} onPointerEnter={() => setDismissed(false)} onFocus={() => setDismissed(false)} onKeyDown={(event) => { if (event.key === "Escape") { setDismissed(true); event.stopPropagation(); } }}>{children}<span className="desk-tooltip" role="tooltip" id={id}>{text}</span></span>;
}

function TicketRow({ ticket, currentUserId, now }: Pick<TicketQueueProps, "currentUserId" | "now"> & { ticket: Ticket }) {
  const router = useRouter();
  const [composing, setComposing] = useState(false);
  const [pending, setPending] = useState<"assign" | "reply" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const replyButton = useRef<HTMLButtonElement>(null);
  const previouslyComposed = useRef(false);
  const isMine = ticket.assigneeId === currentUserId;
  const resolved = ticket.status === "resolved";
  const minutes = (new Date(ticket.dueAt).getTime() - now) / 60_000;
  const urgency = resolved ? "resolved" : minutes < 0 ? "breached" : minutes < 60 ? "at-risk" : "on-track";

  useEffect(() => {
    if (composing) textarea.current?.focus();
    else if (previouslyComposed.current) replyButton.current?.focus();
    previouslyComposed.current = composing;
  }, [composing]);

  function closeComposer() { setComposing(false); replyButton.current?.focus(); }

  async function submit(event: FormEvent<HTMLFormElement>, action: "assign" | "reply") {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/tickets/${encodeURIComponent(ticket.id)}/${action}`, { method: "POST", body: data, credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(response.status === 401 ? "Your session has expired. Sign in to continue." : result?.error || "Unable to save this change. Try again.");
      }
      setMessage(action === "assign" ? "Ticket assigned to you." : "Reply saved to the conversation.");
      if (action === "reply") { form.reset(); closeComposer(); }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save this change. Try again.");
      if (action === "reply") textarea.current?.focus();
    } finally { setPending(null); }
  }

  return <li className={`ticket-row ${resolved ? "is-resolved" : ""}`} id={`ticket-${ticket.id}`}>
    <div className="ticket-row-data">
      <div className="ticket-description-cell">
        <div className="ticket-id-line"><span className="desk-number ticket-id">#{ticket.number}</span><span className={`desk-chip status-${ticket.status}`}>{statusLabels[ticket.status]}</span><span className="ticket-channel">{ticket.channel}</span></div>
        <details className="ticket-detail"><summary title={ticket.subject}>{ticket.subject}</summary><div className="ticket-detail-content"><p>{ticket.description}</p><p><strong>Assigned to:</strong> {ticket.assigneeName ?? "Unassigned"}</p><a href={`/tickets/${ticket.id}`}>Open ticket conversation</a></div></details>
        <p className="ticket-customer">{ticket.customerName}<span>{ticket.customerCompany}</span></p>
      </div>
      <div className="ticket-priority-cell"><span className={`desk-chip priority-${ticket.priority}`}>{ticket.priority === "normal" ? "Normal" : ticket.priority[0].toUpperCase() + ticket.priority.slice(1)}</span><span className="ticket-assignee">{isMine ? "You" : ticket.assigneeName?.split(" ")[0] ?? "Unassigned"}</span></div>
      <div className={`ticket-sla ${urgency}`}><span className="desk-number">{resolved ? "Complete" : durationLabel(minutes)}</span><span>{resolved ? "SLA closed" : minutes < 0 ? "overdue" : "to respond"}</span><time className="sr-only" dateTime={ticket.dueAt}>Due {new Date(ticket.dueAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC</time></div>
    </div>
    <div className="ticket-actions">
      <form onSubmit={(event) => void submit(event, "assign")} action={`/api/tickets/${ticket.id}/assign`} method="post"><ActionTooltip id={`assign-tip-${ticket.id}`} text={isMine ? "You own this ticket" : "Take ownership of this ticket"}><button type="submit" className="desk-small-button" disabled={isMine || pending !== null} aria-describedby={`assign-tip-${ticket.id}`}>{pending === "assign" ? "Assign to me…" : isMine ? "Assigned to you" : "Assign to me"}</button></ActionTooltip></form>
      <ActionTooltip id={`reply-tip-${ticket.id}`} text={`Write a reply to ${ticket.customerName}`}><button ref={replyButton} type="button" className="desk-small-button reply-button" aria-expanded={composing} aria-controls={`reply-${ticket.id}`} aria-describedby={`reply-tip-${ticket.id}`} disabled={pending !== null} onClick={() => composing ? closeComposer() : setComposing(true)}>Reply</button></ActionTooltip>
    </div>
    {composing && <form className="ticket-composer" id={`reply-${ticket.id}`} action={`/api/tickets/${ticket.id}/reply`} method="post" onSubmit={(event) => void submit(event, "reply")} onKeyDown={(event) => { if (event.key === "Escape" && pending === null) closeComposer(); }}>
      <label htmlFor={`body-${ticket.id}`}>Reply to {ticket.customerName} <span className="desk-muted">(required)</span></label>
      <textarea disabled={pending === "reply"} ref={textarea} id={`body-${ticket.id}`} name="body" rows={4} required minLength={1} maxLength={5000} placeholder="Thanks for reaching out. Here is what happens next…" aria-invalid={Boolean(error)} aria-describedby={error ? `ticket-error-${ticket.id}` : undefined} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") event.currentTarget.form?.requestSubmit(); }} />
      <div className="ticket-composer-footer"><span>Saved in the customer conversation</span><div><button type="button" className="desk-small-button" disabled={pending !== null} onClick={closeComposer}>Cancel</button><button type="submit" className="desk-small-button desk-primary-button" disabled={pending !== null}>{pending === "reply" ? "Save reply…" : "Save reply"}</button></div></div>
    </form>}
    <div className="ticket-feedback" role="status">{message}</div>
    {error && <p className="ticket-error" id={`ticket-error-${ticket.id}`} role="alert">{error}{error.includes("session has expired") && <> <a href="/login">Sign in</a></>}</p>}
  </li>;
}

/** A triage queue with contextual ownership and reply actions in both layouts. */
export function TicketQueue({ tickets, currentUserId, density = "comfortable", variant = "list", now, loading, error, className = "" }: TicketQueueProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "mine" | "unassigned">("all");
  const [view, setView] = useState(variant);
  const [visibleCount, setVisibleCount] = useState(10);
  const matches = tickets.filter((ticket) => {
    const searchMatches = `${ticket.subject} ${ticket.number} ${ticket.customerName} ${ticket.customerCompany}`.toLowerCase().includes(query.toLowerCase());
    return searchMatches && (filter === "all" || (filter === "mine" ? ticket.assigneeId === currentUserId : !ticket.assigneeId));
  });
  const visible = matches.slice(0, visibleCount);
  const remaining = matches.length - visible.length;

  return <section className={`desk-panel ticket-queue density-${density} queue-${view} ${className}`} id="ticket-queue" aria-labelledby="queue-heading" aria-busy={loading}>
    <header className="desk-panel-header"><div><h2 id="queue-heading">Ticket queue <span className="desk-count desk-number">{tickets.length}</span></h2><p>Prioritize the next response.</p></div><div className="desk-segment" aria-label="Queue layout"><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>List</button><button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}>Cards</button></div></header>
    <div className="queue-tools"><label className="queue-search"><span className="sr-only">Search tickets</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(10); }} placeholder="Search tickets or customers" /></label><label className="queue-filter"><span className="sr-only">Ticket assignment</span><select value={filter} onChange={(event) => { setFilter(event.target.value as typeof filter); setVisibleCount(10); }}><option value="all">All tickets</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option></select></label></div>
    <div className="queue-column-headings" aria-hidden="true"><span>Ticket / customer</span><span>Priority / owner</span><span>Response SLA</span></div>
    <PanelState loading={loading} error={error} empty={!tickets.length} emptyTitle="The queue is clear" emptyDescription="New customer requests will appear here when they arrive.">
      {!matches.length ? <div className="desk-state"><strong>No matching tickets</strong><p>Try a different customer name or assignment filter.</p><button type="button" className="desk-small-button" onClick={() => { setQuery(""); setFilter("all"); setVisibleCount(10); }}>Clear filters</button></div> : <ul className="ticket-list">{visible.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} currentUserId={currentUserId} now={now} />)}</ul>}
      <footer className="queue-footer"><span className="desk-number" role="status">Showing {visible.length} of {matches.length} {query || filter !== "all" ? "matching " : ""}tickets{matches.length !== tickets.length ? ` (${tickets.length} in queue)` : ""}</span>{remaining > 0 ? <button type="button" className="desk-small-button" onClick={() => setVisibleCount((count) => count + 10)}>Load {Math.min(remaining, 10)} more tickets</button> : <span>Expand a subject for details</span>}</footer>
    </PanelState>
  </section>;
}
