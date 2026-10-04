import type { ComponentType, ReactNode } from "react";
import type { BreakpointId, Placement } from "../core/types";

export type Density = "comfortable" | "compact";

/** Props every registered component implementation receives from the renderer. */
export type SurfaceComponentProps<D = unknown> = {
  placement: Placement;
  /** Reader output for this component; undefined when the reader failed or access is missing. */
  data: D | undefined;
  density: Density;
  /** Preview mode: actions are disabled and the component is labelled as a preview. */
  preview?: boolean;
};

export type SurfaceComponentMap = Record<string, ComponentType<SurfaceComponentProps>>;

export type SurfaceChrome = {
  preview: boolean;
  density: Density;
  /** Host-supplied controls rendered in each component's header (e.g. pin toggles). */
  renderActions?: (placement: Placement) => ReactNode;
  pinnedIds?: ReadonlySet<string>;
  lockedIds?: ReadonlySet<string>;
};

export type { BreakpointId };

export function densityFromToken(token: string): Density {
  return token === "density.compact" ? "compact" : "comfortable";
}
