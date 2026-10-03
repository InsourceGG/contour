import type { BreakpointId, LayoutTemplate, Placement, TemplateBreakpoint, ViewConfig } from "../core/types";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function sortedBreakpoints(template: LayoutTemplate): TemplateBreakpoint[] {
  return [...template.breakpoints].sort((a, b) => a.minWidth - b.minWidth);
}

export type RegionBlock = { regionId: string; label: string; placements: Placement[] };

/** Visible placements grouped by region, in the breakpoint's reading order, each sorted by `order`. */
export function regionBlocks(template: LayoutTemplate, bp: TemplateBreakpoint, config: ViewConfig): RegionBlock[] {
  const labels = new Map(template.regions.map((r) => [r.id, r.label]));
  const order = bp.regionOrder.length ? bp.regionOrder : template.regions.map((r) => r.id);
  return order
    .map((regionId) => ({
      regionId,
      label: labels.get(regionId) ?? regionId,
      placements: config.placements
        .filter((p) => p.visible && p.regionId === regionId)
        .sort((a, b) => a.order - b.order || a.componentId.localeCompare(b.componentId)),
    }))
    .filter((b) => b.placements.length > 0);
}

export function regionOrdersDiffer(template: LayoutTemplate): boolean {
  const keys = new Set(template.breakpoints.map((b) => b.regionOrder.join("|")));
  return keys.size > 1;
}

function clampSpan(span: number, columns: number) {
  return Math.max(1, Math.min(columns, Math.floor(span) || columns));
}

function rulesFor(scope: string, bp: TemplateBreakpoint): string {
  const sel = `[data-cs="${scope}"]`;
  const cols = Math.max(1, Math.floor(bp.columns));
  let css = `${sel} .cs-grid{grid-template-columns:repeat(${cols},minmax(0,1fr));}`;
  for (const [region, span] of Object.entries(bp.regionSpan)) {
    if (!SAFE_ID.test(region)) continue;
    const s = clampSpan(span, cols);
    css += `${sel} .cs-region[data-region="${region}"]{grid-column:span ${s}/span ${s};}`;
  }
  return css;
}

/**
 * Generates the grid CSS for a template from the company manifest (trusted,
 * reviewed metadata; identifiers are still allowlisted). Breakpoints use
 * viewport media queries with the manifest's `minWidth` values; previews pass
 * an override that pins a single breakpoint.
 */
export function surfaceCss(scope: string, template: LayoutTemplate, override?: BreakpointId): string {
  if (!SAFE_ID.test(scope)) return "";
  const bps = sortedBreakpoints(template);
  if (bps.length === 0) return "";
  if (override) return rulesFor(scope, bps.find((b) => b.id === override) ?? bps[bps.length - 1]);
  return bps
    .map((bp) => (bp.minWidth <= 0 ? rulesFor(scope, bp) : `@media (min-width:${Math.floor(bp.minWidth)}px){${rulesFor(scope, bp)}}`))
    .join("");
}

/** Active breakpoint for a viewport width. */
export function breakpointForWidth(template: LayoutTemplate, width: number): TemplateBreakpoint {
  const bps = sortedBreakpoints(template);
  let active = bps[0];
  for (const bp of bps) if (width >= bp.minWidth) active = bp;
  return active;
}
