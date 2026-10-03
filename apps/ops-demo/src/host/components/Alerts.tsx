"use client";

import type { AlertList } from "@/host/readers/types";
import { formatAgo } from "@/components/format";
import { IconAlert, IconCheck, IconInfo, IconOctagon } from "@/components/icons";
import { HostCard } from "./HostCard";
import type { HostComponentProps } from "./types";

const RANK = { critical: 0, warning: 1, info: 2 } as const;
const SEVERITY = {
  critical: { label: "Critical", badge: "badge-critical", Icon: IconOctagon, color: "var(--color-critical)" },
  warning: { label: "Warning", badge: "badge-warning", Icon: IconAlert, color: "var(--color-warning)" },
  info: { label: "Info", badge: "badge-info", Icon: IconInfo, color: "var(--color-info)" },
} as const;

/** Required, locked alerts panel. Always visible; severity ordered. */
export function Alerts({ placement, data, density }: HostComponentProps<AlertList>) {
  if (!data) {
    // Missing data must never look like "no alerts".
    return (
      <HostCard placement={placement} title="Alerts">
        <div role="status" className="notice notice-warning">
          <IconAlert size={18} />
          <p>
            <strong>Alerts unavailable.</strong> We couldn&apos;t load active alerts. Check the incident channel before
            continuing, or reload the page.
          </p>
        </div>
      </HostCard>
    );
  }
  const alerts = [...data.alerts].sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || b.raisedAt.localeCompare(a.raisedAt),
  );
  const open = alerts.filter((a) => !a.acknowledged).length;
  const compact = density === "compact";

  return (
    <HostCard
      placement={placement}
      title="Alerts"
      subtitle={alerts.length === 0 ? "Nothing needs attention." : `${open} open of ${alerts.length} active`}
    >
      {alerts.length === 0 ? (
        <p className="flex items-center gap-2 text-ink-2">
          <IconCheck size={16} className="text-accent" />
          No active alerts.
        </p>
      ) : (
        <ul className="grid gap-[var(--cs-row)] @xl:grid-cols-2 @4xl:grid-cols-3" aria-label="Active alerts, most severe first">
          {alerts.map((a) => {
            const s = SEVERITY[a.severity];
            return (
              <li
                key={a.id}
                className="flex gap-3 rounded-[10px] border border-rule bg-white"
                style={{ padding: compact ? "0.5rem 0.625rem" : "0.75rem 0.875rem", boxShadow: `inset 3px 0 0 ${s.color}` }}
              >
                <s.Icon size={18} style={{ color: s.color, flex: "none", marginTop: 2 }} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`badge ${s.badge}`}>{s.label}</span>
                    <strong className="font-semibold">{a.title}</strong>
                  </p>
                  {!compact && <p className="mt-1 text-ink-2">{a.detail}</p>}
                  <p className="mt-1 text-[length:var(--cs-fs-sm)] text-ink-3">
                    Raised {formatAgo(a.raisedAt, data.observedAt)}
                    {a.acknowledged ? ", acknowledged" : ", not yet acknowledged"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </HostCard>
  );
}
