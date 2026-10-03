"use client";

import type { MetricsSummary } from "@/host/readers/types";
import { formatCompact, formatMoney, formatNumber, formatPct } from "@/components/format";
import { HostCard, Unavailable } from "./HostCard";
import type { HostComponentProps } from "./types";

type Metric = MetricsSummary["metrics"][number];

export function formatMetric(m: Pick<Metric, "value" | "unit">): string {
  const u = m.unit;
  if (u === "%" || u === "pct" || u === "percent") return formatPct(m.value, 1);
  if (/^[A-Z]{3}$/.test(u)) return formatMoney(m.value, u, m.value >= 100_000);
  if (u === "count" || u === "" || u === "#") return m.value >= 100_000 ? formatCompact(m.value) : formatNumber(m.value);
  return `${formatNumber(m.value, m.value % 1 === 0 ? 0 : 1)} ${u}`;
}

function Change({ m }: { m: Metric }) {
  const arrow = m.changePct > 0 ? "▲" : m.changePct < 0 ? "▼" : "■";
  const word = m.changePct > 0 ? "up" : m.changePct < 0 ? "down" : "unchanged";
  return (
    <span className="whitespace-nowrap text-[length:var(--cs-fs-sm)] text-ink-2">
      <span aria-hidden="true" className="mr-1 text-[0.7em]">
        {arrow}
      </span>
      <span className="sr-only">{word} </span>
      {formatPct(Math.abs(m.changePct), 1)}
      <span className="text-ink-3"> vs prior</span>
    </span>
  );
}

/** Key metrics: cards / annotated (with definitions) / strip. */
export function Metrics({ placement, data }: HostComponentProps<MetricsSummary>) {
  const variant = placement.variantId;
  const set = data?.set === "extended" ? "Extended set" : "Core set";

  if (!data) {
    return (
      <HostCard placement={placement} title="Key metrics">
        <Unavailable what="Key metrics" />
      </HostCard>
    );
  }

  if (variant === "strip") {
    return (
      <HostCard placement={placement} title="Key metrics" subtitle={set}>
        <dl className="flex flex-wrap gap-x-6 gap-y-3">
          {data.metrics.map((m) => (
            <div key={m.id} className="min-w-[7.5rem]">
              <dt className="text-[length:var(--cs-fs-sm)] text-ink-3">{m.label}</dt>
              <dd className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{formatMetric(m)}</span>
                <Change m={m} />
              </dd>
            </div>
          ))}
        </dl>
      </HostCard>
    );
  }

  return (
    <HostCard placement={placement} title="Key metrics" subtitle={set}>
      <ul className="grid grid-cols-1 gap-[var(--cs-gap)] @sm:grid-cols-2 @3xl:grid-cols-4">
        {data.metrics.map((m) => (
          <li key={m.id} className="rounded-[10px] border border-rule bg-white" style={{ padding: "calc(var(--cs-pad) * 0.75)" }}>
            <p className="text-[length:var(--cs-fs-sm)] font-medium text-ink-2">{m.label}</p>
            <p className="mt-1 font-semibold" style={{ fontSize: "1.5em", lineHeight: 1.1, letterSpacing: "-0.01em" }}>
              {formatMetric(m)}
            </p>
            <p className="mt-1">
              <Change m={m} />
            </p>
            {variant === "annotated" && (
              <p className="mt-2 border-t border-rule pt-2 text-[length:var(--cs-fs-sm)] text-ink-2">{m.definition}</p>
            )}
          </li>
        ))}
      </ul>
    </HostCard>
  );
}
