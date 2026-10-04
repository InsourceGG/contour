"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SurfaceData } from "@/host/readers/types";
import { overviewManifest } from "@/host/manifest";
import { componentLabels, componentMap } from "@/host/components";
import { LiveSurface, useContourLive } from "@contour/sdk/react";
import type { ManualPin, Placement, PreviewData, ProposalStatus, UserPreferences, ViewSnapshot } from "@contour/sdk/core";
import { apiPost, newKey } from "@/components/api";
import { useCsrf } from "@/components/csrf";
import { PlateLines } from "@/components/contour-art";
import { IconAlert } from "@/components/icons";
import { useToast } from "@/components/toast";
import { AdaptPanel } from "./AdaptPanel";
import { ControlDock } from "./ControlDock";
import { PinButton } from "./PinButton";
import { SafeBoundaryBar, useLiveRevision } from "./SafeBoundary";
import { ViewControls } from "./ViewControls";
import { DENSITY_LABEL, templateLabel } from "./labels";

export type ProposalSummary = {
  id: string;
  status: ProposalStatus;
  task: string;
  expertise: string;
  createdAt: string;
  expiresAt: string;
  changeCount: number;
};

export type Credits = { available: number; reserved: number; consumed: number };

type Props = {
  tenant: string;
  snapshot: ViewSnapshot;
  data: SurfaceData;
  prefs: UserPreferences;
  credits: Credits;
  proposals: ProposalSummary[];
  appliedRevision: number | null;
};

export function DashboardClient({ tenant, snapshot, data, prefs, credits, proposals, appliedRevision }: Props) {
  const router = useRouter();
  const { announce, notify } = useToast();
  const csrf = useCsrf();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [pins, setPins] = useState<ManualPin[]>(prefs.pins);
  const [resolvedProposal, setResolvedProposal] = useState<{ id: string; outcome: "accepted" | "kept" } | null>(null);
  const adaptPanelId = useId();
  const live = useContourLive({ endpoint: "/api/host/live" });
  const poller = useLiveRevision(snapshot.revision, live.revision);
  const acceptKeys = useRef(new Map<string, string>());

  async function accept(proposal: PreviewData) {
    const id = proposal.proposal.id;
    const idempotencyKey = acceptKeys.current.get(id) ?? newKey();
    acceptKeys.current.set(id, idempotencyKey);
    const result = await apiPost<{ revision: number }>(
      `/api/host/proposals/${encodeURIComponent(id)}/apply`,
      { configHash: proposal.proposal.configHash, idempotencyKey },
      csrf,
    );
    if (!result.ok) throw result.error;
    setResolvedProposal({ id, outcome: "accepted" });
    notify(`New view applied (revision ${result.data.revision}).`);
    router.refresh();
  }

  async function keep(proposal: PreviewData) {
    const result = await apiPost(`/api/host/proposals/${encodeURIComponent(proposal.proposal.id)}/reject`, {}, csrf);
    if (!result.ok) throw result.error;
    setResolvedProposal({ id: proposal.proposal.id, outcome: "kept" });
    notify("Kept your current view.");
    router.refresh();
  }

  // After Accept: move focus to the surface heading and announce the new revision.
  useEffect(() => {
    if (appliedRevision === null) return;
    headingRef.current?.focus();
    announce(`New view applied (revision ${appliedRevision})`);
    router.replace("/", { scroll: false });
  }, [appliedRevision, announce, router]);

  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.componentId)), [pins]);
  const lockedIds = useMemo(() => new Set(overviewManifest.components.filter((c) => c.locked).map((c) => c.id)), []);

  const renderActions = useCallback(
    (placement: Placement) =>
      lockedIds.has(placement.componentId) ? null : (
        <PinButton
          placement={placement}
          label={componentLabels[placement.componentId] ?? placement.componentId}
          prefs={prefs}
          pins={pins}
          onSaved={setPins}
        />
      ),
    [lockedIds, prefs, pins],
  );

  const visibleProposals = proposals.filter((proposal) => proposal.id !== resolvedProposal?.id);
  const pending = live.proposal?.proposal;
  if (pending && pending.id !== resolvedProposal?.id) {
    const previous = visibleProposals.findIndex((proposal) => proposal.id === pending.id);
    if (previous >= 0) visibleProposals.splice(previous, 1);
    visibleProposals.unshift({
      id: pending.id, status: pending.status, task: pending.task, expertise: pending.expertise,
      createdAt: pending.createdAt, expiresAt: pending.expiresAt, changeCount: live.proposal!.changes.length,
    });
  }
  const readyCount = visibleProposals.filter((p) => p.status === "READY").length;

  return (
    <div className="space-y-6">
      {snapshot.source === "fallback" && (
        <div role="status" className="notice notice-warning">
          <IconAlert size={18} />
          <div>
            <p className="font-semibold">Showing the company default view</p>
            <p className="text-ink-2">
              {snapshot.fallbackReason ?? "Your saved view couldn't be loaded."} Your data and actions work as normal. You
              can reset to save the default, or request a new view.
            </p>
          </div>
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold md:text-3xl">Operations overview</h1>
          <p className="mt-1 max-w-[62ch] text-ink-2">
            {tenant} daily operations. Alerts and required actions stay fixed; the rest can be arranged for your task.
          </p>
        </div>
      </header>

      <ControlDock
        adaptOpen={adaptOpen}
        adaptPanelId={adaptPanelId}
        onToggleAdapt={() => setAdaptOpen((o) => !o)}
        proposals={visibleProposals}
        readyCount={readyCount}
        credits={credits}
      />

      {adaptOpen && (
        <AdaptPanel
          id={adaptPanelId}
          baseRevision={snapshot.revision}
          prefs={prefs}
          credits={credits}
          resolvedProposal={resolvedProposal}
          onClose={() => setAdaptOpen(false)}
        />
      )}

      <section aria-labelledby="surface-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="surface-heading" ref={headingRef} tabIndex={-1} className="text-xl font-semibold">
              Your view
            </h2>
            <p className="meta mt-0.5">
              {snapshot.source === "saved" ? `Saved revision ${snapshot.revision}` : snapshot.source === "default" ? "Company default" : "Default (fallback)"}
              {", "}
              {templateLabel(snapshot.config.templateId)} layout, {DENSITY_LABEL[snapshot.config.densityToken]?.toLowerCase() ?? "standard"} density
              {pins.length > 0 ? `, ${pins.length} pinned` : ""}
            </p>
          </div>
          <ViewControls revision={snapshot.revision} canUndo={snapshot.source === "saved" && snapshot.revision > 0} />
        </div>

        <div className="plate" data-flash={appliedRevision !== null ? "true" : undefined}>
          <PlateLines />
          <LiveSurface
            live={live}
            onAccept={accept}
            onKeep={keep}
            manifest={overviewManifest}
            config={snapshot.config}
            data={data}
            componentMap={componentMap}
            componentLabels={componentLabels}
            renderActions={renderActions}
            pinnedIds={pinnedIds}
            label="Your adaptable view"
          />
        </div>
        <p className="meta">
          Everything inside the shaded area can be adapted. Navigation, account and billing controls never change.
        </p>
      </section>

      <SafeBoundaryBar poller={poller} />
    </div>
  );
}
