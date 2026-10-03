import type { CsatPoint } from "@/data/types";
import { PanelState, shortDate, type DataStateProps } from "./shared";

export interface CsatTrendProps extends DataStateProps {
  data: CsatPoint[];
  range?: "7d" | "30d";
  presentation?: "chart" | "summary";
  periodHrefs?: Record<"7d" | "30d", string>;
}

/** Customer satisfaction over time, with a full textual equivalent to the SVG. */
export function CsatTrend({ data, range = "7d", presentation = "chart", periodHrefs = { "7d": "/desk?range=7d", "30d": "/desk?range=30d" }, loading, error, className = "" }: CsatTrendProps) {
  const responses = data.reduce((total, point) => total + point.responses, 0);
  const average = responses ? data.reduce((total, point) => total + point.score * point.responses, 0) / responses : 0;
  const midpoint = Math.max(1, Math.floor(data.length / 2));
  const first = data.slice(0, midpoint);
  const last = data.slice(midpoint);
  const mean = (points: CsatPoint[]) => points.reduce((total, point) => total + point.score, 0) / Math.max(1, points.length);
  const delta = last.length ? mean(last) - mean(first) : 0;
  const width = 340;
  const height = 136;
  const lower = Math.min(70, Math.floor(Math.min(...data.map((point) => point.score), 90) / 10) * 10);
  const y = (score: number) => height - ((score - lower) / (100 - lower)) * height;
  const x = (index: number) => data.length === 1 ? width / 2 : index / (data.length - 1) * width;
  const line = data.map((point, index) => `${x(index)},${y(point.score)}`).join(" ");
  const area = data.length ? `0,${height} ${line} ${width},${height}` : "";
  const tableId = `csat-data-${range}`;

  return <section className={`desk-panel csat-trend ${className}`} aria-labelledby="csat-heading" aria-busy={loading}>
    <header className="desk-panel-header"><h2 id="csat-heading">Customer satisfaction</h2><div className="desk-segment" aria-label="Satisfaction period"><a href={periodHrefs["7d"]} aria-current={range === "7d" ? "true" : undefined}>7d</a><a href={periodHrefs["30d"]} aria-current={range === "30d" ? "true" : undefined}>30d</a></div></header>
    <PanelState loading={loading} error={error} empty={!data.length} emptyTitle="No feedback yet" emptyDescription="Satisfaction scores will appear after customers rate a resolved ticket.">
      <div className="csat-score-row"><div className="csat-score desk-number">{average.toFixed(1)}<span>%</span></div><div className={`csat-change ${delta >= 0 ? "positive" : "negative"}`}><span className="desk-number">{delta >= 0 ? "+" : ""}{delta.toFixed(1)} pts</span><span>across this period</span></div></div>
      <p className="csat-response-count"><span className="desk-number">{responses}</span> customer responses in the last {range === "7d" ? "7" : "30"} days</p>
      {presentation === "chart" ? <div className="csat-chart-wrap"><div className="csat-axis" aria-hidden="true"><span>100%</span><span>{lower}%</span></div><svg className="csat-chart" viewBox={`-2 -6 ${width + 4} ${height + 12}`} role="img" aria-label={`Satisfaction averaged ${average.toFixed(1)} percent. ${delta >= 0 ? "Increased" : "Decreased"} ${Math.abs(delta).toFixed(1)} points across the period. Exact scores follow below.`} aria-describedby={tableId}>
        <line x1="0" y1="0" x2={width} y2="0" className="chart-grid" />
        <line x1="0" y1={height} x2={width} y2={height} className="chart-grid" />
        <line x1="0" y1={y(90)} x2={width} y2={y(90)} className="chart-target" />
        <polygon points={area} className="chart-area" />
        <polyline points={line} className="chart-line" fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.length > 0 && <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].score)} r="3.5" className="chart-endpoint" />}
      </svg><div className="csat-chart-labels"><span>{data[0] ? shortDate(data[0].date) : ""}</span><span>90% target</span><span>{data.at(-1) ? shortDate(data.at(-1)!.date) : ""}</span></div></div> : <dl className="csat-summary"><div><dt>Highest daily score</dt><dd className="desk-number">{Math.max(...data.map((point) => point.score)).toFixed(1)}%</dd></div><div><dt>Days at target</dt><dd className="desk-number">{data.filter((point) => point.score >= 90).length} / {data.length}</dd></div><div><dt>Team target</dt><dd className="desk-number">90%</dd></div></dl>}
      <details className="csat-data"><summary>View daily scores</summary><table id={tableId}><caption className="sr-only">Daily satisfaction scores and response counts</caption><thead><tr><th scope="col">Date</th><th scope="col">Score</th><th scope="col">Responses</th></tr></thead><tbody>{data.map((point) => <tr key={point.date}><th scope="row">{shortDate(point.date)}</th><td className="desk-number">{point.score.toFixed(1)}%</td><td className="desk-number">{point.responses}</td></tr>)}</tbody></table></details>
    </PanelState>
  </section>;
}
