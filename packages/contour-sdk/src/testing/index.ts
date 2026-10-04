/**
 * @contour/sdk/testing: a pure contract kit for a company's manifest, policy
 * and readers. No network, no database, no framework. Run it from a unit test
 * or a setup script to prove an integration honours the Contour contract.
 */
import type { ReaderDef } from "../core/broker";
import { generateCandidates, type CandidatePolicy } from "../core/candidates";
import { validateManifest } from "../core/registry";
import { AGENT_SCOPES, type DensityPreference, type SurfaceManifest, type ViewConfig } from "../core/types";
import { validateViewConfig } from "../core/validate";

export type ContractReport = {
  ok: boolean;
  passed: number;
  failed: number;
  checks: { name: string; ok: boolean; detail?: string }[];
};

type Check = { name: string; ok: boolean; detail?: string };

const DENSITIES: readonly DensityPreference[] = ["comfortable", "compact"];
const UNKNOWN = "contour-contract-unknown";

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Runs one named check; a throw is a failure, never an exception for the caller. */
function check(checks: Check[], name: string, fn: () => string[] | string | null | void): void {
  try {
    const out = fn();
    const problems = Array.isArray(out) ? out : out ? [out] : [];
    checks.push(problems.length ? { name, ok: false, detail: problems.slice(0, 8).join("; ") } : { name, ok: true });
  } catch (e) {
    checks.push({ name, ok: false, detail: `threw: ${messageOf(e)}` });
  }
}

function patchPlacement(config: ViewConfig, componentId: string, patch: Partial<ViewConfig["placements"][number]>): ViewConfig {
  return { ...config, placements: config.placements.map((p) => (p.componentId === componentId ? { ...p, ...patch } : p)) };
}

/** Expects validation to fail and, when a code is given, to name that code. */
function expectRejected(manifest: SurfaceManifest, config: unknown, code?: string): string | null {
  const r = validateViewConfig(manifest, config);
  if (r.ok) return "was accepted";
  if (code && !r.issues.some((i) => i.code === code)) {
    return `was rejected without ${code} (got ${[...new Set(r.issues.map((i) => i.code))].join(", ")})`;
  }
  return null;
}

export async function runContractKit(input: {
  manifest: SurfaceManifest;
  policy: CandidatePolicy;
  readers: ReadonlyMap<string, ReaderDef> | readonly ReaderDef[];
  componentIds: ReadonlySet<string> | readonly string[];
}): Promise<ContractReport> {
  const { manifest, policy } = input;
  const readers = new Map<string, ReaderDef>(
    input.readers instanceof Map ? input.readers : (input.readers as readonly ReaderDef[]).map((r) => [r.id, r] as const),
  );
  const componentIds = new Set<string>(input.componentIds);
  const checks: Check[] = [];
  const base = manifest.defaultConfig;

  check(checks, "registration: manifest, readers and renderers", () =>
    validateManifest(manifest, { readerIds: new Set(readers.keys()), implementedComponentIds: componentIds }).map(
      (i) => `${i.code} ${i.path}: ${i.message}`,
    ),
  );

  check(checks, "default config validates", () => {
    const r = validateViewConfig(manifest, base);
    return r.ok ? [] : r.issues.map((i) => `${i.code} ${i.path}`);
  });

  check(checks, "readers: registered and agent-readable", () => {
    const problems: string[] = [];
    for (const c of manifest.components) {
      if (!c.readerId) continue;
      const reader = readers.get(c.readerId);
      if (!reader) {
        problems.push(`${c.id} references unregistered reader "${c.readerId}"`);
        continue;
      }
      if (!AGENT_SCOPES.includes(reader.requiredScope)) {
        problems.push(`reader "${reader.id}" requires scope "${reader.requiredScope}", which agents can never hold`);
      }
    }
    return problems;
  });

  check(checks, "required components are visible in the default", () =>
    manifest.components
      .filter((c) => c.required)
      .filter((c) => base.placements.find((p) => p.componentId === c.id)?.visible !== true)
      .map((c) => `${c.id} is required but not visible in the default`),
  );

  check(checks, "candidates: every task and density keeps required and locked components", () => {
    const problems: string[] = [];
    if (manifest.tasks.length === 0) return "the manifest declares no tasks";
    for (const task of manifest.tasks) {
      for (const density of DENSITIES) {
        const where = `task ${task.id}, density ${density}`;
        let result;
        try {
          result = generateCandidates(manifest, policy, { task: task.id, preferences: { density }, pins: [] });
        } catch (e) {
          problems.push(`${where}: ${messageOf(e)}`);
          continue;
        }
        if (result.candidates.length === 0) {
          problems.push(`${where}: no valid candidate (${result.rejected.map((r) => r.id).join(", ") || "none generated"})`);
          continue;
        }
        for (const cand of result.candidates) {
          const valid = validateViewConfig(manifest, cand.config);
          if (!valid.ok) problems.push(`${where}, ${cand.id}: ${valid.issues.map((i) => i.code).join(", ")}`);
          for (const spec of manifest.components) {
            const p = cand.config.placements.find((x) => x.componentId === spec.id);
            if (spec.required && p?.visible !== true) problems.push(`${where}, ${cand.id}: required ${spec.id} not visible`);
            if (spec.locked) {
              const d = base.placements.find((x) => x.componentId === spec.id);
              if (!p || !d || JSON.stringify(p) !== JSON.stringify(d)) problems.push(`${where}, ${cand.id}: locked ${spec.id} changed`);
            }
          }
        }
      }
    }
    return problems;
  });

  const first = base?.placements?.[0];

  check(checks, "closed schema: extra top-level key is rejected", () =>
    expectRejected(manifest, { ...base, [UNKNOWN]: true }, "INVALID_SHAPE"),
  );

  check(checks, "closed schema: unknown variant is rejected", () => {
    if (!first) return "the default has no placements";
    const r = expectRejected(manifest, patchPlacement(base, first.componentId, { variantId: UNKNOWN }), "UNKNOWN_VARIANT");
    return r && `variant ${r}`;
  });

  check(checks, "closed schema: unknown setting is rejected", () => {
    if (!first) return "the default has no placements";
    const r = expectRejected(
      manifest,
      patchPlacement(base, first.componentId, { settings: { ...first.settings, [UNKNOWN]: true } }),
      "UNKNOWN_SETTING",
    );
    return r && `setting ${r}`;
  });

  check(checks, "closed schema: hiding a required component is rejected", () => {
    const spec = manifest.components.find((c) => c.required);
    if (!spec) return null; // nothing required, nothing to hide
    const r = expectRejected(manifest, patchPlacement(base, spec.id, { visible: false }), "REQUIRED_HIDDEN");
    return r && `hiding ${spec.id} ${r}`;
  });

  check(checks, "closed schema: moving a locked component is rejected", () => {
    const spec = manifest.components.find((c) => c.locked);
    if (!spec) return null; // nothing locked, nothing to move
    const p = base.placements.find((x) => x.componentId === spec.id);
    if (!p) return `${spec.id} has no default placement`;
    const r = expectRejected(manifest, patchPlacement(base, spec.id, { order: p.order + 1 }), "LOCKED_CHANGED");
    return r && `moving ${spec.id} ${r}`;
  });

  check(checks, "readers: input schema rejects an unknown key", () => {
    const problems: string[] = [];
    for (const reader of readers.values()) {
      const r = reader.inputSchema.safeParse({ [UNKNOWN]: true });
      if (r.success) problems.push(`reader "${reader.id}" accepts unknown keys; use z.strictObject`);
    }
    return problems;
  });

  const passed = checks.filter((c) => c.ok).length;
  return { ok: passed === checks.length, passed, failed: checks.length - passed, checks };
}
