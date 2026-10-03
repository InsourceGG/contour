"use client";

import type { RevenueSummary } from "@/host/readers/types";
import { formatDate, formatMoney, formatPct } from "@/components/format";
import { HostCard, Unavailable } from "./HostCard";
import { RevenueChart } from "./RevenueChart";
import { setting, type HostComponentProps } from "./types";

/** Revenue trend: summary, annotated (plain-language callouts) and dense (daily values) variants. */
export function Revenue({ placement, data, density, preview }: HostComponentProps<RevenueSummary>) {
  const period = setting(placement.settings, "period", ["7d", "30d"] as const, "30d");
  const showLegend = setting(placement.settings, "showLegend", [true, false] as const, true);
  const periodLabel = period === "7d" ? "Last 7 days" : "Last 30 days";

  if (!data) {
    return (
      <HostCard placement={placement} title="Net revenue" subtitle={periodLabel}>
        <Unavailable what="Revenue" />
      </HostCard>
    );
  }

  // Respect the configured period even if the reader returned a longer window.
  const points = period === "7d" && data.points.length > 7 ? data.points.slice(-7) : data.points;
  const sliced = points !== data.points;
  const total = sliced ? points.reduce((a, p) => a + p.net, 0) : data.total;
  const lo = sliced ? points.reduce((m, p) => (p.net < m.net ? p : m), points[0]) : data.min;
  const hi = sliced ? points.reduce((m, p) => (p.net > m.net ? p : m), points[0]) : data.max;
  const inRange = new Set(points.map((p) => p.date));
  const annotations = data.annotations.filter((a) => inRange.has(a.date));
  const change = data.changePct;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const summary = `Net revenue, ${periodLabel.toLowerCase()}: ${formatMoney(total, data.currency)} total, ${direction} ${formatPct(Math.abs(change))} versus the previous period.`;
  const variant = placement.variantId;
  const chartHeight = density === "compact" ? 150 : 200;

  const legend = showLegend && (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[length:var(--cs-fs-sm)] text-ink-2" aria-label="Legend">
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--color-series-1)" }} aria-hidden="true" />
        Daily net revenue
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-px w-4" style={{ background: "var(--color-ink-3)" }} aria-hidden="true" />
        Period average
      </li>
      {variant === "annotated" && annotations.length > 0 && (
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-ink" aria-hidden="true" />
          Numbered note
        </li>
      )}
    </ul>
  );

  const headline = (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p className="font-semibold" style={{ fontSize: density === "compact" ? "1.75rem" : "2.5rem", lineHeight: 1.05, letterSpacing: "-0.02em" }}>
        {formatMoney(total, data.currency)}
      </p>
      <p className="text-[length:var(--cs-fs-sm)] text-ink-2">
        <span className="font-semibold text-ink">{formatPct(change, 1, true)}</span> vs previous {period === "7d" ? "7" : "30"} days
      </p>
    </div>
  );

  return (
    <HostCard placement={placement} title="Net revenue" subtitle={`${periodLabel}, ${data.currency}`}>
      {variant !== "dense" && headline}

      {variant === "dense" ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @md:grid-cols-4">
            <Stat label="Total" value={formatMoney(total, data.currency)} />
            <Stat label="Change" value={formatPct(change, 1, true)} />
            <Stat label="Lowest day" value={formatMoney(lo.net, data.currency)} note={formatDate(lo.date)} />
            <Stat label="Highest day" value={formatMoney(hi.net, data.currency)} note={formatDate(hi.date)} />
          </dl>
          <div className="mt-3">
            <RevenueChart points={points} currency={data.currency} height={72} summary={summary} interactive={!preview} compactAxis />
          </div>
          {legend}
          <div className="table-scroll mt-3 max-h-56 overflow-y-auto rounded-lg border border-rule" tabIndex={preview ? undefined : 0} aria-label="Daily values">
            <table className="data-table">
              <caption className="sr-only">Daily net revenue, {periodLabel.toLowerCase()}</caption>
              <thead className="sticky top-0 bg-surface">
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" className="num">Net</th>
                  <th scope="col" className="num">Δ vs prior day</th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((p, i, arr) => {
                  const prev = arr[i + 1];
                  const d = prev ? p.net - prev.net : null;
                  return (
                    <tr key={p.date}>
                      <th scope="row" className="font-normal">{formatDate(p.date)}</th>
                      <td className="num">{formatMoney(p.net, data.currency)}</td>
                      <td className="num text-ink-2">{d === null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${formatMoney(Math.abs(d), data.currency)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="mt-3">
          <RevenueChart
            points={points}
            currency={data.currency}
            height={chartHeight}
            summary={summary}
            showAverage
            interactive={!preview}
            markers={variant === "annotated" ? annotations.map((a, i) => ({ date: a.date, n: i + 1 })) : []}
          />
          {legend}
        </div>
      )}

      {variant === "annotated" && (
        <div className="mt-3 border-t border-rule pt-3">
          <h4 className="text-[length:var(--cs-fs-sm)] font-semibold">What changed</h4>
          {annotations.length === 0 ? (
            <p className="mt-1 text-ink-2">No notable changes in this period. The line stayed within its usual range.</p>
          ) : (
            <ol className="mt-2 space-y-2">
              {annotations.map((a, i) => (
                <li key={`${a.date}-${i}`} className="flex gap-3">
                  <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-ink text-[11px] font-bold text-white" aria-hidden="true">
                    {i + 1}
                  </span>
                  <p>
                    <span className="font-semibold">{formatDate(a.date)}.</span> {a.text}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-[length:var(--cs-fs-sm)] text-ink-3">
            Net revenue is sales minus refunds and discounts, by settlement day. See Key metrics for related definitions.
          </p>
        </div>
      )}
    </HostCard>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-[length:var(--cs-fs-sm)] text-ink-3">{label}</dt>
      <dd className="font-semibold">
        {value}
        {note && <span className="ml-1 font-normal text-[length:var(--cs-fs-sm)] text-ink-3">{note}</span>}
      </dd>
    </div>
  );
}
