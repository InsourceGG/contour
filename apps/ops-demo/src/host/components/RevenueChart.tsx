"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatDate, formatMoney } from "@/components/format";
import { niceTicks, useElementWidth } from "@/components/charts/scale";

type Point = { date: string; net: number };

type Props = {
  points: Point[];
  currency: string;
  height: number;
  /** Accessible summary of what the chart shows. */
  summary: string;
  showAverage?: boolean;
  /** Numbered markers keyed by date (annotated variant). */
  markers?: { date: string; n: number }[];
  interactive: boolean;
  compactAxis?: boolean;
};

const SERIES = "var(--color-series-1)";

/**
 * Hand-rolled single-series line chart: 2px line, 10% area wash, hairline
 * grid, end dot with surface ring and an end label. Crosshair tooltip on
 * pointer and arrow keys; values are also available as text elsewhere.
 */
export function RevenueChart({ points, currency, height, summary, showAverage, markers = [], interactive, compactAxis }: Props) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(560);
  const [active, setActive] = useState<number | null>(null);
  const liveId = useId();

  if (points.length < 2) {
    return <p className="text-ink-2">Not enough data points to draw a trend yet.</p>;
  }

  const pad = { top: 14, right: compactAxis ? 12 : 64, bottom: 24, left: compactAxis ? 8 : 52 };
  const innerW = Math.max(40, width - pad.left - pad.right);
  const innerH = Math.max(30, height - pad.top - pad.bottom);
  const values = points.map((p) => p.net);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const ticks = niceTicks(lo - (hi - lo) * 0.1, hi + (hi - lo) * 0.05, compactAxis ? 2 : 4);
  // Sparklines use the data's own range; full charts use clean tick bounds.
  const range = hi - lo || Math.abs(hi) || 1;
  const y0 = compactAxis ? lo - range * 0.08 : ticks[0];
  const y1 = compactAxis ? hi + range * 0.08 : ticks[ticks.length - 1];
  const x = (i: number) => pad.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.net).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)}L${x(0).toFixed(1)},${(pad.top + innerH).toFixed(1)}Z`;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const last = points[points.length - 1];
  const indexByDate = new Map(points.map((p, i) => [p.date, i]));
  const xLabels = [0, Math.floor((points.length - 1) / 2), points.length - 1];

  function onPointer(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - pad.left) / innerW) * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const cur = active ?? points.length - 1;
    let next = cur;
    if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "ArrowRight") next = Math.min(points.length - 1, cur + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = points.length - 1;
    else if (e.key === "Escape") return setActive(null);
    else return;
    e.preventDefault();
    setActive(next);
  }

  const ap = active !== null ? points[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active) - 70, 0), width - 150) : 0;

  return (
    <div
      ref={wrapRef}
      className={`relative ${interactive ? "chart-focus" : ""}`}
      tabIndex={interactive ? 0 : undefined}
      role="group"
      aria-roledescription="chart"
      aria-label={interactive ? `${summary} Use the left and right arrow keys to read daily values.` : summary}
      onKeyDown={interactive ? onKey : undefined}
      onBlur={() => setActive(null)}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className="block max-w-full overflow-visible"
        onPointerMove={interactive ? onPointer : undefined}
        onPointerLeave={() => setActive(null)}
      >
        {!compactAxis &&
          ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-ink-3)" className="num">
                {formatMoney(t, currency, true)}
              </text>
            </g>
          ))}
        {compactAxis && (
          <line x1={pad.left} x2={pad.left + innerW} y1={pad.top + innerH} y2={pad.top + innerH} stroke="var(--color-rule)" />
        )}
        <path d={area} fill={SERIES} opacity={0.1} />
        {showAverage && (
          <g>
            <line x1={pad.left} x2={pad.left + innerW} y1={y(avg)} y2={y(avg)} stroke="var(--color-ink-3)" strokeWidth={1} />
            {!compactAxis && (
              <text x={pad.left + innerW + 6} y={y(avg)} dy="0.32em" fontSize={11} fill="var(--color-ink-3)">
                Avg
              </text>
            )}
          </g>
        )}
        <path d={line} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {markers.map((m) => {
          const i = indexByDate.get(m.date);
          if (i === undefined) return null;
          return (
            <g key={`${m.date}-${m.n}`}>
              <circle cx={x(i)} cy={y(points[i].net)} r={9} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={2} />
              <text x={x(i)} y={y(points[i].net)} dy="0.34em" textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">
                {m.n}
              </text>
            </g>
          );
        })}
        <circle cx={x(points.length - 1)} cy={y(last.net)} r={4} fill={SERIES} stroke="var(--color-surface)" strokeWidth={2} />
        {!compactAxis && (
          <text x={x(points.length - 1) + 8} y={y(last.net)} dy="0.32em" fontSize={12} fontWeight={600} fill="var(--color-ink)" className="num">
            {formatMoney(last.net, currency, true)}
          </text>
        )}
        {xLabels.map((i, k) => (
          <text
            key={`${i}-${k}`}
            x={x(i)}
            y={height - 6}
            fontSize={11}
            fill="var(--color-ink-3)"
            textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
          >
            {formatDate(points[i].date)}
          </text>
        ))}
        {ap && active !== null && (
          <g>
            <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + innerH} stroke="var(--color-ink-2)" strokeWidth={1} />
            <circle cx={x(active)} cy={y(ap.net)} r={5} fill={SERIES} stroke="var(--color-surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {ap && active !== null && (
        <div className="chart-tip" style={{ left: tipLeft, top: 0 }} aria-hidden="true">
          <strong>{formatMoney(ap.net, currency)}</strong>
          <div className="mt-0.5 flex items-center gap-1.5 opacity-80">
            <span className="inline-block h-0.5 w-3" style={{ background: "#6fd0b4" }} />
            Net revenue, {formatDate(ap.date)}
          </div>
        </div>
      )}
      <span id={liveId} className="sr-only" aria-live="polite">
        {ap ? `${formatDate(ap.date)}: ${formatMoney(ap.net, currency)}` : ""}
      </span>
    </div>
  );
}
