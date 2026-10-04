import s from "./console.module.css";

// Illustrative company console. Sample figures, decorative only.
const USAGE = [22, 30, 26, 41, 38, 47, 44, 52, 49, 61, 58, 66, 63, 72];

const LOG = [
  { what: "Compact view", who: "Support, expert", result: "Accepted", when: "Now" },
  { what: "Guided view", who: "Support, new", result: "Accepted", when: "2 min" },
  { what: "Dense queue", who: "Billing", result: "Undone", when: "1 h" },
  { what: "Annotated queue", who: "Support, new", result: "Kept current", when: "3 h" },
];

export function Console({ kill = false, standalone = false, className = "" }: { kill?: boolean; standalone?: boolean; className?: string }) {
  return (
    <div className={`${s.console} ${standalone ? s.standalone : ""} ${className}`} data-kill={kill ? "true" : "false"}>
      <div className={s.head}>
        <span className={s.mark} />
        <span className={s.title}>Contour console</span>
        <span className={s.app}>Northwind Support</span>
      </div>
      <dl className={s.kpis}>
        <div><dt>Proposals</dt><dd>1,284</dd></div>
        <div><dt>Accepted</dt><dd>71%</dd></div>
        <div><dt>Undone</dt><dd>6%</dd></div>
        <div><dt>Cost this month</dt><dd>$18.40</dd></div>
      </dl>
      <div className={s.body}>
        <div className={s.usage}>
          <p className={s.label}>Usage, last 14 days</p>
          <div className={s.bars}>
            {USAGE.map((v, i) => <span key={i} style={{ blockSize: `${v}%` }} />)}
          </div>
        </div>
        <div className={s.log}>
          <p className={s.label}>Decision log</p>
          <ul>
            {LOG.map((r) => (
              <li key={r.what + r.when}>
                <span className={s.what}>{r.what}</span>
                <span className={s.who}>{r.who}</span>
                <span className={s.result} data-result={r.result}>{r.result}</span>
                <span className={s.when}>{r.when}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={s.kill}>
          <p className={s.label}>Agent access</p>
          <div className={s.switchRow}>
            <span className={s.switch}><span /></span>
            <span className={s.state}>
              <span className={s.on}>On for all users</span>
              <span className={s.off}>Off. Agents can&apos;t read or propose.</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
