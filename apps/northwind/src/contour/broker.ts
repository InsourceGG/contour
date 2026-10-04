import "server-only";
import { createAdaptiveBroker, defineAdaptiveApp } from "@contour/sdk/core";
import { createJevSelector } from "@contour/sdk/jev";
import { componentIds } from "./component-ids";
import { manifest } from "./manifest";
import { policy } from "./policy";
import { readers } from "./readers";
import { contour } from "./server";

/** Throws at startup if the manifest, readers, or renderers disagree. */
export const registry = defineAdaptiveApp([manifest], { readerIds: new Set(readers.keys()), implementedComponentIds: componentIds });

const selector = createJevSelector({
  apiKey: () => process.env.AI_GATEWAY_API_KEY ?? "",
  model: () => process.env.JEV_MODEL ?? "typesafe-ai/jev",
  timeoutMs: () => Number(process.env.JEV_TIMEOUT_MS ?? 4000),
});

let broker: ReturnType<typeof createAdaptiveBroker> | undefined;

/** Created on first request so APP_URL is read lazily. */
export function getBroker() {
  broker ??= createAdaptiveBroker({
    registry,
    policies: { desk: policy },
    readers,
    store: contour.store,
    selector,
    confidenceFloor: 0.6,
    appUrl: contour.config.appUrl,
    readerTimeoutMs: 5000,
    maxReaderOutputBytes: 64_000,
    billing: contour.config.billing,
  });
  return broker;
}
