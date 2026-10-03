import type { ReactNode } from "react";

/** Stat tile: sentence-case label, semibold value, optional note. */
export function StatTile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-xl border border-rule bg-surface p-4">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
      {note && <dd className="meta mt-1">{note}</dd>}
    </div>
  );
}

export function StatGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {children}
    </dl>
  );
}
