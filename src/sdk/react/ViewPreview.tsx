"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { BreakpointId, ChangeItem, SurfaceManifest, ViewConfig, ViewSnapshot } from "../types";
import { AdaptiveSurface } from "./AdaptiveSurface";
import type { SurfaceComponentMap } from "./types";

type Props = {
  manifest: SurfaceManifest;
  current: ViewSnapshot;
  proposed: ViewConfig;
  changes: ChangeItem[];
  /** Reader output for the current view. */
  data: Readonly<Record<string, unknown>>;
  /** Reader output for the proposed view when its settings differ (defaults to `data`). */
  proposedData?: Readonly<Record<string, unknown>>;
  componentMap: SurfaceComponentMap;
  componentLabels?: Readonly<Record<string, string>>;
  pinnedIds?: ReadonlySet<string>;
};

const VIRTUAL_WIDTH: Record<BreakpointId, number> = { wide: 1280, medium: 880, narrow: 390 };
const BP_LABEL: Record<BreakpointId, string> = { wide: "Desktop", medium: "Tablet", narrow: "Phone" };

const KIND_LABEL: Record<ChangeItem["kind"], string> = {
  template: "Layout",
  density: "Density",
  visibility: "Shown or hidden",
  variant: "Presentation",
  region: "Position",
  order: "Order",
  settings: "Settings",
};
const KIND_ORDER: ChangeItem["kind"][] = ["template", "density", "visibility", "variant", "region", "order", "settings"];

/**
 * Before/after comparison using the same renderer and component
 * implementations in preview mode. Side by side on wide screens, tabs on
 * narrow ones; a layout switch shows how each breakpoint will look.
 */
export function ViewPreview({ manifest, current, proposed, changes, data, proposedData, componentMap, componentLabels, pinnedIds }: Props) {
  const [tab, setTab] = useState<"current" | "proposed">("proposed");
  const [bp, setBp] = useState<BreakpointId>("wide");
  const baseId = useId();
  const changedIds = new Set(changes.map((c) => c.componentId).filter((x): x is string => !!x));
  const tabs = [
    { id: "current" as const, label: `Current view (revision ${current.revision})` },
    { id: "proposed" as const, label: "Proposed view" },
  ];

  function onTabKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = tab === "current" ? "proposed" : "current";
    setTab(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  }

  return (
    <div className="space-y-6">
      <ChangeList changes={changes} labels={componentLabels} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="vp-tabs">
          <div className="seg" role="tablist" aria-label="Choose which view to show">
            {tabs.map((t) => (
              <button
                key={t.id}
                id={`${baseId}-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`${baseId}-panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={onTabKey}
                className={`rounded-[7px] px-3 py-1.5 text-sm ${tab === t.id ? "bg-surface font-semibold text-ink shadow-[0_1px_0_rgb(19_33_43/0.08)]" : "text-ink-2"}`}
              >
                {t.id === "current" ? "Current" : "Proposed"}
              </button>
            ))}
          </div>
        </div>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Show the layout as it appears on</legend>
          <span className="text-sm text-ink-2" aria-hidden="true">
            Show on
          </span>
          <div className="seg">
            {(["wide", "medium", "narrow"] as const).map((id) => (
              <label key={id}>
                <input type="radio" name={`${baseId}-bp`} value={id} checked={bp === id} onChange={() => setBp(id)} />
                {BP_LABEL[id]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {tabs.map((t) => (
          <section
            key={t.id}
            id={`${baseId}-panel-${t.id}`}
            className="vp-pane min-w-0"
            data-active={tab === t.id ? "true" : undefined}
            aria-labelledby={`${baseId}-h-${t.id}`}
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`${baseId}-h-${t.id}`} className="text-lg font-semibold">
                {t.label}
              </h2>
              {t.id === "proposed" && changedIds.size > 0 && (
                <span className="meta">
                  <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle ring-2 ring-accent" aria-hidden="true" />
                  Outlined panels change
                </span>
              )}
            </div>
            <ScaledFrame virtualWidth={VIRTUAL_WIDTH[bp]}>
              <AdaptiveSurface
                manifest={manifest}
                config={t.id === "current" ? current.config : proposed}
                data={t.id === "current" ? data : (proposedData ?? data)}
                componentMap={componentMap}
                componentLabels={componentLabels}
                breakpointOverride={bp}
                pinnedIds={pinnedIds}
                highlightIds={t.id === "proposed" ? changedIds : undefined}
                label={t.label}
                preview
              />
            </ScaledFrame>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Renders children at a virtual width and scales them to fit the pane (CSS zoom keeps layout height honest). */
function ScaledFrame({ virtualWidth, children }: { virtualWidth: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(virtualWidth);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setAvailable(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const zoom = Math.min(1, available / virtualWidth);
  return (
    <div ref={ref} className="vp-frame">
      <div className="vp-canvas" style={{ width: virtualWidth, zoom }}>
        {children}
      </div>
    </div>
  );
}

function ChangeList({ changes, labels }: { changes: ChangeItem[]; labels?: Readonly<Record<string, string>> }) {
  if (changes.length === 0) {
    return (
      <section aria-labelledby="vp-changes" className="panel p-4">
        <h2 id="vp-changes" className="section-title">
          What changes
        </h2>
        <p className="mt-1 text-ink-2">This proposal matches your current view. Nothing would change.</p>
      </section>
    );
  }
  const groups = KIND_ORDER.map((kind) => ({ kind, items: changes.filter((c) => c.kind === kind) })).filter((g) => g.items.length);
  return (
    <section aria-labelledby="vp-changes" className="panel p-4 md:p-5">
      <h2 id="vp-changes" className="section-title">
        What changes <span className="font-normal text-ink-3">({changes.length})</span>
      </h2>
      <div className="mt-3 grid gap-x-8 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <div key={g.kind}>
            <h3 className="text-sm font-semibold text-ink-2">{KIND_LABEL[g.kind]}</h3>
            <ul className="mt-1.5 space-y-2">
              {g.items.map((c, i) => (
                <li key={`${c.kind}-${c.componentId ?? "view"}-${i}`} className="text-sm">
                  <p>{c.summary}</p>
                  <p className="meta">
                    {c.componentId ? `${labels?.[c.componentId] ?? c.componentId}: ` : ""}
                    <span className="line-through decoration-ink-3/60">{c.from}</span>
                    <span aria-hidden="true"> ⟶ </span>
                    <span className="sr-only"> changes to </span>
                    <span className="font-semibold text-ink">{c.to}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
