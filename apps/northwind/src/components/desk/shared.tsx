import type { ReactNode } from "react";

export interface DataStateProps {
  loading?: boolean;
  error?: string;
  className?: string;
}

export function PanelState({ loading, error, empty, emptyTitle, emptyDescription, children }: DataStateProps & { empty: boolean; emptyTitle: string; emptyDescription: string; children: ReactNode }) {
  if (loading) return <div className="desk-state" role="status"><span className="desk-loading-line" aria-hidden="true" /><span className="desk-loading-line short" aria-hidden="true" /><span>Loading support data…</span></div>;
  if (error) return <div className="desk-state desk-error" role="alert"><strong>Unable to load this section</strong><p>{error}</p><a href="/desk">Reload the desk</a></div>;
  if (empty) return <div className="desk-state"><strong>{emptyTitle}</strong><p>{emptyDescription}</p></div>;
  return children;
}

export function durationLabel(minutes: number) {
  const total = Math.max(1, Math.round(Math.abs(minutes)));
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  return total % 60 ? `${hours}h ${total % 60}m` : `${hours}h`;
}

export function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("");
}

export function shortDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function relativeTime(date: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - new Date(date).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return shortDate(date);
}
