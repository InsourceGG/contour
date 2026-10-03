import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { resolveHostContext, tryHostUser } from "@/server/context";
import { getBroker } from "@/server/broker";
import { getSurfaceData } from "@/server/surface-data";
import type { PreviewData } from "@/sdk/broker";
import { ContourError } from "@/sdk/types";
import { AppShell } from "@/components/shell/AppShell";
import { FocusOnMount } from "@/components/FocusOnMount";
import { PreviewActions } from "@/components/preview/PreviewActions";
import { PreviewSurface } from "@/components/preview/PreviewSurface";
import { PreviewStateNotice } from "@/components/preview/PreviewStateNotice";
import { DENSITY_LABEL, HELP_LABEL, expertiseLabel, regionLabel, taskLabel } from "@/components/dashboard/labels";
import { componentLabels } from "@/host/components";
import { formatDateTime } from "@/components/format";
import { IconArrowLeft, IconInfo, IconPin } from "@/components/icons";

export const metadata: Metadata = { title: "Review proposed view" };

export default async function PreviewPage({ params }: PageProps<"/preview/[id]">) {
  const { id } = await params;
  const user = await tryHostUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/preview/${id}`)}`);

  const ctx = await resolveHostContext();
  let preview: PreviewData | null = null;
  try {
    preview = await getBroker().getPreview(ctx, id);
  } catch (e) {
    if (!(e instanceof ContourError && (e.code === "NOT_FOUND" || e.code === "INVALID_INPUT"))) throw e;
  }
  if (!preview) notFound();

  const { proposal, state, stateReason, current, proposed, changes, pins } = preview;
  const [currentData, proposedData] = await Promise.all([getSurfaceData(ctx, current.config), getSurfaceData(ctx, proposed)]);
  const ready = state === "ready";
  const prefs = proposal.preferences ?? {};

  return (
    <AppShell user={user}>
      <div className="space-y-6 pb-20">
        <Link href="/" className="link inline-flex items-center gap-1.5 text-sm">
          <IconArrowLeft size={16} />
          Back to dashboard
        </Link>

        <header>
          <FocusOnMount>
            <h1 className="text-2xl font-semibold md:text-3xl" tabIndex={-1}>
              {ready ? "Review your proposed view" : "This proposal can't be applied"}
            </h1>
          </FocusOnMount>
          <p className="mt-1 max-w-[70ch] text-ink-2">
            {ready
              ? "Compare it with your current view. Nothing changes until you accept. Closing this page keeps everything as it is."
              : "Your current view is unchanged. You can request a new proposal from the dashboard or your agent."}
          </p>
        </header>

        {!ready && <PreviewStateNotice state={state} reason={stateReason} appliedRevision={proposal.appliedRevision ?? null} />}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section aria-labelledby="pv-why" className="panel p-4 md:p-5">
            <h2 id="pv-why" className="section-title">
              Why this view
            </h2>
            <p className="mt-2 max-w-[70ch]">{proposal.rationale}</p>
            <h3 className="mt-4 text-sm font-semibold text-ink-2">Based on what was stated</h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ink-3">Task</dt>
              <dd className="font-semibold">{taskLabel(proposal.task)}</dd>
              <dt className="text-ink-3">Expertise</dt>
              <dd className="font-semibold">{expertiseLabel(proposal.expertise)}</dd>
              <dt className="text-ink-3">Density</dt>
              <dd>{prefs.density ? DENSITY_LABEL[prefs.density] : "No preference"}</dd>
              <dt className="text-ink-3">Help</dt>
              <dd>{prefs.help ? HELP_LABEL[prefs.help] : "No preference"}</dd>
              <dt className="text-ink-3">Made for</dt>
              <dd>Revision {proposal.baseRevision}</dd>
              <dt className="text-ink-3">Expires</dt>
              <dd>{formatDateTime(proposal.expiresAt)}</dd>
            </dl>
            <p className="meta mt-3">
              Expertise and task describe how you work. They never change what data or actions you have access to.
            </p>
          </section>

          <div className="space-y-4">
            <section aria-labelledby="pv-pins" className="panel p-4 md:p-5">
              <h2 id="pv-pins" className="section-title">
                Your pins
              </h2>
              {pins.length === 0 ? (
                <p className="mt-1 text-sm text-ink-2">No pinned panels, so nothing constrained this proposal.</p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-ink-2">The proposal had to keep these panels where you pinned them.</p>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {pins.map((p) => (
                      <li key={p.componentId} className="flex items-start gap-2">
                        <IconPin size={14} className="mt-1 flex-none text-accent" />
                        <span>
                          <strong>{componentLabels[p.componentId] ?? p.componentId}</strong>
                          {p.regionId ? ` in ${regionLabel(p.regionId).toLowerCase()}` : ""}
                          {p.variantId ? `, ${p.variantId} style` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            <div className="notice notice-info">
              <IconInfo size={18} />
              <p>
                Preparing this proposal used one credit. Accepting it or keeping your current view is free, and so are
                undo and reset.
              </p>
            </div>
          </div>
        </div>

        <PreviewSurface
          current={current}
          proposed={proposed}
          changes={changes}
          currentData={currentData}
          proposedData={proposedData}
          pinnedIds={pins.map((p) => p.componentId)}
        />

        {ready && <PreviewActions proposalId={proposal.id} configHash={proposal.configHash} />}
      </div>
    </AppShell>
  );
}
