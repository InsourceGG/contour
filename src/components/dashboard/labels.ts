import { overviewManifest } from "@/host/manifest";

export function taskLabel(id: string): string {
  return overviewManifest.tasks.find((t) => t.id === id)?.label ?? id;
}

export function expertiseLabel(id: string): string {
  return overviewManifest.expertiseLevels.find((e) => e.id === id)?.label ?? id;
}

export function templateLabel(id: string): string {
  return overviewManifest.templates.find((t) => t.id === id)?.label ?? id;
}

export function regionLabel(id: string): string {
  return overviewManifest.templates[0]?.regions.find((r) => r.id === id)?.label ?? id;
}

export const DENSITY_LABEL: Record<string, string> = {
  "density.comfortable": "Comfortable",
  "density.compact": "Compact",
  comfortable: "Comfortable",
  compact: "Compact",
};

export const HELP_LABEL: Record<string, string> = { auto: "Automatic", show: "Show help", hide: "Hide help" };
