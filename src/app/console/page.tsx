import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tryHostUser } from "@/server/context";
import { getConsoleData } from "@/server/console";
import { AppShell } from "@/components/shell/AppShell";
import { AgentControls } from "@/components/console/AgentControls";
import { OutcomesChart } from "@/components/console/OutcomesChart";
import { RegistrySection } from "@/components/console/RegistrySection";
import { StatGrid, StatTile } from "@/components/console/StatTile";
import { expertiseLabel, taskLabel } from "@/components/dashboard/labels";
import { formatDateTime, formatMoney, formatMs, formatNumber, formatRate, tenantName } from "@/components/format";
import { IconInfo } from "@/components/icons";

export const metadata: Metadata = { title: "Company console" };

const SECTIONS = [
  ["#controls", "Controls"],
  ["#adoption", "Adoption"],
  ["#cohorts", "Task and expertise"],
  ["#health", "System health"],
  ["#economics", "Economics"],
  ["#registry", "Registry"],
  ["#audit", "Audit"],
] as const;

export default async function ConsolePage() {
  const user = await tryHostUser();
  if (!user) redirect("/login?next=/console");

  if (user.role !== "operator") {
    return (
      <AppShell user={user}>
        <div className="max-w-xl space-y-3 py-10">
          <p className="badge">403</p>
          <h1 className="text-2xl font-semibold">The company console is for operators</h1>
          <p className="text-ink-2">
            Your account doesn&apos;t have the company operator role. Ask an administrator at {tenantName(user.tenantId)} if you need
            access.
          </p>
          <Link href="/" className="link">
            Back to the dashboard
          </Link>
        </div>
      </AppShell>
    );
  }

  const d = await getConsoleData();
  const money = (v: number | null) => (v === null ? "—" : formatMoney(v, d.cost.currency.toUpperCase()));

  return (
    <AppShell user={user}>
      <div className="space-y-12">
        <header>
          <h1 className="text-2xl font-semibold md:text-3xl">Company console</h1>
          <p className="mt-1 max-w-[70ch] text-ink-2">
            How people at {tenantName(user.tenantId)} adapt the {d.manifest.label.toLowerCase()} screen, and the controls that keep
            it within policy. Figures cover the last 30 days and only aggregate metadata; no individual layouts or notes.
          </p>
          <nav aria-label="Console sections" className="mt-4">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {SECTIONS.map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="link">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <section id="controls" aria-labelledby="c-controls" className="scroll-mt-6 space-y-4">
          <h2 id="c-controls" className="section-title">
            Controls
          </h2>
          <AgentControls enabled={d.agentAccessEnabled} activeGrants={d.grants.active} />
          <div className="grid gap-4 md:grid-cols-2">
            <StatGrid label="Agent connections">
              <StatTile label="Active connections" value={formatNumber(d.grants.active)} />
              <StatTile label="Revoked connections" value={formatNumber(d.grants.revoked)} />
            </StatGrid>
            <div className="rounded-xl border border-rule bg-surface p-4">
              <h3 className="text-sm text-ink-2">Agents in use</h3>
              {d.grants.clients.length === 0 ? (
                <p className="mt-1 text-sm">No agents connected.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm">
                  {d.grants.clients.map((c) => (
                    <li key={c.clientName} className="flex justify-between gap-3">
                      <span>{c.clientName}</span>
                      <span className="num text-ink-2">
                        {c.users} {c.users === 1 ? "person" : "people"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section id="adoption" aria-labelledby="c-adoption" className="scroll-mt-6 space-y-4">
          <h2 id="c-adoption" className="section-title">
            Adoption and user control
          </h2>
          <StatGrid label="Adoption and control">
            <StatTile label="Acceptance rate" value={formatRate(d.rates.acceptance)} note={`${d.totals.applied} of ${d.totals.proposals} proposals`} />
            <StatTile label="Undo rate" value={formatRate(d.rates.undo)} note={`${d.totals.undos} undos after applying`} />
            <StatTile label="Kept current view" value={formatNumber(d.totals.kept)} note="Selector judged no change needed" />
            <StatTile label="Asked a question" value={formatNumber(d.totals.asked)} />
            <StatTile label="Declined by user" value={formatNumber(d.totals.rejected)} />
            <StatTile label="Resets to default" value={formatNumber(d.totals.resets)} />
            <StatTile label="Expired unreviewed" value={formatNumber(d.totals.expired)} />
            <StatTile label="People adapting" value={formatNumber(d.totals.users)} note={`${d.totals.decisions} requests`} />
          </StatGrid>
          <p className="notice notice-info">
            <IconInfo size={18} />
            <span>
              High acceptance alone can hide confusion. Read it together with undo, reset and task outcomes before drawing
              conclusions, and note the sample size.
            </span>
          </p>
          <div className="panel p-4 md:p-5">
            <h3 className="font-semibold">Request outcomes by day</h3>
            <p className="meta mb-3">Every request ends as a ready proposal, a recommendation to keep the current view, or a question.</p>
            <OutcomesChart days={d.outcomesByDay} />
          </div>
        </section>

        <section id="cohorts" aria-labelledby="c-cohorts" className="scroll-mt-6 space-y-3">
          <h2 id="c-cohorts" className="section-title">
            Task and expertise
          </h2>
          <p className="max-w-[70ch] text-sm text-ink-2">
            Which approved presentations people choose for each stated task and expertise. Groups with fewer than {d.minCohort} people
            are suppressed to protect individuals.
          </p>
          {d.byTask.length === 0 ? (
            <p className="text-ink-2">No requests yet.</p>
          ) : (
            <div className="panel table-scroll">
              <table className="data-table">
                <caption className="sr-only">Outcomes by task and expertise</caption>
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Expertise</th>
                    <th scope="col" className="num">
                      People
                    </th>
                    <th scope="col" className="num">
                      Proposals
                    </th>
                    <th scope="col" className="num">
                      Applied
                    </th>
                    <th scope="col">Most chosen</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byTask.map((r) => (
                    <tr key={`${r.task}-${r.expertise}`}>
                      <th scope="row" className="font-semibold">
                        {taskLabel(r.task)}
                      </th>
                      <td>{expertiseLabel(r.expertise)}</td>
                      {r.suppressed ? (
                        <td colSpan={4} className="text-ink-3">
                          Suppressed — below minimum cohort ({d.minCohort} people)
                        </td>
                      ) : (
                        <>
                          <td className="num">{r.users}</td>
                          <td className="num">{r.proposals}</td>
                          <td className="num">{r.applied}</td>
                          <td>{r.topCandidate ?? "—"}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="meta">
            {d.unsupportedRequests} unsupported requests and {d.pinConflicts} pin conflicts in this period. Both point to demand for
            presentations that aren&apos;t registered yet.
          </p>
        </section>

        <section id="health" aria-labelledby="c-health" className="scroll-mt-6 space-y-4">
          <h2 id="c-health" className="section-title">
            System health
          </h2>
          <StatGrid label="System health">
            <StatTile label="End-to-end latency, median" value={formatMs(d.latency.p50)} />
            <StatTile label="End-to-end latency, 95th percentile" value={formatMs(d.latency.p95)} />
            <StatTile label="Model latency, median" value={formatMs(d.latency.providerP50)} note="Separate from broker and database time" />
            <StatTile label="Model timeouts" value={formatNumber(d.totals.timeouts)} note="Current view kept each time" />
            <StatTile label="Validation rejections" value={formatNumber(d.totals.validationFailures)} note="Blocked before anyone saw them" />
            <StatTile label="Fallback rate" value={formatRate(d.rates.fallback)} note="Requests where the model didn't answer cleanly" />
          </StatGrid>
        </section>

        <section id="economics" aria-labelledby="c-econ" className="scroll-mt-6 space-y-4">
          <h2 id="c-econ" className="section-title">
            Economics
          </h2>
          <StatGrid label="Economics">
            <StatTile label="Model cost" value={money(d.cost.totalProvider)} note="Includes requests that changed nothing" />
            <StatTile label="Cost per accepted change" value={money(d.cost.perAcceptedChange)} />
            <StatTile label="Input tokens" value={formatNumber(d.cost.inputTokens)} />
            <StatTile label="Output tokens" value={formatNumber(d.cost.outputTokens)} />
            <StatTile label="Credits purchased" value={formatNumber(d.revenue.creditsGranted)} note="Stripe test mode" />
            <StatTile label="Credits used" value={formatNumber(d.revenue.creditsConsumed)} />
            <StatTile label="Orders awaiting confirmation" value={formatNumber(d.revenue.ordersPending)} />
          </StatGrid>
        </section>

        <section id="registry" aria-labelledby="c-registry" className="scroll-mt-6 space-y-3">
          <h2 id="c-registry" className="section-title">
            Registry
          </h2>
          <p className="max-w-[70ch] text-sm text-ink-2">
            The single registry that drives rendering, validation and what agents are told. Agents can read a description of it but
            never change it.
          </p>
          <RegistrySection manifest={d.manifest} manifestHash={d.manifestHash} />
        </section>

        <section id="audit" aria-labelledby="c-audit" className="scroll-mt-6 space-y-3">
          <h2 id="c-audit" className="section-title">
            Recent audit events
          </h2>
          {d.recentAudit.length === 0 ? (
            <p className="text-ink-2">No audit events yet.</p>
          ) : (
            <div className="panel table-scroll">
              <table className="data-table">
                <caption className="sr-only">Recent audit events, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Event</th>
                    <th scope="col">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentAudit.map((a, i) => (
                    <tr key={`${a.createdAt}-${i}`}>
                      <td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</td>
                      <td>{a.kind.replace(/_/g, " ")}</td>
                      <td className="text-ink-2">{a.ref ? <span title={a.ref}>{a.ref.length > 24 ? `${a.ref.slice(0, 24)}…` : a.ref}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
