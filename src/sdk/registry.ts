import type { ComponentSpec, SettingSchema, SurfaceManifest, ValidationIssue } from "./types";
import { validateSettings, validateViewConfig } from "./validate";

/**
 * Registration-time validation of a company manifest. Rejects duplicate IDs,
 * unknown reader references, missing defaults, unsupported variants, invalid
 * tokens, unsupported settings schemas, and templates that cannot fit the
 * required components at every supported breakpoint.
 */
export function validateManifest(
  manifest: SurfaceManifest,
  opts: { readerIds: ReadonlySet<string>; implementedComponentIds?: ReadonlySet<string> },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });

  if (manifest.schemaVersion !== "1") add("SCHEMA_VERSION", "schemaVersion", "Only schemaVersion 1 is supported");
  if (!/^[a-z0-9-]{2,40}$/.test(manifest.appId)) add("INVALID_ID", "appId", "Invalid appId");
  if (!/^[a-z0-9-]{2,40}$/.test(manifest.surfaceId)) add("INVALID_ID", "surfaceId", "Invalid surfaceId");
  if (!manifest.defaultConfig) add("MISSING_DEFAULT", "defaultConfig", "A safe default configuration is required");

  const ids = new Set<string>();
  manifest.components.forEach((c, i) => {
    const path = `components[${i}]`;
    if (ids.has(c.id)) add("DUPLICATE_COMPONENT", `${path}.id`, `Duplicate component id "${c.id}"`);
    ids.add(c.id);
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(c.id)) add("INVALID_ID", `${path}.id`, `Invalid component id "${c.id}"`);
    if (c.variants.length === 0) add("NO_VARIANTS", `${path}.variants`, `${c.id} needs at least one variant`);
    if (new Set(c.variants).size !== c.variants.length) add("DUPLICATE_VARIANT", `${path}.variants`, `${c.id} has duplicate variants`);
    const described = Object.keys(c.variantDescriptions).sort().join(",");
    if (described !== [...c.variants].sort().join(",")) {
      add("UNSUPPORTED_VARIANT", `${path}.variantDescriptions`, `${c.id} variant descriptions must match its variants exactly`);
    }
    if (c.readerId && !opts.readerIds.has(c.readerId)) {
      add("UNKNOWN_READER", `${path}.readerId`, `${c.id} references unregistered reader "${c.readerId}"`);
    }
    if (c.readerId && !c.requiredScope) add("MISSING_SCOPE", `${path}.requiredScope`, `${c.id} reads data and needs a requiredScope`);
    if (opts.implementedComponentIds && !opts.implementedComponentIds.has(c.id)) {
      add("MISSING_IMPLEMENTATION", path, `${c.id} has no registered renderer`);
    }
    if (c.allowedRegions.length === 0) add("NO_REGIONS", `${path}.allowedRegions`, `${c.id} needs an allowed region`);
    issues.push(...validateSettingsSchemaShape(c, `${path}.settingsSchema`));
    issues.push(...validateSettings(c, c.defaultSettings, `${path}.defaultSettings`));
  });

  const tokenPattern = /^[a-z]+\.[a-z0-9-]+$/;
  manifest.tokenIds.forEach((t, i) => {
    if (!tokenPattern.test(t)) add("INVALID_TOKEN", `tokenIds[${i}]`, `Invalid token id "${t}"`);
  });

  const templateIds = new Set<string>();
  manifest.templates.forEach((t, ti) => {
    const path = `templates[${ti}]`;
    if (templateIds.has(t.id)) add("DUPLICATE_TEMPLATE", `${path}.id`, `Duplicate template "${t.id}"`);
    templateIds.add(t.id);
    const regionIds = t.regions.map((r) => r.id);
    const bpIds = new Set(t.breakpoints.map((b) => b.id));
    for (const required of ["narrow", "medium", "wide"] as const) {
      if (!bpIds.has(required)) add("MISSING_BREAKPOINT", `${path}.breakpoints`, `${t.id} is missing the ${required} breakpoint`);
    }
    t.breakpoints.forEach((bp, bi) => {
      const bpPath = `${path}.breakpoints[${bi}]`;
      if ([...bp.regionOrder].sort().join(",") !== [...regionIds].sort().join(",")) {
        add("INVALID_REGION_ORDER", `${bpPath}.regionOrder`, `${t.id}@${bp.id} must order every region exactly once`);
      }
      for (const r of regionIds) {
        const span = bp.regionSpan[r];
        if (!span || span < 1 || span > bp.columns) add("INVALID_SPAN", `${bpPath}.regionSpan.${r}`, `Invalid span for ${r}`);
      }
      // Required components must fit: assign each required component to an
      // allowed region with remaining capacity (locked ones use their default region).
      const remaining = new Map(regionIds.map((r) => [r, bp.regionCapacity[r] ?? 0]));
      const required = manifest.components
        .filter((c) => c.required)
        .sort((a, b) => a.allowedRegions.length - b.allowedRegions.length);
      for (const c of required) {
        const candidates = c.locked
          ? (manifest.defaultConfig?.placements ?? []).filter((p) => p.componentId === c.id).map((p) => p.regionId)
          : c.allowedRegions.filter((r) => regionIds.includes(r));
        const slot = candidates.find((r) => (remaining.get(r) ?? 0) > 0);
        if (!slot) {
          add("TEMPLATE_CANNOT_FIT", bpPath, `${t.id}@${bp.id} cannot fit required component ${c.id}`);
          continue;
        }
        remaining.set(slot, (remaining.get(slot) ?? 0) - 1);
      }
    });
  });

  for (const [i, dep] of manifest.dependencies.entries()) {
    if (!ids.has(dep.componentId) || !ids.has(dep.requiresVisible)) {
      add("UNKNOWN_DEPENDENCY", `dependencies[${i}]`, "Dependency references an unregistered component");
    }
  }

  if (manifest.defaultConfig) {
    const result = validateViewConfig(manifest, manifest.defaultConfig);
    if (!result.ok) {
      for (const iss of result.issues) add("INVALID_DEFAULT", `defaultConfig.${iss.path}`, iss.message);
    }
  }
  return issues;
}

function validateSettingsSchemaShape(c: ComponentSpec, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const s = c.settingsSchema;
  if (s.type !== "object" || s.additionalProperties !== false) {
    issues.push({ code: "OPEN_SCHEMA", path, message: `${c.id} settings schema must be a closed object` });
  }
  for (const key of s.required) {
    if (!(key in s.properties)) issues.push({ code: "UNKNOWN_REQUIRED", path, message: `${c.id} requires unknown setting ${key}` });
  }
  for (const [key, prop] of Object.entries(s.properties)) {
    if (!isSupportedSetting(prop)) {
      issues.push({ code: "UNSUPPORTED_SETTING_SCHEMA", path: `${path}.properties.${key}`, message: `${c.id}.${key} uses an unsupported schema` });
    }
  }
  return issues;
}

function isSupportedSetting(p: SettingSchema): boolean {
  if ("enum" in p) return Array.isArray(p.enum) && p.enum.length > 0 && p.enum.length <= 32;
  if (p.type === "boolean") return true;
  if (p.type === "integer") return Number.isInteger(p.minimum) && Number.isInteger(p.maximum) && p.minimum <= p.maximum;
  if (p.type === "string") return Number.isInteger(p.maxLength) && p.maxLength > 0 && p.maxLength <= 256;
  return false;
}

export type AdaptiveRegistry = {
  surfaces: ReadonlyMap<string, SurfaceManifest>;
  getSurface(surfaceId: string): SurfaceManifest | undefined;
};

/**
 * Builds the trusted registry from company manifests. Throws on any
 * registration issue so a broken manifest can never be deployed silently.
 */
export function defineAdaptiveApp(
  manifests: SurfaceManifest[],
  opts: { readerIds: ReadonlySet<string>; implementedComponentIds?: ReadonlySet<string> },
): AdaptiveRegistry {
  const surfaces = new Map<string, SurfaceManifest>();
  for (const m of manifests) {
    const issues = validateManifest(m, opts);
    if (issues.length) {
      throw new Error(`Invalid manifest ${m.appId}/${m.surfaceId}: ${issues.map((i) => `${i.code} ${i.path}`).join("; ")}`);
    }
    if (surfaces.has(m.surfaceId)) throw new Error(`Duplicate surface ${m.surfaceId}`);
    surfaces.set(m.surfaceId, Object.freeze(m));
  }
  return { surfaces, getSurface: (id) => surfaces.get(id) };
}
