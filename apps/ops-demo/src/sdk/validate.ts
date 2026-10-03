import { z } from "zod";
import type {
  ComponentSpec,
  JsonValue,
  LayoutTemplate,
  ManualPin,
  Placement,
  SettingSchema,
  SurfaceManifest,
  ValidationIssue,
  ViewConfig,
} from "./types";

/**
 * Deterministic validation of a full ViewConfig against a trusted manifest.
 *
 * Order (spec §5): closed structural schema → unknown keys/IDs → value
 * constraints → relational whole-result rules → manual pins. The model can
 * never waive a rule; every entry point (proposal creation, preview read,
 * commit, saved-view load) calls the same function.
 */

const ID = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/);
const SettingValue = z.union([z.string().max(128), z.number().finite(), z.boolean()]);

export const PlacementSchema = z.strictObject({
  componentId: ID,
  regionId: ID,
  order: z.number().int().min(0).max(63),
  variantId: ID,
  visible: z.boolean(),
  settings: z.record(z.string().max(64), SettingValue).refine((o) => Object.keys(o).length <= 16, "too many settings"),
});

export const ViewConfigSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  manifestVersion: z.string().min(1).max(32),
  templateId: ID,
  densityToken: ID,
  placements: z.array(PlacementSchema).min(1).max(32),
});

export const ManualPinSchema = z.strictObject({
  componentId: ID,
  regionId: ID.optional(),
  visible: z.boolean().optional(),
  variantId: ID.optional(),
});

export type ValidationResult =
  | { ok: true; config: ViewConfig; rules: string[] }
  | { ok: false; issues: ValidationIssue[]; rules: string[] };

export const VALIDATION_RULES = [
  "closed_schema",
  "manifest_version",
  "known_template",
  "known_token",
  "known_components",
  "complete_placements",
  "allowed_region",
  "known_variant",
  "settings_schema",
  "normalized_order",
  "required_visible",
  "locked_unchanged",
  "region_capacity_all_breakpoints",
  "dependencies",
  "manual_pins",
] as const;

export function validateSettingValue(schema: SettingSchema, value: unknown): string | null {
  if ("enum" in schema) {
    return schema.enum.some((e) => e === value) ? null : `must be one of ${schema.enum.join(", ")}`;
  }
  switch (schema.type) {
    case "boolean":
      return typeof value === "boolean" ? null : "must be a boolean";
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return "must be an integer";
      if (value < schema.minimum || value > schema.maximum) return `must be between ${schema.minimum} and ${schema.maximum}`;
      return null;
    case "string":
      if (typeof value !== "string") return "must be a string";
      if (value.length > schema.maxLength) return `must be at most ${schema.maxLength} characters`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return "has an invalid format";
      return null;
  }
}

export function validateSettings(
  spec: ComponentSpec,
  settings: Record<string, JsonValue>,
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const props = spec.settingsSchema.properties;
  for (const key of Object.keys(settings)) {
    if (!Object.prototype.hasOwnProperty.call(props, key)) {
      issues.push({ code: "UNKNOWN_SETTING", path: `${path}.${key}`, message: `Setting "${key}" is not registered for ${spec.id}` });
    }
  }
  for (const key of spec.settingsSchema.required) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) {
      issues.push({ code: "MISSING_SETTING", path: `${path}.${key}`, message: `Setting "${key}" is required for ${spec.id}` });
    }
  }
  for (const [key, schema] of Object.entries(props)) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
    const err = validateSettingValue(schema, settings[key]);
    if (err) issues.push({ code: "INVALID_SETTING", path: `${path}.${key}`, message: `${spec.id}.${key} ${err}` });
  }
  return issues;
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

export function validateViewConfig(
  manifest: SurfaceManifest,
  input: unknown,
  opts: { pins?: readonly ManualPin[] } = {},
): ValidationResult {
  const rules = [...VALIDATION_RULES];
  // 1. Closed structural schema.
  const parsed = ViewConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      rules,
      issues: parsed.error.issues.slice(0, 20).map((i) =>
        issue("INVALID_SHAPE", i.path.length ? i.path.join(".") : "$", i.message),
      ),
    };
  }
  const config = parsed.data as ViewConfig;
  const issues: ValidationIssue[] = [];

  // 2. Known identifiers and versions.
  if (config.manifestVersion !== manifest.manifestVersion) {
    issues.push(issue("MANIFEST_VERSION_MISMATCH", "manifestVersion", `Expected ${manifest.manifestVersion}`));
  }
  const template = manifest.templates.find((t) => t.id === config.templateId);
  if (!template) issues.push(issue("UNKNOWN_TEMPLATE", "templateId", `Template "${config.templateId}" is not registered`));
  if (!manifest.tokenIds.includes(config.densityToken)) {
    issues.push(issue("UNKNOWN_TOKEN", "densityToken", `Token "${config.densityToken}" is not registered`));
  }
  if (config.placements.length > manifest.limits.maxPlacements) {
    issues.push(issue("TOO_MANY_PLACEMENTS", "placements", `At most ${manifest.limits.maxPlacements} placements`));
  }

  const specs = new Map(manifest.components.map((c) => [c.id, c]));
  const seen = new Set<string>();
  config.placements.forEach((p, i) => {
    const path = `placements[${i}]`;
    const spec = specs.get(p.componentId);
    if (!spec) {
      issues.push(issue("UNKNOWN_COMPONENT", `${path}.componentId`, `Component "${p.componentId}" is not registered`));
      return;
    }
    if (seen.has(p.componentId)) {
      issues.push(issue("DUPLICATE_COMPONENT", `${path}.componentId`, `Component "${p.componentId}" appears more than once`));
    }
    seen.add(p.componentId);
    if (template && !template.regions.some((r) => r.id === p.regionId)) {
      issues.push(issue("UNKNOWN_REGION", `${path}.regionId`, `Region "${p.regionId}" is not in template ${template.id}`));
    } else if (!spec.allowedRegions.includes(p.regionId)) {
      issues.push(issue("REGION_NOT_ALLOWED", `${path}.regionId`, `${spec.id} may not be placed in "${p.regionId}"`));
    }
    if (!spec.variants.includes(p.variantId)) {
      issues.push(issue("UNKNOWN_VARIANT", `${path}.variantId`, `Variant "${p.variantId}" is not registered for ${spec.id}`));
    }
    issues.push(...validateSettings(spec, p.settings, `${path}.settings`));
  });

  for (const spec of manifest.components) {
    if (!seen.has(spec.id)) {
      issues.push(issue("MISSING_COMPONENT", "placements", `Component "${spec.id}" must be represented (hidden optional components included)`));
    }
  }

  // 3. Relational rules over the whole result.
  const byRegion = new Map<string, Placement[]>();
  for (const p of config.placements) {
    const list = byRegion.get(p.regionId) ?? [];
    list.push(p);
    byRegion.set(p.regionId, list);
  }
  for (const [regionId, list] of byRegion) {
    const orders = list.map((p) => p.order).sort((a, b) => a - b);
    if (orders.some((o, idx) => o !== idx)) {
      issues.push(issue("ORDER_NOT_NORMALIZED", `regions.${regionId}`, `Orders in "${regionId}" must be unique and contiguous from 0`));
    }
  }

  const defaults = new Map(manifest.defaultConfig.placements.map((p) => [p.componentId, p]));
  config.placements.forEach((p, i) => {
    const spec = specs.get(p.componentId);
    if (!spec) return;
    const path = `placements[${i}]`;
    if (spec.required && !p.visible) {
      issues.push(issue("REQUIRED_HIDDEN", `${path}.visible`, `${spec.id} is required and cannot be hidden`));
    }
    if (spec.locked) {
      const d = defaults.get(spec.id);
      if (
        !d ||
        d.regionId !== p.regionId ||
        d.order !== p.order ||
        d.variantId !== p.variantId ||
        d.visible !== p.visible ||
        JSON.stringify(d.settings) !== JSON.stringify(p.settings)
      ) {
        issues.push(issue("LOCKED_CHANGED", path, `${spec.id} is locked by company policy and cannot be moved or changed`));
      }
    }
  });

  if (template) issues.push(...checkCapacity(template, config.placements));

  for (const dep of manifest.dependencies) {
    const p = config.placements.find((x) => x.componentId === dep.componentId);
    if (!p || !p.visible) continue;
    if (dep.whenVariants && !dep.whenVariants.includes(p.variantId)) continue;
    const req = config.placements.find((x) => x.componentId === dep.requiresVisible);
    if (!req || !req.visible) {
      issues.push(issue("DEPENDENCY_UNMET", `placements.${dep.componentId}`, dep.reason));
    }
  }

  // 4. Manual pins.
  for (const [i, pin] of (opts.pins ?? []).entries()) {
    const p = config.placements.find((x) => x.componentId === pin.componentId);
    const path = `pins[${i}]`;
    if (!p) {
      issues.push(issue("PIN_UNKNOWN_COMPONENT", path, `Pinned component "${pin.componentId}" is not placed`));
      continue;
    }
    if (pin.regionId !== undefined && pin.regionId !== p.regionId) {
      issues.push(issue("PIN_VIOLATED", path, `${pin.componentId} is pinned to region "${pin.regionId}"`));
    }
    if (pin.visible !== undefined && pin.visible !== p.visible) {
      issues.push(issue("PIN_VIOLATED", path, `${pin.componentId} is pinned ${pin.visible ? "visible" : "hidden"}`));
    }
    if (pin.variantId !== undefined && pin.variantId !== p.variantId) {
      issues.push(issue("PIN_VIOLATED", path, `${pin.componentId} is pinned to variant "${pin.variantId}"`));
    }
  }

  return issues.length ? { ok: false, issues: issues.slice(0, 50), rules } : { ok: true, config, rules };
}

export function checkCapacity(template: LayoutTemplate, placements: readonly Placement[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const visibleByRegion = new Map<string, number>();
  for (const p of placements) if (p.visible) visibleByRegion.set(p.regionId, (visibleByRegion.get(p.regionId) ?? 0) + 1);
  for (const bp of template.breakpoints) {
    for (const [regionId, count] of visibleByRegion) {
      const cap = bp.regionCapacity[regionId] ?? 0;
      if (count > cap) {
        issues.push(
          issue("REGION_CAPACITY", `regions.${regionId}`, `"${regionId}" holds ${cap} visible components at ${bp.id} width; ${count} requested`),
        );
      }
    }
  }
  return issues;
}

/** Renumber orders inside each region to 0..n-1 preserving relative order. */
export function normalizeOrders(placements: Placement[]): Placement[] {
  const byRegion = new Map<string, Placement[]>();
  for (const p of placements) {
    const list = byRegion.get(p.regionId) ?? [];
    list.push(p);
    byRegion.set(p.regionId, list);
  }
  const out: Placement[] = [];
  for (const list of byRegion.values()) {
    list
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((p, idx) => out.push({ ...p, order: idx }));
  }
  return out;
}
