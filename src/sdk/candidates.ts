import { hashJson } from "./hash";
import type {
  Candidate,
  CandidateId,
  ChangeItem,
  DensityPreference,
  HelpPreference,
  JsonValue,
  ManualPin,
  Placement,
  SurfaceManifest,
  ValidationIssue,
  ViewConfig,
} from "./types";
import { normalizeOrders, validateViewConfig } from "./validate";

/**
 * Company-authored candidate policy. Task priority, explanation level and
 * density are composed independently: the task chooses arrangement, the
 * candidate level chooses explanatory variants, and density follows the
 * user's explicit preference (falling back to the level's default only when
 * no preference was stated). Expertise never forces density.
 */
export type CandidatePolicy = {
  taskLayouts: Record<
    string,
    {
      templateId: string;
      placements: Record<string, { regionId: string; order: number }>;
      settings?: Record<string, Record<string, JsonValue>>;
      helpTopic?: string;
    }
  >;
  levels: Record<
    CandidateId,
    {
      label: string;
      summary: string;
      defaultDensity: DensityPreference;
      variants: Record<string, string>;
      settings?: Record<string, Record<string, JsonValue>>;
      helpVariant: string;
    }
  >;
  helpComponentId: string;
  /** Variant used when help is forced visible but the level would collapse it. */
  helpShowVariant: string;
  densityTokens: Record<DensityPreference, string>;
};

export type CandidateInput = {
  task: string;
  preferences: { density?: DensityPreference; help?: HelpPreference };
  pins: readonly ManualPin[];
};

export type CandidateGeneration = {
  candidates: Candidate[];
  rejected: { id: CandidateId; issues: ValidationIssue[] }[];
  pinConflicts: ValidationIssue[];
};

const ORDER: CandidateId[] = ["guided", "balanced", "dense"];

export function generateCandidates(
  manifest: SurfaceManifest,
  policy: CandidatePolicy,
  input: CandidateInput,
): CandidateGeneration {
  const layout = policy.taskLayouts[input.task];
  if (!layout) throw new Error(`No layout for task ${input.task}`);
  const candidates: Candidate[] = [];
  const rejected: CandidateGeneration["rejected"] = [];
  const pinConflicts: ValidationIssue[] = [];

  for (const id of ORDER) {
    const level = policy.levels[id];
    const density = input.preferences.density ?? level.defaultDensity;
    const placements: Placement[] = manifest.components.map((spec) => {
      const base = manifest.defaultConfig.placements.find((p) => p.componentId === spec.id)!;
      if (spec.locked) return structuredClone(base);
      const pos = layout.placements[spec.id] ?? { regionId: base.regionId, order: base.order };
      const settings: Record<string, JsonValue> = {
        ...spec.defaultSettings,
        ...(layout.settings?.[spec.id] ?? {}),
        ...(level.settings?.[spec.id] ?? {}),
      };
      let variantId = level.variants[spec.id] ?? base.variantId;
      let visible = true;
      if (spec.id === policy.helpComponentId) {
        variantId = level.helpVariant;
        if (layout.helpTopic && "topic" in spec.settingsSchema.properties) settings.topic = layout.helpTopic;
        if (input.preferences.help === "hide") visible = false;
        if (input.preferences.help === "show" && variantId === "collapsed") variantId = policy.helpShowVariant;
      }
      return { componentId: spec.id, regionId: pos.regionId, order: pos.order, variantId, visible, settings };
    });

    // Reapply manual pins on top of the generated arrangement.
    for (const pin of input.pins) {
      const p = placements.find((x) => x.componentId === pin.componentId);
      if (!p) continue;
      if (pin.regionId !== undefined && pin.regionId !== p.regionId) {
        p.regionId = pin.regionId;
        p.order = 99; // append to the end of the pinned region before normalizing
      }
      if (pin.visible !== undefined) p.visible = pin.visible;
      if (pin.variantId !== undefined) p.variantId = pin.variantId;
    }

    // Satisfy dependencies by stepping down explanatory variants (never by
    // un-hiding something the user pinned hidden).
    for (const dep of manifest.dependencies) {
      const p = placements.find((x) => x.componentId === dep.componentId);
      const req = placements.find((x) => x.componentId === dep.requiresVisible);
      if (p && req && p.visible && !req.visible && (!dep.whenVariants || dep.whenVariants.includes(p.variantId))) {
        const pinnedVariant = input.pins.some((pin) => pin.componentId === p.componentId && pin.variantId);
        if (!pinnedVariant) {
          const spec = manifest.components.find((c) => c.id === p.componentId)!;
          const fallback = spec.variants.find((v) => !dep.whenVariants?.includes(v));
          if (fallback) p.variantId = fallback;
        }
      }
    }

    const order = new Map(manifest.components.map((c, i) => [c.id, i]));
    const config: ViewConfig = {
      schemaVersion: "1",
      manifestVersion: manifest.manifestVersion,
      templateId: layout.templateId,
      densityToken: policy.densityTokens[density],
      placements: normalizeOrders(placements).sort((a, b) => order.get(a.componentId)! - order.get(b.componentId)!),
    };
    const result = validateViewConfig(manifest, config, { pins: input.pins });
    if (!result.ok) {
      rejected.push({ id, issues: result.issues });
      for (const iss of result.issues) {
        if (iss.code.startsWith("PIN_") || input.pins.length > 0) pinConflicts.push(iss);
      }
      continue;
    }
    candidates.push({
      id,
      label: level.label,
      summary: describeCandidate(manifest, level.summary, config),
      config,
      configHash: hashJson(config),
    });
  }
  return { candidates, rejected, pinConflicts: dedupeIssues(pinConflicts) };
}

function dedupeIssues(list: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = `${i.code}|${i.path}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Short, model-safe description of a config: IDs, variants and regions only. */
export function describeCandidate(manifest: SurfaceManifest, intro: string, config: ViewConfig): string {
  const template = manifest.templates.find((t) => t.id === config.templateId);
  const parts = config.placements
    .filter((p) => p.visible)
    .sort((a, b) => regionRank(a.regionId) - regionRank(b.regionId) || a.order - b.order)
    .map((p) => `${p.componentId}=${p.variantId}@${p.regionId}`);
  const hidden = config.placements.filter((p) => !p.visible).map((p) => p.componentId);
  return `${intro} Template ${template?.label ?? config.templateId}; density ${config.densityToken.replace("density.", "")}; ${parts.join(", ")}${hidden.length ? `; hidden: ${hidden.join(", ")}` : ""}.`;
}

function regionRank(r: string): number {
  return ["fixed", "main", "rail", "secondary"].indexOf(r);
}

export function configsEqual(a: ViewConfig, b: ViewConfig): boolean {
  return hashJson(a) === hashJson(b);
}

/** Human-readable change list derived from current → proposed snapshots. */
export function diffConfigs(manifest: SurfaceManifest, from: ViewConfig, to: ViewConfig): ChangeItem[] {
  const changes: ChangeItem[] = [];
  const tLabel = (id: string) => manifest.templates.find((t) => t.id === id)?.label ?? id;
  if (from.templateId !== to.templateId) {
    changes.push({ kind: "template", from: from.templateId, to: to.templateId, summary: `Layout: ${tLabel(from.templateId)} → ${tLabel(to.templateId)}` });
  }
  if (from.densityToken !== to.densityToken) {
    const d = (t: string) => t.replace("density.", "");
    changes.push({ kind: "density", from: from.densityToken, to: to.densityToken, summary: `Density: ${d(from.densityToken)} → ${d(to.densityToken)}` });
  }
  const regionLabel = (id: string) => manifest.templates[0]?.regions.find((r) => r.id === id)?.label ?? id;
  for (const spec of manifest.components) {
    const a = from.placements.find((p) => p.componentId === spec.id);
    const b = to.placements.find((p) => p.componentId === spec.id);
    if (!a || !b) continue;
    const name = humanize(spec.semanticRole);
    if (a.visible !== b.visible) {
      changes.push({ kind: "visibility", componentId: spec.id, from: String(a.visible), to: String(b.visible), summary: `${name}: ${b.visible ? "shown" : "hidden"}` });
    }
    if (a.variantId !== b.variantId) {
      changes.push({ kind: "variant", componentId: spec.id, from: a.variantId, to: b.variantId, summary: `${name}: ${a.variantId} → ${b.variantId}` });
    }
    if (a.regionId !== b.regionId) {
      changes.push({ kind: "region", componentId: spec.id, from: a.regionId, to: b.regionId, summary: `${name} moves to ${regionLabel(b.regionId)}` });
    } else if (a.order !== b.order) {
      changes.push({ kind: "order", componentId: spec.id, from: String(a.order), to: String(b.order), summary: `${name}: position ${a.order + 1} → ${b.order + 1}` });
    }
    const sa = JSON.stringify(sortKeys(a.settings));
    const sb = JSON.stringify(sortKeys(b.settings));
    if (sa !== sb) {
      const keys = Object.keys(b.settings).filter((k) => JSON.stringify(a.settings[k]) !== JSON.stringify(b.settings[k]));
      changes.push({
        kind: "settings",
        componentId: spec.id,
        from: sa,
        to: sb,
        summary: `${name}: ${keys.map((k) => `${k} ${String(a.settings[k])} → ${String(b.settings[k])}`).join(", ")}`,
      });
    }
  }
  return changes;
}

function sortKeys(o: Record<string, JsonValue>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

export function humanize(role: string): string {
  const s = role.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
