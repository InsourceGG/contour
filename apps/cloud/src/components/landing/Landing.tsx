import Link from "next/link";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { Console } from "./Console";
import { ConnectionDiagram, Schematic } from "./Diagrams";
import { HeroStage } from "./HeroStage";
import { StageView } from "./StageView";
import { SEQUENCE_DESCRIPTION, STEPS } from "./steps";
import s from "./landing.module.css";

const sans = Instrument_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--lp-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--lp-mono", display: "swap" });

// Static frames shown instead of the animation when reduced motion is requested.
const FRAMES = [1, 4, 9, 13];

const STEPS_HOW = [
  {
    kind: "rules" as const,
    title: "The company sets the rules.",
    body: "Install the SDK and register what can adapt: your components, their approved variants, layout templates and density. Then lock what must never change.",
  },
  {
    kind: "propose" as const,
    title: "Your agent proposes.",
    body: "Connect your own agent, like Claude Code, and say how you work. It builds a view from approved pieces only. It can't write code, add CSS or reach data you can't already see.",
  },
  {
    kind: "approve" as const,
    title: "You approve.",
    body: "The dashboard updates in place, with every change marked. Accept it or keep the current view. Nothing is saved until you click.",
  },
];

const COMPANY_POINTS = [
  { title: "Clear limits", body: "You register what can adapt. Alerts, required actions, navigation, security and billing stay locked." },
  { title: "Your design system, intact", body: "Views are built only from your components and approved variants, in your branding. No generated code or CSS." },
  { title: "Full visibility", body: "A console shows usage, acceptance and undo rates, cost, and a log of every decision." },
  { title: "An off switch", body: "Turn off agent access for everyone at once. Any view can be reset to your default." },
];

const PEOPLE_POINTS = [
  { title: "Connect once", body: "Add Contour to your agent a single time. Every app you link is available to it right away." },
  { title: "Views that fit your work", body: "Ask for guidance while you learn a tool, and for density once you know it. Change your mind anytime." },
  { title: "Your data stays yours", body: "Your agent sees only what you can already see. Your company password stays with your company." },
];

const LIMITS = [
  { title: "Presentation only.", body: "Agents change layout, variants and density. Never your data, never your code." },
  { title: "Agents never save.", body: "A view is saved only when a person clicks Accept. An agent has no way to do it." },
  { title: "Locked controls never move.", body: "Alerts, required actions, navigation, security and billing stay exactly where the company put them." },
  { title: "Everything can be undone.", body: "Undo any change, or reset to the company's default view in one step." },
];

export function Landing() {
  return (
    <div className={`${s.root} ${sans.variable} ${mono.variable}`} data-contour-landing="">
      <style href="contour-landing-chrome" precedence="medium">
        {`html:has([data-contour-landing]) body { font-family: ${sans.style.fontFamily}; }`}
      </style>

      <section className={s.hero} aria-labelledby="hero-title">
        <h1 id="hero-title" className={s.h1}>Contour lets agents tailor your interface to each user, within your rules.</h1>
        <div className={s.heroCopy}>
          <p className={s.lede}>Each person&apos;s agent rearranges your approved components to fit how they work. Nothing changes until they click Accept.</p>
          <div className={s.ctas}>
            <Link href="/projects" className={s.btnPrimary}>Connect your agent</Link>
            <Link href="/owner" className={s.btnSecondary}>Register your app</Link>
          </div>
        </div>
        <HeroStage stageClassName={s.stageCol} chaptersClassName={s.chaptersCol} pauseClassName={s.pauseCol} />
        <div className={s.frames} aria-hidden="true">
          {FRAMES.map((i) => (
            <figure key={i} className={s.frame}>
              <StageView step={STEPS[i]} />
              <figcaption>{STEPS[i].caption}</figcaption>
            </figure>
          ))}
        </div>
        <div className={s.srOnly}>
          <p>The animation shows Contour working on a support dashboard, in six moments:</p>
          <ol>{SEQUENCE_DESCRIPTION.map((d) => <li key={d}>{d}</li>)}</ol>
        </div>
      </section>

      <section className={`${s.section} ${s.how}`} aria-labelledby="how-title">
        <div className={s.howHead}>
          <h2 id="how-title" className={s.h2}>How it works</h2>
          <p className={s.sectionLede}>Three parties, each with one job. The company decides what may change, the agent suggests, and the person chooses.</p>
        </div>
        <ol className={s.howList}>
          {STEPS_HOW.map((step, i) => (
            <li key={step.kind} className={s.howItem}>
              <Schematic kind={step.kind} />
              <div>
                <span className={s.stepNum} aria-hidden="true">{i + 1}</span>
                <h3 className={s.h3}>{step.title}</h3>
                <p className={s.body}>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${s.section} ${s.companies}`} aria-labelledby="companies-title">
        <div className={s.companiesText}>
          <h2 id="companies-title" className={s.h2}>Companies keep control.</h2>
          <p className={s.sectionLede}>Contour works inside your product, with your components and your permissions. You see every decision, and you can switch it off.</p>
          <dl className={s.points}>
            {COMPANY_POINTS.map((p) => (
              <div key={p.title}><dt>{p.title}</dt><dd>{p.body}</dd></div>
            ))}
          </dl>
          <Link href="/owner" className={s.textLink}>Register your app</Link>
        </div>
        <div className={s.consoleFrame} aria-hidden="true">
          <Console standalone className={s.consoleStandalone} />
        </div>
      </section>

      <section className={`${s.section} ${s.people}`} aria-labelledby="people-title">
        <div className={s.peopleHead}>
          <h2 id="people-title" className={s.h2}>One connection to every app you use.</h2>
          <p className={s.sectionLede}>Contour Cloud gives you one account and one MCP connection. Link each company&apos;s app by signing in there, and your agent can work across all of them.</p>
        </div>
        <ConnectionDiagram />
        <ul className={s.peoplePoints}>
          {PEOPLE_POINTS.map((p) => (
            <li key={p.title}><h3 className={s.h4}>{p.title}</h3><p>{p.body}</p></li>
          ))}
        </ul>
      </section>

      <section className={`${s.section} ${s.limits}`} aria-labelledby="limits-title">
        <h2 id="limits-title" className={s.h2}>The limits are built in.</h2>
        <ul className={s.limitList}>
          {LIMITS.map((l) => (
            <li key={l.title}><h3 className={s.limitTitle}>{l.title}</h3><p>{l.body}</p></li>
          ))}
        </ul>
      </section>

      <section className={s.closing} aria-labelledby="closing-title">
        <h2 id="closing-title" className={s.closingTitle}>Give every person a view that fits their work.</h2>
        <div className={s.closingActions}>
          <Link href="/projects" className={s.btnPaper}>Connect your agent</Link>
          <Link href="/owner" className={s.btnOutlinePaper}>Register your app</Link>
          <p className={s.signin}>Already have an account? <Link href="/login">Sign in</Link></p>
        </div>
      </section>
    </div>
  );
}
