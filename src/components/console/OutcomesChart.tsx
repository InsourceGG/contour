"use client";

import { useState, type KeyboardEvent } from "react";
import { formatDate } from "@/components/format";
import { niceTicks, useElementWidth } from "@/components/charts/scale";

type Day = { day: string; previewed: number; kept: number; asked: number };

const SERIES = [
  { key: "previewed", label: "Proposed (ready)", color: "var(--color-series-1)" },
  { key: "kept", label: "Kept current view", color: "var(--color-series-2)" },
  { key: "asked", label: "Asked a question", color: "var(--color-series-3)" },
] as const;

const GAP = 2;

function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Stacked daily outcomes: ≤24px columns, 2px surface gaps, 4px rounded tops, per-column tooltip, table view. */
export function OutcomesChart({ days }: { days: Day[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(720);
  const [active, setActive] = useState<number | null>(null);

  if (days.length === 0) {
    return <p className="text-ink-2">No adaptation requests in this period yet.</p>;
  }

  const height = 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 36 };
  const innerW = Math.max(60, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const totals = days.map((d) => d.previewed + d.kept + d.asked);
  const ticks = niceTicks(0, Math.max(4, ...totals), 4); // whole-request counts, never fractional ticks
  const yMax = ticks[ticks.length - 1] || 1;
  const band = innerW / days.length;
  const colW = Math.max(3, Math.min(24, band * 0.62));
  const y = (v: number) => (v / yMax) * innerH;
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(innerW / 64))));
  const summary = `Daily request outcomes over ${days.length} days: ${totals.reduce((a, b) => a + b, 0)} requests in total.`;

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const cur = active ?? days.length - 1;
    let next = cur;
    if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "ArrowRight") next = Math.min(days.length - 1, cur + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = days.length - 1;
    else if (e.key === "Escape") return setActive(null);
    else return;
    e.preventDefault();
    setActive(next);
  }

  const a = active !== null ? days[active] : null;
  const tipX = active !== null ? Math.min(Math.max(pad.left + band * active + band / 2 - 80, 0), width - 170) : 0;

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <div
        ref={ref}
        className="chart-focus relative"
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={`${summary} Use the left and right arrow keys to read each day.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="block max-w-full" onPointerLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + innerW} y1={pad.top + innerH - y(t)} y2={pad.top + innerH - y(t)} stroke="var(--color-rule)" />
              <text x={pad.left - 8} y={pad.top + innerH - y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-ink-3)">
                {t}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const cx = pad.left + band * i + band / 2;
            const x = cx - colW / 2;
            const bottom = pad.top + innerH;
            const segs = SERIES.map((s) => ({ ...s, v: d[s.key] })).filter((s) => s.v > 0);
            const heights = segs.map((s) => y(s.v));
            const offsets = heights.map((_, k) => heights.slice(0, k).reduce((acc, h) => acc + h, 0));
            return (
              <g key={d.day} onPointerEnter={() => setActive(i)} opacity={active === null || active === i ? 1 : 0.55}>
                <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} fill="transparent" />
                {segs.map((s, k) => {
                  const top = bottom - offsets[k] - heights[k];
                  const isTop = k === segs.length - 1;
                  // A 2px surface gap separates each segment from the one above it.
                  return isTop ? (
                    <path key={s.key} d={topRounded(x, top, colW, heights[k], 4)} fill={s.color} />
                  ) : (
                    <rect key={s.key} x={x} y={top + GAP} width={colW} height={Math.max(0, heights[k] - GAP)} fill={s.color} />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">
                    {formatDate(d.day)}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={pad.left} x2={pad.left + innerW} y1={pad.top + innerH} y2={pad.top + innerH} stroke="var(--color-rule-strong)" />
        </svg>
        {a && (
          <div className="chart-tip" style={{ left: tipX, top: 0 }} aria-hidden="true">
            <div className="mb-1 font-semibold">{formatDate(a.day)}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
                <strong>{a[s.key]}</strong>
                <span className="opacity-80">{s.label}</span>
              </div>
            ))}
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {a ? `${formatDate(a.day)}: ${a.previewed} proposed, ${a.kept} kept current view, ${a.asked} asked a question.` : ""}
        </span>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-ink-2">Show as table</summary>
        <div className="table-scroll mt-2">
          <table className="data-table">
            <caption className="sr-only">Daily request outcomes</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {SERIES.map((s) => (
                  <th key={s.key} scope="col" className="num">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <th scope="row" className="font-normal">
                    {formatDate(d.day)}
                  </th>
                  <td className="num">{d.previewed}</td>
                  <td className="num">{d.kept}</td>
                  <td className="num">{d.asked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
