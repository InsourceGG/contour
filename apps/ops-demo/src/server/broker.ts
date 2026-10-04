import "server-only";
import { createAdaptiveBroker, defineAdaptiveApp, type AdaptiveBroker } from "@contour/sdk/core";
import { overviewManifest } from "@/host/manifest";
import { overviewPolicy } from "@/host/policy";
import { COMPONENT_IDS } from "@/host/component-ids";
import { readers } from "@/host/readers";
import { contour } from "./contour";
import { env } from "./env";
import { jevSelector } from "./jev";

let broker: AdaptiveBroker | null = null;

export const registry = defineAdaptiveApp([overviewManifest], {
  readerIds: new Set(readers.keys()),
  implementedComponentIds: COMPONENT_IDS,
});

/** The single broker used by host routes, server components and the MCP endpoint. */
export function getBroker(): AdaptiveBroker {
  if (!broker) {
    broker = createAdaptiveBroker({
      registry,
      policies: { overview: overviewPolicy },
      readers,
      store: contour.store,
      selector: jevSelector,
      confidenceFloor: env.jevConfidenceFloor,
      appUrl: env.appUrl,
    });
  }
  return broker;
}
