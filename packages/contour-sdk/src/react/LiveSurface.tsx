"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { PreviewData } from "../core/broker";
import type { ViewConfig } from "../core/types";
import { AdaptiveSurface, type AdaptiveSurfaceProps } from "./AdaptiveSurface";
import { liveActionError, resolveLivePresentation, shouldDeferLiveProposal, type ContourLiveError, type LivePresentation } from "./live-state";
import type { UseContourLiveResult } from "./useContourLive";

export type LiveSurfaceProps = AdaptiveSurfaceProps & {
  live: UseContourLiveResult;
  /** Host callback must await the authenticated, CSRF-protected apply and throw on failure. */
  onAccept: (proposal: PreviewData) => Promise<void> | void;
  /** Host callback must await the authenticated, CSRF-protected reject and throw on failure. */
  onKeep: (proposal: PreviewData) => Promise<void> | void;
  comparisonHref?: string | ((proposal: PreviewData) => string);
};

export function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable || element.closest('[contenteditable="true"]')) return true;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return !element.disabled && !element.matches("[readonly]");
  return element instanceof HTMLInputElement && !element.disabled && !element.readOnly && !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"].includes(element.type);
}

/** Presents a pending proposal in the host surface. Persistence belongs exclusively to the host callbacks. */
export function LiveSurface({ live, onAccept, onKeep, comparisonHref, ...surface }: LiveSurfaceProps) {
  const root = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [reviewedId, setReviewedId] = useState<string | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ config: ViewConfig; savedConfig: ViewConfig; baseRevision: number } | null>(null);
  const [busy, setBusy] = useState<"accept" | "keep" | null>(null);
  const busyRef = useRef(false);
  const [actionError, setActionError] = useState<ContourLiveError | null>(null);
  const [shown, setShown] = useState<LivePresentation>(() => ({ config: surface.config, preview: !!surface.preview, highlightIds: surface.highlightIds }));
  const summaryId = useId();
  const proposal = live.proposal?.state === "ready" && live.proposal.proposal.id !== dismissedId ? live.proposal : null;
  const proposalId = proposal?.proposal.id;
  // Read focus before rendering the proposal, including a proposal arriving in
  // the same event turn as a user's keystroke. The delayed blur avoids turning
  // a Review click into an accidental Accept click when its label changes.
  const focused = typeof document !== "undefined" && !!root.current?.contains(document.activeElement) && isEditableElement(document.activeElement);
  const deferred = shouldDeferLiveProposal(proposalId, reviewedId, editing || focused);
  const preview = !!proposal && !deferred;
  const working = live.job?.status === "working";
  const changed = new Set(live.job?.changedComponents ?? []);
  for (const change of proposal?.changes ?? []) if (change.componentId) changed.add(change.componentId);
  if (proposal?.changes.some((change) => change.kind === "template" || change.kind === "density")) {
    for (const spec of surface.manifest.components) if (!spec.locked) changed.add(spec.id);
  }
  const loading = new Set(surface.manifest.components.filter((spec) => !spec.locked && (!changed.size || changed.has(spec.id))).map((spec) => spec.id));
  const names = [...changed].map((id) => surface.componentLabels?.[id] ?? id);
  const summary = names.length ? `Proposed changes to ${names.join(", ")}. Nothing is saved until you accept.` : "A proposed view is ready. Nothing is saved until you accept.";
  const task = surface.manifest.tasks.find((item) => item.id === live.job?.task)?.label ?? live.job?.task ?? "your task";
  const expertise = surface.manifest.expertiseLevels.find((item) => item.id === live.job?.expertise)?.label ?? live.job?.expertise;

  useEffect(() => {
    function checkFocus() { setEditing(!!root.current?.contains(document.activeElement) && isEditableElement(document.activeElement)); }
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    function blur() { clearTimeout(blurTimer); blurTimer = setTimeout(checkFocus, 0); }
    document.addEventListener("focusin", checkFocus);
    document.addEventListener("focusout", blur);
    checkFocus();
    return () => { clearTimeout(blurTimer); document.removeEventListener("focusin", checkFocus); document.removeEventListener("focusout", blur); };
  }, []);
  useEffect(() => { if (proposalId) setActionError(null); }, [proposalId]);
  useEffect(() => { if (preview && proposalId) setReviewedId(proposalId); }, [preview, proposalId]);
  useEffect(() => {
    if (accepted && (JSON.stringify(surface.config) === JSON.stringify(accepted.config) || (surface.config !== accepted.savedConfig && live.revision !== null && live.revision > accepted.baseRevision))) setAccepted(null);
  }, [accepted, surface.config, live.revision]);

  async function act(kind: "accept" | "keep") {
    if (!proposal || busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setActionError(null);
    try {
      const result: unknown = await (kind === "accept" ? onAccept(proposal) : onKeep(proposal));
      // Defensively reject an API result returned without throwing by a host.
      if (result && typeof result === "object" && "ok" in result && result.ok === false) throw result;
      if (kind === "accept") setAccepted({ config: proposal.proposed, savedConfig: surface.config, baseRevision: proposal.current.revision });
      setDismissedId(proposal.proposal.id);
    } catch (error) { setActionError(liveActionError(error)); }
    finally { busyRef.current = false; setBusy(null); }
  }
  const error = actionError ?? live.error;
  const desired: LivePresentation = { config: preview ? proposal!.proposed : accepted?.config ?? surface.config, preview: preview || !!surface.preview, highlightIds: preview ? changed : surface.highlightIds };
  const displayed = resolveLivePresentation(shown, desired, editing || focused, !!proposalId && reviewedId === proposalId);
  const holding = displayed === shown && displayed !== desired;
  useLayoutEffect(() => {
    if (!holding && (shown.config !== displayed.config || shown.preview !== displayed.preview)) setShown(displayed);
  }, [shown, displayed.config, displayed.preview, holding]);
  const showBar = !!(working || proposal || error || holding || live.job?.status === "failed");

  return (
    <div ref={root} className="contour-live" data-live-state={working ? "working" : proposal ? deferred ? "deferred" : "ready" : holding ? "deferred" : "idle"}>
      <style>{LIVE_CSS}</style>
        <div className={showBar ? "contour-live-bar" : "contour-live-sr"} data-testid={showBar ? "live-status" : undefined} role="status" aria-live="polite" aria-atomic="true">
          {showBar && <>
          <div className="contour-live-copy">
            <p>{working ? `Your agent is preparing a view for ${task}.` : deferred ? "A new view is ready. Review when you're done." : proposal ? `Preview for ${task}` : holding ? "Your view changed. Finish editing to refresh it." : live.job?.status === "failed" ? "Your agent couldn't prepare a view. Your current view is unchanged." : "Live updates paused"}</p>
            {proposal && !deferred && <p className="contour-live-detail">{expertise ? `${expertise} view. ` : ""}Nothing is saved until you accept.</p>}
            {error && <p className="contour-live-error">{error.message}</p>}
          </div>
          {proposal && <div className="contour-live-actions">
            {deferred ? <button type="button" className="contour-live-primary" onClick={() => setReviewedId(proposal.proposal.id)}>Review</button> : <button type="button" className="contour-live-primary" disabled={!!busy} onClick={() => void act("accept")}>{busy === "accept" ? "Saving…" : "Accept"}</button>}
            <button type="button" disabled={!!busy} onClick={() => void act("keep")}>{busy === "keep" ? "Keeping…" : "Keep current"}</button>
            <a href={typeof comparisonHref === "function" ? comparisonHref(proposal) : comparisonHref ?? `/preview/${encodeURIComponent(proposal.proposal.id)}`}>See full comparison</a>
          </div>}
          </>}
        </div>
      <p id={summaryId} className="contour-live-sr" aria-live="polite" aria-atomic="true">{preview ? summary : ""}</p>
      <AdaptiveSurface {...surface} config={displayed.config} preview={displayed.preview} highlightIds={displayed.highlightIds} loadingIds={working ? loading : undefined} changeBadges={displayed.preview} animateChanges />
    </div>
  );
}

const LIVE_CSS = `
.contour-live{position:relative;color:var(--color-ink,currentColor)}
.contour-live-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem 1.25rem;padding:.875rem 1rem;margin-bottom:1rem;border:1px solid var(--color-rule,currentColor);border-radius:var(--contour-radius,10px);background:var(--color-surface,Canvas);font-size:.875rem}
.contour-live-copy p{margin:0}.contour-live-copy p:first-child{font-weight:500}.contour-live-detail{color:var(--color-ink-2,currentColor);font-size:.8125rem;padding-top:.25rem}.contour-live-error{color:var(--color-critical,currentColor);padding-top:.375rem}
.contour-live-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}.contour-live-actions button{font:inherit;font-weight:600;min-height:44px;padding:.5rem .875rem;border:1px solid var(--color-rule-strong,currentColor);border-radius:var(--contour-radius,7px);background:var(--color-surface,Canvas);color:var(--color-ink,CanvasText);cursor:pointer}.contour-live-actions button:disabled{opacity:.65;cursor:wait}.contour-live-actions .contour-live-primary{background:var(--color-accent,Highlight);border-color:var(--color-accent,Highlight);color:var(--color-surface,HighlightText)}.contour-live-actions a{color:var(--color-ink-2,LinkText);padding:.5rem;text-decoration:underline;text-underline-offset:3px}.contour-live-actions :is(button,a):focus-visible{outline:2px solid var(--color-accent,Highlight);outline-offset:3px}
.contour-live .cs-slot[data-changed="true"]{outline:2px solid var(--color-accent,currentColor);outline-offset:3px;border-radius:var(--contour-panel-radius,12px)}.contour-live-badge{position:absolute;top:-.65rem;right:.75rem;pointer-events:none;padding:.15rem .4rem;border:1px solid var(--color-accent,currentColor);border-radius:4px;background:var(--color-surface,Canvas);color:var(--color-accent,currentColor);font-size:.75rem;font-weight:600}
.contour-live-skeleton{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:var(--contour-panel-radius,12px);padding:1.25rem;background:color-mix(in srgb,var(--color-surface,Canvas) 88%,transparent)}.contour-live-skeleton span{display:block;height:.625rem;margin-bottom:.875rem;border-radius:3px;background:var(--color-rule,currentColor);opacity:.65}.contour-live-skeleton span:first-child{width:38%;height:.875rem;margin-bottom:1.75rem}.contour-live-skeleton span:last-child{width:64%}.contour-live-skeleton:after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 25%,color-mix(in srgb,var(--color-surface,Canvas) 65%,transparent) 50%,transparent 75%);transform:translateX(-100%);animation:contour-live-shimmer 1.8s cubic-bezier(.4,0,.6,1) infinite}
.contour-live-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@keyframes contour-live-shimmer{to{transform:translateX(100%)}}
@media(prefers-reduced-motion:reduce){.contour-live-skeleton:after{animation:none;display:none}}
`;
