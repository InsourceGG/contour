import type { BreakpointId, LayoutTemplate, Placement, TemplateBreakpoint, ViewConfig } from "../core/types";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function sortedBreakpoints(template: LayoutTemplate): TemplateBreakpoint[] {
  return [...template.breakpoints].sort((a, b) => a.minWidth - b.minWidth);
}

export type RegionBlock = { regionId: string; label: string; placements: Placement[] };
export type GridCell = { column: number; span: number; row: number; rowSpan: number };

/** Pixel rows keep each region's natural independent stack while all panels share a React parent. */
export function measuredGridCells(template: LayoutTemplate, bp: TemplateBreakpoint, config: ViewConfig, heights: ReadonlyMap<string, number>, gap: number): Map<string, GridCell> {
  const columns = Math.max(1, Math.floor(bp.columns));
  const cells = new Map<string, GridCell>();
  let column = 1;
  let bandRow = 1;
  let bandHeight = 0;
  const spacing = Math.max(0, Math.ceil(gap));
  for (const block of regionBlocks(template, bp, config)) {
    const span = clampSpan(bp.regionSpan[block.regionId] ?? columns, columns);
    if (column + span - 1 > columns) { bandRow += bandHeight + spacing; column = 1; bandHeight = 0; }
    let offset = 0;
    block.placements.forEach((placement, index) => {
      const height = Math.max(1, Math.ceil(heights.get(placement.componentId) ?? 1));
      cells.set(placement.componentId, { column, span, row: bandRow + offset, rowSpan: height });
      offset += height + (index < block.placements.length - 1 ? spacing : 0);
    });
    bandHeight = Math.max(bandHeight, offset);
    column += span;
  }
  return cells;
}

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

function rulesFor(scope: string, bp: TemplateBreakpoint, template: LayoutTemplate, config?: ViewConfig): string {
  const sel = `[data-cs="${scope}"]`;
  const cols = Math.max(1, Math.floor(bp.columns));
  let css = `${sel} .cs-grid{grid-template-columns:repeat(${cols},minmax(0,1fr));}`;
  for (const [region, span] of Object.entries(bp.regionSpan)) {
    if (!SAFE_ID.test(region)) continue;
    const s = clampSpan(span, cols);
    css += `${sel} .cs-region[data-region="${region}"]{grid-column:span ${s}/span ${s};}`;
  }
  if (config) {
    // Panels remain direct keyed children. Explicit cells preserve region reading
    // order without changing their React parent when a proposal moves a panel.
    let column = 1;
    let row = 1;
    let bandHeight = 0;
    for (const block of regionBlocks(template, bp, config)) {
      const span = clampSpan(bp.regionSpan[block.regionId] ?? cols, cols);
      if (column + span - 1 > cols) { row += bandHeight; column = 1; bandHeight = 0; }
      block.placements.forEach((placement, index) => {
        if (!SAFE_ID.test(placement.componentId)) return;
        css += `${sel} .cs-slot[data-component="${placement.componentId}"]{grid-column:${column}/span ${span};grid-row:${row + index};}`;
      });
      bandHeight = Math.max(bandHeight, block.placements.length);
      column += span;
    }
  }
  return css;
}

/**
 * Generates the grid CSS for a template from the company manifest (trusted,
 * reviewed metadata; identifiers are still allowlisted). Breakpoints use
 * viewport media queries with the manifest's `minWidth` values; previews pass
 * an override that pins a single breakpoint.
 */
export function surfaceCss(scope: string, template: LayoutTemplate, override?: BreakpointId, config?: ViewConfig): string {
  if (!SAFE_ID.test(scope)) return "";
  const bps = sortedBreakpoints(template);
  if (bps.length === 0) return "";
  if (override) return rulesFor(scope, bps.find((b) => b.id === override) ?? bps[bps.length - 1], template, config);
  return bps
    .map((bp) => (bp.minWidth <= 0 ? rulesFor(scope, bp, template, config) : `@media (min-width:${Math.floor(bp.minWidth)}px){${rulesFor(scope, bp, template, config)}}`))
    .join("");
}

/** Active breakpoint for a viewport width. */
export function breakpointForWidth(template: LayoutTemplate, width: number): TemplateBreakpoint {
  const bps = sortedBreakpoints(template);
  let active = bps[0];
  for (const bp of bps) if (width >= bp.minWidth) active = bp;
  return active;
}
