import type { ComponentType } from "react";
import type { HostComponentProps } from "./types";
import { Activity } from "./Activity";
import { Alerts } from "./Alerts";
import { Help } from "./Help";
import { Metrics } from "./Metrics";
import { Revenue } from "./Revenue";
import { Tasks } from "./Tasks";

export type { HostComponentProps } from "./types";

/** Each implementation narrows `data` to its own reader output. */
function register<D>(c: ComponentType<HostComponentProps<D>>): ComponentType<HostComponentProps> {
  return c as unknown as ComponentType<HostComponentProps>;
}

/** Company component implementations, keyed by manifest componentId (see src/host/component-ids.ts). */
export const componentMap: Record<string, ComponentType<HostComponentProps>> = {
  alerts: register(Alerts),
  tasks: register(Tasks),
  revenue: register(Revenue),
  metrics: register(Metrics),
  activity: register(Activity),
  help: register(Help),
};

/** Human names used in change lists, pin controls and failure fallbacks. */
export const componentLabels: Record<string, string> = {
  alerts: "Alerts",
  tasks: "Your tasks",
  revenue: "Net revenue",
  metrics: "Key metrics",
  activity: "Recent activity",
  help: "Help",
};
