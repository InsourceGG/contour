import { describe, expect, it } from "vitest";
import { overviewManifest as M } from "./fixtures/manifest";
import { overviewPolicy } from "./fixtures/policy";
import { configsEqual, diffConfigs, generateCandidates } from "../src/core/candidates";
import { hashJson } from "../src/core/hash";
import { defineAdaptiveApp, validateManifest } from "../src/core/registry";
import type { SurfaceManifest, ViewConfig } from "../src/core/types";
import { validateViewConfig } from "../src/core/validate";

const READERS = new Set(["revenue.summary", "metrics.summary", "tasks.list", "activity.recent", "alerts.active"]);
const IMPL = new Set(["alerts", "tasks", "revenue", "metrics", "activity", "help"]);
const clone = <T,>(v: T): T => structuredClone(v);
const codes = (r: ReturnType<typeof validateViewConfig>) => (r.ok ? [] : r.issues.map((i) => i.code));
const withPlacement = (c: ViewConfig, id: string, patch: Partial<ViewConfig["placements"][number]>): ViewConfig => ({
  ...c,
  placements: c.placements.map((p) => (p.componentId === id ? { ...p, ...patch } : p)),
});

describe("A01 contract: registration", () => {
  it("accepts the shipped manifest with six components and readers", () => {
    expect(validateManifest(M, { readerIds: READERS, implementedComponentIds: IMPL })).toEqual([]);
    expect(M.components).toHaveLength(6);
    expect(() => defineAdaptiveApp([M], { readerIds: READERS, implementedComponentIds: IMPL })).not.toThrow();
  });

  it("rejects duplicate component IDs", () => {
    const m = clone(M) as SurfaceManifest;
    m.components.push(clone(m.components[1]));
    expect(validateManifest(m, { readerIds: READERS }).map((i) => i.code)).toContain("DUPLICATE_COMPONENT");
  });

  it("rejects unknown reader references", () => {
    const m = clone(M) as SurfaceManifest;
    m.components[2].readerId = "revenue.raw_sql";
    expect(validateManifest(m, { readerIds: READERS }).map((i) => i.code)).toContain("UNKNOWN_READER");
  });

  it("rejects unsupported variants and invalid tokens", () => {
    const m = clone(M) as SurfaceManifest;
    m.components[2].variantDescriptions = { summary: "x" };
    m.tokenIds = ["Density Comfortable!"];
    const c = validateManifest(m, { readerIds: READERS }).map((i) => i.code);
    expect(c).toContain("UNSUPPORTED_VARIANT");
    expect(c).toContain("INVALID_TOKEN");
  });

  it("rejects templates that cannot fit required components at every breakpoint", () => {
    const m = clone(M) as SurfaceManifest;
    const t = m.templates[0];
    (t.breakpoints as SurfaceManifest["templates"][number]["breakpoints"][number][])[0] = {
      ...t.breakpoints[0],
      regionCapacity: { fixed: 1, main: 0, rail: 0, secondary: 0 },
    };
    expect(validateManifest(m, { readerIds: READERS }).map((i) => i.code)).toContain("TEMPLATE_CANNOT_FIT");
  });

  it("rejects a missing renderer and a missing default", () => {
    expect(validateManifest(M, { readerIds: READERS, implementedComponentIds: new Set(["alerts"]) }).map((i) => i.code)).toContain(
      "MISSING_IMPLEMENTATION",
    );
    const m = clone(M) as SurfaceManifest;
    (m as Partial<SurfaceManifest>).defaultConfig = undefined;
    expect(validateManifest(m, { readerIds: READERS }).map((i) => i.code)).toContain("MISSING_DEFAULT");
  });
});

describe("A01/A04/A05 deterministic config validation", () => {
  const base = M.defaultConfig;

  it("accepts the default", () => {
    expect(validateViewConfig(M, base).ok).toBe(true);
  });

  it("rejects unknown components, variants, settings, tokens, templates and regions", () => {
    expect(codes(validateViewConfig(M, { ...base, placements: [...base.placements, { ...base.placements[1], componentId: "payroll" }] }))).toContain(
      "UNKNOWN_COMPONENT",
    );
    expect(codes(validateViewConfig(M, withPlacement(base, "revenue", { variantId: "3d-pie" })))).toContain("UNKNOWN_VARIANT");
    expect(codes(validateViewConfig(M, withPlacement(base, "revenue", { settings: { period: "30d", showLegend: true, sql: "drop" } })))).toContain(
      "UNKNOWN_SETTING",
    );
    expect(codes(validateViewConfig(M, withPlacement(base, "revenue", { settings: { period: "365d", showLegend: true } })))).toContain(
      "INVALID_SETTING",
    );
    expect(codes(validateViewConfig(M, { ...base, densityToken: "density.ultra" }))).toContain("UNKNOWN_TOKEN");
    expect(codes(validateViewConfig(M, { ...base, templateId: "freeform" }))).toContain("UNKNOWN_TEMPLATE");
    expect(codes(validateViewConfig(M, withPlacement(base, "help", { regionId: "main" })))).toContain("REGION_NOT_ALLOWED");
    expect(codes(validateViewConfig(M, withPlacement(base, "help", { regionId: "header" })))).toContain("UNKNOWN_REGION");
  });

  it("rejects extra keys anywhere (closed schemas) and executable payloads", () => {
    expect(codes(validateViewConfig(M, { ...base, css: "body{display:none}" }))).toContain("INVALID_SHAPE");
    expect(
      codes(validateViewConfig(M, { ...base, placements: base.placements.map((p, i) => (i === 0 ? { ...p, jsx: "<script/>" } : p)) })),
    ).toContain("INVALID_SHAPE");
    expect(codes(validateViewConfig(M, "not an object"))).toContain("INVALID_SHAPE");
  });

  it("A05: hiding the required, locked alerts panel fails", () => {
    const c = codes(validateViewConfig(M, withPlacement(base, "alerts", { visible: false })));
    expect(c).toContain("REQUIRED_HIDDEN");
    expect(c).toContain("LOCKED_CHANGED");
  });

  it("A05: moving or restyling locked alerts fails", () => {
    expect(codes(validateViewConfig(M, withPlacement(base, "alerts", { regionId: "main", order: 3 })))).toContain("REGION_NOT_ALLOWED");
    expect(codes(validateViewConfig(M, withPlacement(base, "alerts", { order: 1 })))).toContain("LOCKED_CHANGED");
  });

  it("A05: hiding the required task queue (required Acknowledge action) fails", () => {
    expect(codes(validateViewConfig(M, withPlacement(base, "tasks", { visible: false })))).toContain("REQUIRED_HIDDEN");
  });

  it("A05: exceeding region capacity fails at the constraining breakpoint", () => {
    const crowded = {
      ...base,
      templateId: "focus-triage",
      placements: base.placements.map((p) =>
        p.componentId === "revenue" ? { ...p, regionId: "main", order: 0 } : p.componentId === "metrics" ? { ...p, regionId: "main", order: 1 } : p.componentId === "tasks" ? { ...p, regionId: "main", order: 2 } : p.componentId === "help" ? { ...p, order: 0 } : p,
      ),
    };
    expect(codes(validateViewConfig(M, crowded))).toContain("REGION_CAPACITY");
  });

  it("A05: omitting a dependency fails (annotated revenue needs visible metrics)", () => {
    const c = withPlacement(withPlacement(base, "revenue", { variantId: "annotated" }), "metrics", { visible: false });
    expect(codes(validateViewConfig(M, c))).toContain("DEPENDENCY_UNMET");
  });

  it("requires every registered component to be represented exactly once", () => {
    expect(codes(validateViewConfig(M, { ...base, placements: base.placements.filter((p) => p.componentId !== "help") }))).toContain(
      "MISSING_COMPONENT",
    );
    expect(codes(validateViewConfig(M, { ...base, placements: [...base.placements, { ...base.placements[5] }] }))).toContain(
      "DUPLICATE_COMPONENT",
    );
  });

  it("requires normalized ordering", () => {
    expect(codes(validateViewConfig(M, withPlacement(base, "metrics", { order: 5 })))).toContain("ORDER_NOT_NORMALIZED");
  });

  it("enforces manual pins", () => {
    const r = validateViewConfig(M, base, { pins: [{ componentId: "activity", regionId: "rail" }] });
    expect(codes(r)).toContain("PIN_VIOLATED");
  });

  it("rejects configs for a different manifest version", () => {
    expect(codes(validateViewConfig(M, { ...base, manifestVersion: "0.9.0" }))).toContain("MANIFEST_VERSION_MISMATCH");
  });
});

describe("A02 context separation and candidate generation", () => {
  const tasks = ["review_performance", "triage_work"];

  it("generates three valid candidates per task, all keeping required content", () => {
    for (const task of tasks) {
      const g = generateCandidates(M, overviewPolicy, { task, preferences: {}, pins: [] });
      expect(g.candidates.map((c) => c.id)).toEqual(["guided", "balanced", "dense"]);
      for (const c of g.candidates) {
        expect(validateViewConfig(M, c.config).ok).toBe(true);
        expect(c.config.placements.find((p) => p.componentId === "alerts")?.visible).toBe(true);
        expect(c.config.placements.find((p) => p.componentId === "tasks")?.visible).toBe(true);
        expect(c.configHash).toBe(hashJson(c.config));
      }
    }
  });

  it("expertise is not an input to candidate generation (cannot change access or controls)", () => {
    // generateCandidates has no expertise parameter at all; the same candidates
    // exist for beginners and experts, JEV only chooses among them.
    const a = generateCandidates(M, overviewPolicy, { task: "review_performance", preferences: {}, pins: [] });
    const b = generateCandidates(M, overviewPolicy, { task: "review_performance", preferences: {}, pins: [] });
    expect(a.candidates.map((c) => c.configHash)).toEqual(b.candidates.map((c) => c.configHash));
  });

  it("expert + quiet overview: explicit comfortable density applies even to the dense candidate", () => {
    const g = generateCandidates(M, overviewPolicy, { task: "review_performance", preferences: { density: "comfortable" }, pins: [] });
    for (const c of g.candidates) expect(c.config.densityToken).toBe("density.comfortable");
    const dense = g.candidates.find((c) => c.id === "dense")!;
    expect(dense.config.placements.find((p) => p.componentId === "revenue")?.variantId).toBe("dense");
  });

  it("beginner + advanced panel with help: help forced visible even in the dense candidate", () => {
    const g = generateCandidates(M, overviewPolicy, { task: "triage_work", preferences: { help: "show", density: "compact" }, pins: [] });
    const dense = g.candidates.find((c) => c.id === "dense")!;
    const help = dense.config.placements.find((p) => p.componentId === "help")!;
    expect(help.visible).toBe(true);
    expect(help.variantId).not.toBe("collapsed");
    expect(dense.config.densityToken).toBe("density.compact");
  });

  it("task drives arrangement independently of explanation level", () => {
    const perf = generateCandidates(M, overviewPolicy, { task: "review_performance", preferences: {}, pins: [] }).candidates[0];
    const tri = generateCandidates(M, overviewPolicy, { task: "triage_work", preferences: {}, pins: [] }).candidates[0];
    expect(perf.config.templateId).toBe("focus-performance");
    expect(tri.config.templateId).toBe("focus-triage");
    expect(tri.config.placements.find((p) => p.componentId === "tasks")?.regionId).toBe("main");
  });

  it("reapplies manual pins and never silently discards them", () => {
    const g = generateCandidates(M, overviewPolicy, {
      task: "review_performance",
      preferences: {},
      pins: [{ componentId: "activity", regionId: "rail", visible: true }],
    });
    for (const c of g.candidates) expect(c.config.placements.find((p) => p.componentId === "activity")?.regionId).toBe("rail");
  });

  it("reports pin conflicts when no candidate can satisfy them", () => {
    const g = generateCandidates(M, overviewPolicy, {
      task: "triage_work",
      preferences: {},
      pins: [{ componentId: "revenue", regionId: "main", visible: true }],
    });
    expect(g.candidates).toHaveLength(0);
    expect(g.pinConflicts.length).toBeGreaterThan(0);
  });

  it("steps down annotated revenue when metrics is pinned hidden (dependency)", () => {
    const g = generateCandidates(M, overviewPolicy, {
      task: "review_performance",
      preferences: {},
      pins: [{ componentId: "metrics", visible: false }],
    });
    const guided = g.candidates.find((c) => c.id === "guided")!;
    expect(guided.config.placements.find((p) => p.componentId === "revenue")?.variantId).not.toBe("annotated");
  });

  it("derives a readable diff", () => {
    const c = generateCandidates(M, overviewPolicy, { task: "triage_work", preferences: {}, pins: [] }).candidates[2];
    const diff = diffConfigs(M, M.defaultConfig, c.config);
    expect(diff.some((d) => d.kind === "template")).toBe(true);
    expect(diff.some((d) => d.kind === "density")).toBe(true);
    expect(configsEqual(M.defaultConfig, M.defaultConfig)).toBe(true);
  });
});
