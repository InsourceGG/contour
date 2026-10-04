import type { ReactNode } from "react";
import { Console } from "./Console";
import { CheckGlyph, CursorGlyph, LockGlyph } from "./Glyphs";
import { PROMPTS, type Step } from "./steps";
import s from "./stage.module.css";

// The illustrated dashboard. Pure markup: every state is expressed as data attributes
// on the root, and stage.module.css turns them into layout, variants and motion.

function Lock() {
  return (
    <span className={s.lock}>
      <LockGlyph className={s.lockGlyph} />
      <span className={s.lockWord}>Locked</span>
    </span>
  );
}

function Layer({ v, children, className = "" }: { v: string; children: ReactNode; className?: string }) {
  return <div className={`${s.v} ${className}`} data-v={v}>{children}</div>;
}

function Block({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={`${s.block} ${s[name]}`}>
      {children}
      <span className={s.skeleton} />
      <span className={s.changed}>Changed</span>
    </div>
  );
}

const QUEUE = [
  { p: 1, subject: "Refund not received", who: "Ilse Brandt", age: "38m", note: "Billing. Check the payment status first." },
  { p: 1, subject: "Can't sign in with SSO", who: "Tomas Reyes", age: "31m", note: "Known issue. Link the incident." },
  { p: 2, subject: "Invoice shows the wrong VAT", who: "Okafor & Lund", age: "24m", note: "Ask for the invoice number." },
  { p: 2, subject: "Export stuck at 90%", who: "Priya Natarajan", age: "19m", note: "Retry once, then escalate to tier 2." },
  { p: 3, subject: "Missing seats after upgrade", who: "Halden Studio", age: "12m", note: "" },
  { p: 3, subject: "Card declined twice", who: "Mateo Ruiz", age: "9m", note: "" },
  { p: 3, subject: "Webhook retries failing", who: "Fennick Labs", age: "6m", note: "" },
  { p: 3, subject: "Change billing email", who: "Anouk de Wit", age: "4m", note: "" },
  { p: 3, subject: "Duplicate charge on May plan", who: "Sora Tanaka", age: "2m", note: "" },
];

const ACTIVITY = [
  ["Mara", "closed #4812"], ["Jonas", "escalated #4809"], ["Ines", "replied to #4807"], ["Mara", "merged #4801"],
  ["Ravi", "tagged #4799"], ["Ines", "closed #4797"], ["Jonas", "reopened #4790"], ["Ravi", "closed #4788"],
  ["Mara", "assigned #4786"], ["Ines", "closed #4781"],
];

export function StageView({ step, typed, className = "", stepIndex }: { step: Step; typed?: string; className?: string; stepIndex?: number }) {
  const flag = (b?: boolean) => (b ? "true" : "false");
  const promptText = step.prompt ? (typed ?? PROMPTS[step.prompt]) : "";
  const proposal = step.layout === "dense" ? "compact" : "guided";
  return (
    <div
      className={`${s.stage} ${className}`}
      data-step={stepIndex}
      data-layout={step.layout}
      data-locks={flag(step.locks)}
      data-outline={flag(step.outline)}
      data-deck={flag(step.deck)}
      data-prompt={step.prompt ?? "none"}
      data-typing={flag(step.typing)}
      data-thinking={flag(step.thinking)}
      data-proposed={flag(step.proposed)}
      data-bar={step.bar ?? "none"}
      data-console={flag(step.console)}
    >
      <div className={s.window}>
        <div className={s.appbar}>
          <span className={s.logo}>N</span>
          <span className={s.appName}>Northwind Support</span>
          <span className={s.tabs}><span data-active="true">Inbox</span><span>Reports</span><span>Customers</span></span>
          <span className={s.search}>Search tickets</span>
          <span className={`${s.required} ${s.locked}`}>Acknowledge incident<Lock /></span>
        </div>

        <div className={s.app}>
          <div className={`${s.nav} ${s.locked}`}>
            {Array.from({ length: 6 }, (_, i) => <span key={i} data-active={i === 0 ? "true" : undefined} />)}
            <Lock />
          </div>
          <div className={`${s.alerts} ${s.locked}`}>
            <span className={s.alertMark} />
            <span className={s.alertText}>Payment provider degraded. 14 tickets affected.</span>
            <span className={s.alertLink}>View incident</span>
            <Lock />
          </div>
          <div className={s.region}><span className={s.regionLabel}>Can adapt</span></div>

          <Block name="metrics">
            <Layer v="base" className={s.metricRow}>
              {[["Open", "128"], ["First reply", "4m"], ["Resolved today", "37"], ["SLA met", "92%"]].map(([k, v]) => (
                <div key={k} className={s.metric}><span>{k}</span><strong>{v}</strong></div>
              ))}
            </Layer>
            <Layer v="guided" className={s.metricRow}>
              {[["Your open tickets", "6"], ["Oldest waiting", "38m"]].map(([k, v]) => (
                <div key={k} className={s.metric}><span>{k}</span><strong>{v}</strong></div>
              ))}
            </Layer>
            <Layer v="dense" className={`${s.metricRow} ${s.metricDense}`}>
              {[["Open", "128"], ["First reply", "4m"], ["Resolution", "3.1h"], ["CSAT", "4.6"], ["SLA met", "92%"], ["Backlog", "-8%"]].map(([k, v]) => (
                <div key={k} className={s.metric}><span>{k}</span><strong>{v}</strong></div>
              ))}
            </Layer>
          </Block>

          <Block name="chart">
            <Layer v="base">
              <p className={s.blockTitle}>Ticket volume, this week</p>
              <svg className={s.plot} viewBox="0 0 100 40" preserveAspectRatio="none">
                <path className={s.area} d="M0 30 L16 24 L33 27 L50 15 L66 19 L83 9 L100 13 L100 40 L0 40 Z" />
                <path className={s.line} d="M0 30 L16 24 L33 27 L50 15 L66 19 L83 9 L100 13" />
              </svg>
              <div className={s.axis}>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}</div>
            </Layer>
            <Layer v="guided">
              <p className={s.blockTitle}>Volume</p>
              <strong className={s.bigNum}>+12%</strong>
              <svg className={s.spark} viewBox="0 0 100 30" preserveAspectRatio="none">
                <path className={s.line} d="M0 24 L20 18 L40 21 L60 11 L80 14 L100 6" />
              </svg>
            </Layer>
            <Layer v="dense">
              <p className={s.blockTitle}>Opened vs. resolved, 14 days</p>
              <svg className={`${s.plot} ${s.plotDense}`} viewBox="0 0 100 40" preserveAspectRatio="none">
                {[8, 16, 24, 32].map((y) => <path key={y} className={s.grid} d={`M0 ${y} H100`} />)}
                <path className={s.line} d="M0 28 L8 25 L15 27 L23 20 L31 22 L38 15 L46 18 L54 12 L62 16 L69 10 L77 13 L85 7 L92 11 L100 6" />
                <path className={s.lineAlt} d="M0 32 L8 30 L15 29 L23 27 L31 25 L38 24 L46 21 L54 20 L62 18 L69 17 L77 15 L85 14 L92 12 L100 11" />
              </svg>
              <div className={s.axis}>{["1", "4", "7", "10", "14"].map((d) => <span key={d}>{d}</span>)}</div>
            </Layer>
          </Block>

          <Block name="queue">
            <Layer v="base">
              <p className={s.blockTitle}>Queue <span className={s.count}>128</span></p>
              <ul className={s.rows}>
                {QUEUE.slice(0, 4).map((r) => (
                  <li key={r.subject}><span className={s.prio} data-p={r.p} /><span className={s.subject}>{r.subject}</span><span className={s.who}>{r.who}</span><span className={s.age}>{r.age}</span></li>
                ))}
              </ul>
            </Layer>
            <Layer v="guided">
              <p className={s.blockTitle}>Your queue <span className={s.count}>6</span></p>
              <p className={s.annotation}>Start with the oldest ticket. Urgent ones are marked.</p>
              <ul className={`${s.rows} ${s.rowsAnnotated}`}>
                {QUEUE.slice(0, 5).map((r) => (
                  <li key={r.subject}>
                    <span className={s.prio} data-p={r.p} />
                    <span className={s.subject}>{r.subject}{r.note ? <em>{r.note}</em> : null}</span>
                    <span className={s.age}>{r.age}</span>
                  </li>
                ))}
              </ul>
            </Layer>
            <Layer v="dense">
              <ul className={`${s.rows} ${s.rowsDense}`}>
                <li className={s.thead}><span>P</span><span>Subject</span><span>Customer</span><span>Age</span></li>
                {QUEUE.map((r) => (
                  <li key={r.subject}><span className={s.prio} data-p={r.p} /><span className={s.subject}>{r.subject}</span><span className={s.who}>{r.who}</span><span className={s.age}>{r.age}</span></li>
                ))}
              </ul>
            </Layer>
          </Block>

          <Block name="activity">
            <Layer v="base">
              <p className={s.blockTitle}>Activity</p>
              <ul className={s.feed}>
                {ACTIVITY.slice(0, 4).map(([who, what], i) => <li key={i}><span className={s.avatar}>{who[0]}</span><span><b>{who}</b> {what}</span></li>)}
              </ul>
            </Layer>
            <Layer v="guided">
              <p className={s.blockTitle}>Activity</p>
              <p className={s.summaryLine}>3 updates on your tickets</p>
            </Layer>
            <Layer v="dense">
              <p className={s.blockTitle}>Activity</p>
              <ul className={`${s.feed} ${s.feedDense}`}>
                {ACTIVITY.map(([who, what], i) => <li key={i}><span className={s.avatar}>{who[0]}</span><span><b>{who}</b> {what}</span></li>)}
              </ul>
            </Layer>
          </Block>

          <Block name="help">
            <Layer v="base" className={s.helpCollapsed}>
              <p className={s.blockTitle}>Help and shortcuts</p>
              <span className={s.key}>?</span>
            </Layer>
            <Layer v="dense" className={s.helpCollapsed}>
              <p className={s.blockTitle}>Shortcuts</p>
            </Layer>
            <Layer v="guided">
              <p className={s.blockTitle}>Getting started</p>
              <ol className={s.steps}>
                <li><span>1</span>Open the oldest ticket in your queue.</li>
                <li><span>2</span>Check the customer&apos;s plan and recent payments.</li>
                <li><span>3</span>Reply, or escalate to tier 2.</li>
              </ol>
              <span className={s.helpLink}>Read the triage guide</span>
            </Layer>
          </Block>

        </div>

        <div className={s.consoleLayer}>
          <Console kill={step.kill} className={s.console} />
        </div>
      </div>

      <div className={s.bar}>
        <div className={s.barAsk}>
          <span className={s.barMsg}>Your agent proposed a {proposal} view.</span>
          <span className={s.btnGhost}>Keep current</span>
          <span className={s.btnInk}>
            Accept
            <CursorGlyph className={s.cursor} />
          </span>
        </div>
        <div className={s.barSaved}>
          <CheckGlyph className={s.check} />
          <span>Saved by you. <u>Undo anytime.</u></span>
        </div>
      </div>
      <div className={s.deck}>
        <p className={s.deckTitle}>Approved variants</p>
        <dl>
          {[
            ["Queue", ["Summary", "Annotated", "Dense"]],
            ["Chart", ["Summary", "Detailed"]],
            ["Help", ["Collapsed", "Expanded"]],
            ["Layout", ["Default", "Guided", "Compact"]],
          ].map(([k, vs]) => (
            <div key={k as string}><dt>{k}</dt><dd>{(vs as string[]).map((v) => <span key={v}>{v}</span>)}</dd></div>
          ))}
        </dl>
      </div>

      <div className={s.prompt}>
        <p className={s.promptHead}><span className={s.agentMark} />Claude Code<span className={s.via}>connected through Contour</span></p>
        <p className={s.promptText}>
          <span className={s.chevron}>&gt;</span>
          <span>{promptText}<span className={s.caret} /></span>
        </p>
        <p className={s.promptStatus}>{step.status ?? " "}</p>
      </div>
    </div>
  );
}
