"use client";

import type { ActivityFeed } from "@/host/readers/types";
import { formatAgo, formatDate, formatTime } from "@/components/format";
import { HostCard, Unavailable } from "./HostCard";
import { setting, type HostComponentProps } from "./types";

/**
 * Recent activity. Actor and description are untrusted text: rendered only as
 * React text nodes, never as HTML.
 */
export function Activity({ placement, data }: HostComponentProps<ActivityFeed>) {
  const limit = setting(placement.settings, "limit", [5, 10, 20] as const, 10);
  const variant = placement.variantId;

  if (!data) {
    return (
      <HostCard placement={placement} title="Recent activity">
        <Unavailable what="Recent activity" />
      </HostCard>
    );
  }
  const events = [...data.events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
  const subtitle = `Latest ${events.length}, times in UTC`;

  if (events.length === 0) {
    return (
      <HostCard placement={placement} title="Recent activity" subtitle={subtitle}>
        <p className="text-ink-2">No recent activity in this workspace.</p>
      </HostCard>
    );
  }

  if (variant === "compact") {
    return (
      <HostCard placement={placement} title="Recent activity" subtitle={subtitle}>
        <ul>
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 border-b border-rule py-[calc(var(--cs-row)*0.6)] last:border-b-0">
              <time dateTime={e.occurredAt} className="num w-12 flex-none text-[length:var(--cs-fs-sm)] text-ink-3">
                {formatTime(e.occurredAt)}
              </time>
              <p className="min-w-0 truncate" title={`${e.actor}: ${e.description}`}>
                <span className="font-semibold">{e.actor}</span> {e.description}
              </p>
            </li>
          ))}
        </ul>
      </HostCard>
    );
  }

  if (variant === "timeline") {
    const groups = new Map<string, typeof events>();
    for (const e of events) {
      const hour = e.occurredAt.slice(0, 13);
      groups.set(hour, [...(groups.get(hour) ?? []), e]);
    }
    return (
      <HostCard placement={placement} title="Recent activity" subtitle={subtitle}>
        <ol className="space-y-[var(--cs-row)]">
          {[...groups.entries()].map(([hour, list]) => (
            <li key={hour}>
              <h4 className="text-[length:var(--cs-fs-sm)] font-semibold text-ink-2">
                {formatDate(list[0].occurredAt)}, {hour.slice(11, 13)}:00
              </h4>
              <ol className="mt-1 border-l-2 border-rule pl-4">
                {list.map((e) => (
                  <li key={e.id} className="relative py-1">
                    <span className="absolute top-[0.7em] -left-[1.32rem] h-2.5 w-2.5 rounded-full border-2 border-surface bg-ink-3" aria-hidden="true" />
                    <p>
                      <span className="font-semibold">{e.actor}</span> {e.description}
                    </p>
                    <time dateTime={e.occurredAt} className="text-[length:var(--cs-fs-sm)] text-ink-3">
                      {formatTime(e.occurredAt)}
                    </time>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </HostCard>
    );
  }

  return (
    <HostCard placement={placement} title="Recent activity" subtitle={subtitle}>
      <ul className="space-y-[var(--cs-row)]">
        {events.map((e) => (
          <li key={e.id} className="flex gap-3">
            <span
              className="grid h-8 w-8 flex-none place-items-center rounded-full bg-plate text-[12px] font-semibold text-ink-2"
              aria-hidden="true"
            >
              {initials(e.actor)}
            </span>
            <div className="min-w-0">
              <p>
                <span className="font-semibold">{e.actor}</span> {e.description}
              </p>
              <time dateTime={e.occurredAt} className="text-[length:var(--cs-fs-sm)] text-ink-3">
                {formatAgo(e.occurredAt, data.observedAt)}
              </time>
            </div>
          </li>
        ))}
      </ul>
    </HostCard>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "·";
}
