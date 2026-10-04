"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { BreakpointId, Placement, SurfaceManifest, ViewConfig } from "../core/types";
import { ComponentBoundary } from "./ComponentBoundary";
import { breakpointForWidth, measuredGridCells, regionBlocks, sortedBreakpoints, surfaceCss } from "./layout";
import { SurfaceChromeContext } from "./surface-context";
import { densityFromToken, type SurfaceChrome, type SurfaceComponentMap } from "./types";

export type AdaptiveSurfaceProps = {
  manifest: SurfaceManifest;
  /** A validated ViewConfig (the server validates before it ever reaches the renderer). */
  config: ViewConfig;
  /** Reader output keyed by componentId. */
  data: Readonly<Record<string, unknown>>;
  componentMap: SurfaceComponentMap;
  /** Pin one breakpoint regardless of viewport (used by previews). */
  breakpointOverride?: BreakpointId;
  preview?: boolean;
  /** Accessible name for the surface. */
  label?: string;
  /** Human labels per componentId, used by failure fallbacks ("Alerts unavailable"). */
  componentLabels?: Readonly<Record<string, string>>;
  renderActions?: (placement: Placement) => ReactNode;
  pinnedIds?: ReadonlySet<string>;
  /** Components to mark as changed (preview). */
  highlightIds?: ReadonlySet<string>;
  /** Non-destructive working overlays; locked components are always excluded. */
  loadingIds?: ReadonlySet<string>;
  changeBadges?: boolean;
  animateChanges?: boolean;
};

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

/**
 * Renders a validated view. Region placement and spans come from the
 * template's breakpoints via generated CSS grid rules; DOM order follows the
 * breakpoint's `regionOrder` and each placement's `order`, so reading and
 * focus order always match the visual order. Components are keyed by
 * componentId under one stable parent, including hidden panels, so moving a
 * panel preserves local state. component-state.tsx also preserves drafts
 * across page navigation and refreshes.
 */
export function AdaptiveSurface({
  manifest,
  config,
  data,
  componentMap,
  breakpointOverride,
  preview = false,
  label,
  componentLabels,
  renderActions,
  pinnedIds,
  highlightIds,
  loadingIds,
  changeBadges = false,
  animateChanges = false,
}: AdaptiveSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const previousRects = useRef(new Map<string, { left: number; top: number }>());
  const animationsRef = useRef<Animation[]>([]);
  const [measurements, setMeasurements] = useState<{ heights: Map<string, number>; gap: number } | null>(null);
  const scope = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const template = manifest.templates.find((t) => t.id === config.templateId) ?? manifest.templates[0];
  const density = densityFromToken(config.densityToken);
  const bps = sortedBreakpoints(template);
  const widest = bps[bps.length - 1];

  // Measured region stacks need the same active breakpoint as the responsive
  // grid CSS. The server snapshot uses the widest reading order.
  const needsJs = !breakpointOverride;
  const viewportBp = useSyncExternalStore(
    needsJs ? subscribeResize : noopSubscribe,
    () => (needsJs ? breakpointForWidth(template, window.innerWidth).id : widest.id),
    () => widest.id,
  );
  const activeBp = bps.find((b) => b.id === (breakpointOverride ?? viewportBp)) ?? widest;

  const css = useMemo(() => surfaceCss(scope, template, breakpointOverride, config), [scope, template, breakpointOverride, config]);
  const blocks = regionBlocks(template, activeBp, config);
  const placements = [...blocks.flatMap((block) => block.placements), ...config.placements.filter((placement) => !placement.visible)];
  const cells = measurements ? measuredGridCells(template, activeBp, config, measurements.heights, measurements.gap) : null;
  const specs = new Map(manifest.components.map((c) => [c.id, c]));
  const lockedIds = useMemo(
    () => new Set(manifest.components.filter((c) => c.locked).map((c) => c.id)),
    [manifest.components],
  );

  const chrome: SurfaceChrome = { preview, density, renderActions, pinnedIds, lockedIds };

  useLayoutEffect(() => {
    const grid = rootRef.current?.querySelector<HTMLElement>(".cs-grid");
    if (!grid) return;
    const panels = [...grid.querySelectorAll<HTMLElement>(".cs-slot:not([hidden])")];
    function measure() {
      const gap = parseFloat(getComputedStyle(grid!).columnGap) || 0;
      const heights = new Map(panels.map((panel) => [panel.dataset.component!, panel.offsetHeight]));
      setMeasurements((previous) => {
        if (previous?.gap === gap && previous.heights.size === heights.size && [...heights].every(([id, height]) => previous.heights.get(id) === height)) return previous;
        return { heights, gap };
      });
    }
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    panels.forEach((panel) => observer.observe(panel));
    return () => observer.disconnect();
  }, [config, activeBp]);

  useLayoutEffect(() => {
    // Wait for the first measured layout. Page scrolling and status-bar
    // insertion must not look like panel movement within the surface.
    if (!measurements) return;
    const frame = requestAnimationFrame(() => {
      animationsRef.current.forEach((animation) => animation.cancel());
      const next = new Map<string, { left: number; top: number }>();
      const animations: Animation[] = [];
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const surfaceRect = rootRef.current?.getBoundingClientRect();
      if (!surfaceRect) return;
      rootRef.current?.querySelectorAll<HTMLElement>(".cs-slot:not([hidden])").forEach((panel) => {
        const id = panel.dataset.component!;
        const rect = panel.getBoundingClientRect();
        const position = { left: rect.left - surfaceRect.left, top: rect.top - surfaceRect.top };
        next.set(id, position);
        const previous = previousRects.current.get(id);
        if (!animateChanges || reducedMotion || !previous || !panel.animate) return;
        const x = previous.left - position.left;
        const y = previous.top - position.top;
        if (Math.abs(x) + Math.abs(y) < 1) return;
        animations.push(panel.animate([{ transform: `translate(${x}px,${y}px)` }, { transform: "translate(0,0)" }], { duration: 240, easing: "cubic-bezier(.2,.7,.2,1)" }));
      });
      previousRects.current = next;
      animationsRef.current = animations;
    });
    return () => cancelAnimationFrame(frame);
  }, [config, activeBp, animateChanges, measurements]);

  useLayoutEffect(() => () => animationsRef.current.forEach((animation) => animation.cancel()), []);

  return (
    <SurfaceChromeContext value={chrome}>
      <div
        ref={rootRef}
        className="cs-root"
        data-cs={scope}
        data-density={density}
        data-template={template.id}
        data-preview={preview ? "true" : undefined}
        role="group"
        aria-label={label ?? manifest.label}
      >
        <style>{css}</style>
        <div className="cs-grid" style={cells ? { gridAutoRows: "1px", rowGap: 0 } : undefined}>
          {placements.map((placement) => {
            const spec = specs.get(placement.componentId);
            const Impl = componentMap[placement.componentId];
            const name = componentLabels?.[placement.componentId] ?? capitalize(placement.componentId);
            const cell = cells?.get(placement.componentId);
            return (
              <div
                key={placement.componentId}
                className="cs-slot"
                hidden={!placement.visible}
                style={{ position: "relative", minWidth: 0, ...(cell ? { gridColumn: `${cell.column} / span ${cell.span}`, gridRow: `${cell.row} / span ${cell.rowSpan}` } : {}) }}
                data-component={placement.componentId}
                data-region={placement.regionId}
                data-changed={highlightIds?.has(placement.componentId) ? "true" : undefined}
              >
                <ComponentBoundary
                  idPrefix={scope}
                  componentId={placement.componentId}
                  label={name}
                  required={spec?.required ?? false}
                  preview={preview}
                >
                  {Impl ? <Impl placement={placement} data={data[placement.componentId]} density={density} preview={preview} /> : <MissingImplementation name={name} />}
                </ComponentBoundary>
                {changeBadges && highlightIds?.has(placement.componentId) && <span className="contour-live-badge" aria-hidden="true">Changed</span>}
                {loadingIds?.has(placement.componentId) && !lockedIds.has(placement.componentId) && (
                  <div className="contour-live-skeleton" data-testid="live-skeleton" aria-hidden="true"><span /><span /><span /></div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </SurfaceChromeContext>
  );
}

function noopSubscribe() {
  return () => {};
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function MissingImplementation({ name }: { name: string }): never {
  throw new Error(`No registered implementation for ${name}`);
}
