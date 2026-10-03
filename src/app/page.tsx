import { redirect } from "next/navigation";
import { resolveHostContext, tryHostUser } from "@/server/context";
import { getBroker } from "@/server/broker";
import { getSurfaceData } from "@/server/surface-data";
import { AppShell } from "@/components/shell/AppShell";
import { DashboardClient, type ProposalSummary } from "@/components/dashboard/DashboardClient";
import { tenantName } from "@/components/format";

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const user = await tryHostUser();
  if (!user) redirect("/login");

  const ctx = await resolveHostContext();
  const broker = getBroker();
  const snapshot = await broker.getSnapshot(ctx);
  const [data, prefs, credits, proposals] = await Promise.all([
    getSurfaceData(ctx, snapshot.config),
    broker.getPreferences(ctx),
    broker.creditBalance(ctx),
    broker.listProposals(ctx, 5),
  ]);

  const sp = await searchParams;
  const appliedRaw = Array.isArray(sp.applied) ? sp.applied[0] : sp.applied;
  const applied = appliedRaw && /^\d{1,7}$/.test(appliedRaw) ? Number(appliedRaw) : null;

  const summaries: ProposalSummary[] = proposals.map((p) => ({
    id: p.id,
    status: p.status,
    task: p.task,
    expertise: p.expertise,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
    changeCount: p.changes.length,
  }));

  return (
    <AppShell user={user}>
      <DashboardClient
        tenant={tenantName(user.tenantId)}
        snapshot={snapshot}
        data={data}
        prefs={prefs}
        credits={credits}
        proposals={summaries}
        appliedRevision={applied}
      />
    </AppShell>
  );
}
