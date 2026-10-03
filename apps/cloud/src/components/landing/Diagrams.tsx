import { CheckGlyph, CursorGlyph, LockGlyph } from "./Glyphs";
import s from "./diagrams.module.css";

/** Small schematics for the three steps. Same vocabulary as the hero dashboard. */
export function Schematic({ kind }: { kind: "rules" | "propose" | "approve" }) {
  return (
    <div className={s.schem} data-kind={kind} aria-hidden="true">
      <span className={s.alert}><LockGlyph className={s.glyph} /></span>
      <span className={s.nav}><LockGlyph className={s.glyph} /></span>
      <div className={s.region}>
        <span className={s.a} />
        <span className={s.b} />
        <span className={s.c} />
        <span className={s.d} />
        {kind === "propose" ? <span className={s.tag}>Changed</span> : null}
      </div>
      {kind === "approve" ? (
        <span className={s.pill}>
          <span className={s.saved}><CheckGlyph className={s.check} />Saved by you</span>
          <CursorGlyph className={s.cursor} />
        </span>
      ) : null}
    </div>
  );
}

const APPS = ["Northwind Support", "Halden Billing", "Ostra CRM", "Pell Analytics"];

/** One agent, one connection, every linked app. */
export function ConnectionDiagram() {
  const ys = [50, 136, 222, 308];
  return (
    <div className={s.connection} aria-hidden="true">
      <svg className={s.wide} viewBox="0 0 1200 360" fill="none">
        <rect className={s.node} x="1" y="140" width="250" height="80" rx="16" />
        <text className={s.nodeTitle} x="28" y="175">Your agent</text>
        <text className={s.nodeSub} x="28" y="200">Claude Code, or any MCP client</text>
        <path className={`${s.draw} ${s.trunk}`} pathLength={1} d="M252 180 H500" />
        <text className={s.lineLabel} x="376" y="164" textAnchor="middle">One MCP connection</text>
        <rect className={s.nodeInk} x="500" y="140" width="220" height="80" rx="16" />
        <text className={s.nodeInkTitle} x="528" y="175">Contour Cloud</text>
        <text className={s.nodeInkSub} x="528" y="200">One account</text>
        {ys.map((y, i) => (
          <g key={y}>
            <path className={`${s.draw} ${s.branch}`} pathLength={1} d={`M720 180 C820 180 820 ${y} 920 ${y}`} />
            <rect className={s.node} x="920" y={y - 30} width="279" height="60" rx="14" />
            <text className={s.appTitle} x="944" y={y + 6}>{APPS[i]}</text>
          </g>
        ))}
      </svg>
      <svg className={s.tall} viewBox="0 0 360 540" fill="none">
        <rect className={s.node} x="1" y="1" width="358" height="76" rx="16" />
        <text className={s.nodeTitle} x="24" y="34">Your agent</text>
        <text className={s.nodeSub} x="24" y="58">Claude Code, or any MCP client</text>
        <path className={`${s.draw} ${s.trunk}`} pathLength={1} d="M180 78 V170" />
        <text className={s.lineLabel} x="196" y="130">One MCP connection</text>
        <rect className={s.nodeInk} x="1" y="170" width="358" height="76" rx="16" />
        <text className={s.nodeInkTitle} x="24" y="203">Contour Cloud</text>
        <text className={s.nodeInkSub} x="24" y="227">One account</text>
        {[318, 384, 450, 516].map((y, i) => (
          <g key={y}>
            <path className={`${s.draw} ${s.branch}`} pathLength={1} d={`M34 246 V${y - 24} C34 ${y} 34 ${y} 60 ${y}`} />
            <rect className={s.node} x="60" y={y - 24} width="299" height="48" rx="12" />
            <text className={s.appTitle} x="80" y={y + 5}>{APPS[i]}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
