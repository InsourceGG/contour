import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveHostContext, tryHostUser } from "@/server/context";
import { getBroker } from "@/server/broker";
import { env } from "@/server/env";
import { contour } from "@/server/contour";
import { AppShell } from "@/components/shell/AppShell";
import { PreferencesForm } from "@/components/settings/PreferencesForm";
import { AgentsSection, type AgentGrant } from "@/components/settings/AgentsSection";
import { DecisionList, type DecisionRow } from "@/components/settings/DecisionList";
import { formatDateTime } from "@/components/format";

export const metadata: Metadata = { title: "Settings" };

const HISTORY_SOURCE: Record<string, string> = {
  default: "Company default",
  proposal: "Accepted proposal",
  undo: "Undo",
  reset: "Reset to default",
};

export default async function SettingsPage() {
  const user = await tryHostUser();
  if (!user) redirect("/login?next=/settings");
  const ctx = await resolveHostContext();
  const broker = getBroker();
  const [prefs, history, decisions, grants] = await Promise.all([
    broker.getPreferences(ctx),
    broker.getHistory(ctx),
    broker.listDecisions(ctx, 20),
    contour.oauth.listGrantsForUser(ctx.subjectId, ctx.tenantId).catch(() => null),
  ]);

  const decisionRows: DecisionRow[] = decisions.map((d) => ({
    id: d.id,
    createdAt: (d as { createdAt?: string }).createdAt ?? null,
    channel: d.channel,
    clientId: d.clientId,
    outcome: d.outcome,
    outcomeReason: d.outcomeReason,
    selectedId: d.selectedId,
    candidateIds: d.candidateIds,
    confidence: d.confidence,
    confidenceFloor: d.confidenceFloor,
    validation: d.validation,
    providerStatus: d.providerStatus,
    modelVersion: d.modelVersion,
    totalLatencyMs: d.totalLatencyMs,
    providerLatencyMs: d.providerLatencyMs,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    providerCost: d.providerCost,
    currency: d.currency,
    task: typeof d.inputs?.task === "string" ? d.inputs.task : null,
    expertise: typeof d.inputs?.expertise === "string" ? d.inputs.expertise : null,
    rationale: d.rationale,
    proposalId: d.proposalId,
  }));

  const agentGrants: AgentGrant[] | null = grants
    ? grants.map((g) => ({ id: g.id, clientName: g.clientName, clientId: g.clientId, scopes: [...g.scopes], createdAt: g.createdAt, revokedAt: g.revokedAt }))
    : null;

  return (
    <AppShell user={user}>
      <div className="space-y-10">
        <header>
          <h1 className="text-2xl font-semibold md:text-3xl">Settings</h1>
          <p className="mt-1 max-w-[68ch] text-ink-2">
            Your preferences, the history of your view, how each proposal was decided, and the agents you&apos;ve connected.
          </p>
          <nav aria-label="On this page" className="mt-4">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {[
                ["#preferences", "Preferences"],
                ["#history", "View history"],
                ["#decisions", "Decisions"],
                ["#agents", "Connected agents"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a className="link" href={href}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <section id="preferences" aria-labelledby="prefs-h" className="scroll-mt-6">
          <h2 id="prefs-h" className="section-title">
            Preferences
          </h2>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            Defaults used when you ask for a new view. They never change what you can access.
          </p>
          <PreferencesForm prefs={prefs} />
        </section>

        <section id="history" aria-labelledby="hist-h" className="scroll-mt-6">
          <h2 id="hist-h" className="section-title">
            View history
          </h2>
          {history.length === 0 ? (
            <p className="mt-2 text-ink-2">You&apos;re using the company default. Accepted views will be listed here.</p>
          ) : (
            <div className="panel table-scroll mt-3">
              <table className="data-table">
                <caption className="sr-only">Saved revisions of your view, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      Revision
                    </th>
                    <th scope="col">Change</th>
                    <th scope="col">Saved</th>
                    <th scope="col">Can be restored</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.revision}>
                      <td className="num font-semibold">{h.revision}</td>
                      <td>{HISTORY_SOURCE[h.source] ?? h.source}</td>
                      <td>{formatDateTime(h.createdAt)}</td>
                      <td>
                        {h.compatible ? (
                          "Yes"
                        ) : (
                          <span className="badge badge-warning">No longer compatible with this screen</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="meta mt-2">Undo restores the previous compatible revision. Older layouts that no longer fit the screen or your access can&apos;t be restored.</p>
        </section>

        <section id="decisions" aria-labelledby="dec-h" className="scroll-mt-6">
          <h2 id="dec-h" className="section-title">
            How proposals were decided
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm text-ink-2">
            Each request is recorded: what was asked, which approved options were considered, what was chosen, and whether it passed
            company rules. This is the full record; there is no hidden reasoning.
          </p>
          <DecisionList rows={decisionRows} />
        </section>

        <section id="agents" aria-labelledby="agents-h" className="scroll-mt-6">
          <AgentsSection headingId="agents-h" grants={agentGrants} mcpUrl={`${env.appUrl}/api/mcp`} />
        </section>
      </div>
    </AppShell>
  );
}
