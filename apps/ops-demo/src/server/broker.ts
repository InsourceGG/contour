import "server-only";
import { createAdaptiveBroker, type AdaptiveBroker } from "@/sdk/broker";
import { defineAdaptiveApp } from "@/sdk/registry";
import { overviewManifest } from "@/host/manifest";
import { overviewPolicy } from "@/host/policy";
import { COMPONENT_IDS } from "@/host/component-ids";
import { readers } from "@/host/readers";
import { env } from "./env";
import { supabaseStore } from "./store";
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
      store: supabaseStore,
      selector: jevSelector,
      confidenceFloor: env.jevConfidenceFloor,
      appUrl: env.appUrl,
    });
  }
  return broker;
}
