"use client";

import type { SurfaceData } from "@/host/readers/types";
import { overviewManifest } from "@/host/manifest";
import { componentLabels, componentMap } from "@/host/components";
import { ViewPreview } from "@contour/sdk/react";
import type { ChangeItem, ViewConfig, ViewSnapshot } from "@contour/sdk/core";

type Props = {
  current: ViewSnapshot;
  proposed: ViewConfig;
  changes: ChangeItem[];
  currentData: SurfaceData;
  proposedData: SurfaceData;
  pinnedIds: string[];
};

/** Client boundary that supplies the company component map to the SDK preview. */
export function PreviewSurface({ current, proposed, changes, currentData, proposedData, pinnedIds }: Props) {
  return (
    <ViewPreview
      manifest={overviewManifest}
      current={current}
      proposed={proposed}
      changes={changes}
      data={currentData}
      proposedData={proposedData}
      componentMap={componentMap}
      componentLabels={componentLabels}
      pinnedIds={new Set(pinnedIds)}
    />
  );
}
