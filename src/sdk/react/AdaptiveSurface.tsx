"use client";

import { useId, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { BreakpointId, Placement, SurfaceManifest, ViewConfig } from "../types";
import { ComponentBoundary } from "./ComponentBoundary";
import { breakpointForWidth, regionBlocks, regionOrdersDiffer, sortedBreakpoints, surfaceCss } from "./layout";
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
 * componentId and their state lives above the surface (component-state.tsx),
 * so switching layouts never clears a draft.
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
}: AdaptiveSurfaceProps) {
  const scope = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const template = manifest.templates.find((t) => t.id === config.templateId) ?? manifest.templates[0];
  const density = densityFromToken(config.densityToken);
  const bps = sortedBreakpoints(template);
  const widest = bps[bps.length - 1];

  // Only consult the viewport when breakpoints actually reorder regions;
  // spans and columns are pure CSS. The server snapshot uses the widest order.
  const needsJs = !breakpointOverride && regionOrdersDiffer(template);
  const viewportBp = useSyncExternalStore(
    needsJs ? subscribeResize : noopSubscribe,
    () => (needsJs ? breakpointForWidth(template, window.innerWidth).id : widest.id),
    () => widest.id,
  );
  const activeBp = bps.find((b) => b.id === (breakpointOverride ?? viewportBp)) ?? widest;

  const css = useMemo(() => surfaceCss(scope, template, breakpointOverride), [scope, template, breakpointOverride]);
  const blocks = regionBlocks(template, activeBp, config);
  const specs = new Map(manifest.components.map((c) => [c.id, c]));
  const lockedIds = useMemo(
    () => new Set(manifest.components.filter((c) => c.locked).map((c) => c.id)),
    [manifest.components],
  );

  const chrome: SurfaceChrome = { preview, density, renderActions, pinnedIds, lockedIds };

  return (
    <SurfaceChromeContext value={chrome}>
      <div
        className="cs-root"
        data-cs={scope}
        data-density={density}
        data-template={template.id}
        data-preview={preview ? "true" : undefined}
        role="group"
        aria-label={label ?? manifest.label}
      >
        <style>{css}</style>
        <div className="cs-grid">
          {blocks.map((block) => (
            <div key={block.regionId} className="cs-region" data-region={block.regionId}>
              {block.placements.map((placement) => {
                const spec = specs.get(placement.componentId);
                const Impl = componentMap[placement.componentId];
                const name = componentLabels?.[placement.componentId] ?? capitalize(placement.componentId);
                return (
                  <div
                    key={placement.componentId}
                    className="cs-slot"
                    data-component={placement.componentId}
                    data-changed={highlightIds?.has(placement.componentId) ? "true" : undefined}
                  >
                    <ComponentBoundary
                      idPrefix={scope}
                      componentId={placement.componentId}
                      label={name}
                      required={spec?.required ?? false}
                      preview={preview}
                    >
                      {Impl ? (
                        <Impl placement={placement} data={data[placement.componentId]} density={density} preview={preview} />
                      ) : (
                        <MissingImplementation name={name} />
                      )}
                    </ComponentBoundary>
                  </div>
                );
              })}
            </div>
          ))}
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
