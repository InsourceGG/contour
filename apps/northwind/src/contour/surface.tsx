"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AdaptiveSurface, ComponentStateProvider, LiveSurface, useContourLive } from "@contour/sdk/react";
import type { PreviewData, ViewConfig } from "@contour/sdk/core";
import { componentMap, type DeskHostData } from "./components";
import { loadProposalDeskData } from "./live-actions";
import { componentLabels, manifest } from "./manifest";

/** Must match the SDK's CSRF_HEADER, which lives in the server-only entry. */
const CSRF_HEADER = "x-contour-csrf";
/** Served by the Contour catch-all mount through the `/api/host/:path*` rewrite. */
const LIVE_ENDPOINT = "/api/host/live";

type Data = Partial<DeskHostData>;

/**
 * Fills a pending proposal's gaps with host-loaded data: panels the current
 * view hides, and the other filter or range a proposal picks. The current
 * view's own data is never replaced, so a draft in progress stays put.
 */
function withProposalData(current: Data, proposed: Data | null): Data {
  if (!proposed) return current;
  const merged: Data = { ...current };
  for (const key of Object.keys(proposed) as (keyof DeskHostData)[]) {
    if (!merged[key]) (merged as Record<string, unknown>)[key] = proposed[key];
  }
  const queue = current["ticket-queue"], nextQueue = proposed["ticket-queue"];
  if (queue && nextQueue && queue.filter !== nextQueue.filter) merged["ticket-queue"] = { ...queue, alternates: [nextQueue] };
  const csat = current["csat-trend"], nextCsat = proposed["csat-trend"];
  if (csat && nextCsat && csat.range !== nextCsat.range) merged["csat-trend"] = { ...csat, alternates: [nextCsat] };
  return merged;
}

async function decide(proposal: PreviewData, action: "apply" | "reject", csrfToken: string, idempotencyKey?: string) {
  let response: Response;
  try {
    response = await fetch(`/api/host/proposals/${encodeURIComponent(proposal.proposal.id)}/${action}`, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json", [CSRF_HEADER]: csrfToken },
      body: JSON.stringify(action === "apply" ? { configHash: proposal.proposal.configHash, idempotencyKey } : {}),
    });
  } catch {
    throw { code: "OFFLINE" };
  }
  const result = await response.json().catch(() => null) as { code?: string; error?: { code?: string }; revision?: number } | null;
  // Keep stale, expired, and invalid errors distinct for the inline message.
  if (!response.ok) throw { code: result?.code ?? result?.error?.code ?? "UNKNOWN" };
  return result;
}

function LiveDesk({ config, data, csrfToken }: { config: ViewConfig; data: Data; csrfToken: string }) {
  const router = useRouter();
  const live = useContourLive({ endpoint: LIVE_ENDPOINT, intervalMs: 1200 });
  const acceptKeys = useRef(new Map<string, string>());
  const proposalId = live.proposal?.proposal.id ?? null;
  const [proposed, setProposed] = useState<{ id: string; data: Data | null } | null>(null);

  useEffect(() => {
    if (!proposalId || proposed?.id === proposalId) return;
    let cancelled = false;
    // On failure the preview falls back to the desk's current data.
    loadProposalDeskData(proposalId).catch(() => null).then((next) => {
      if (!cancelled) setProposed({ id: proposalId, data: next });
    });
    return () => { cancelled = true; };
  }, [proposalId, proposed?.id]);

  const merged = useMemo(() => withProposalData(data, proposed?.data ?? null), [data, proposed]);
  // Keep showing the working state until the proposal's own rows are loaded,
  // so the preview never flashes the current filter's data.
  const dataReady = !proposalId || proposed?.id === proposalId;
  const shown = useMemo(() => dataReady || !live.job ? live : { ...live, proposal: null, job: { ...live.job, status: "working" as const } }, [live, dataReady]);

  async function accept(proposal: PreviewData) {
    const id = proposal.proposal.id;
    const key = acceptKeys.current.get(id) ?? `nw-${crypto.randomUUID()}`;
    acceptKeys.current.set(id, key);
    const result = await decide(proposal, "apply", csrfToken, key);
    // Load the saved view from the server; the success notice names the new revision.
    router.replace(typeof result?.revision === "number" ? `/desk?applied=${result.revision}` : "/desk", { scroll: false });
  }

  async function keep(proposal: PreviewData) {
    await decide(proposal, "reject", csrfToken);
    router.refresh();
  }

  return <div className="desk-live">
    <LiveSurface
      live={shown}
      onAccept={accept}
      onKeep={keep}
      comparisonHref={(p) => `/contour/preview/${encodeURIComponent(p.proposal.id)}`}
      manifest={manifest}
      config={config}
      data={merged}
      componentMap={componentMap}
      componentLabels={componentLabels}
      label="Support desk panels"
    />
  </div>;
}

/**
 * The adaptive region of /desk. Everything outside it is host chrome. With a
 * verified Contour session it also shows agent proposals live: skeletons while
 * an agent works, then the proposal in place with Accept and Keep current.
 * Nothing is saved until the signed-in user accepts.
 */
export function DeskSurface({ config, data, csrfToken }: { config: ViewConfig; data: Data; csrfToken?: string | null }) {
  return <ComponentStateProvider>
    {csrfToken
      ? <LiveDesk config={config} data={data} csrfToken={csrfToken} />
      : <AdaptiveSurface manifest={manifest} config={config} data={data} componentMap={componentMap} componentLabels={componentLabels} label="Support desk panels" />}
  </ComponentStateProvider>;
}
