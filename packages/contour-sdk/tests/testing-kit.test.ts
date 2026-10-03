import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ReaderDef } from "../src/core/broker";
import type { SurfaceManifest } from "../src/core/types";
import { runContractKit } from "../src/testing";
import { overviewManifest as M } from "./fixtures/manifest";
import { overviewPolicy } from "./fixtures/policy";

const reader = (id: string, over: Partial<ReaderDef> = {}): ReaderDef => ({
  id,
  description: id,
  requiredScope: "data:read",
  inputSchema: z.strictObject({}),
  inputDescription: {},
  fields: [],
  read: async () => ({}),
  ...over,
});
const IDS = ["revenue.summary", "metrics.summary", "tasks.list", "activity.recent", "alerts.active"];
const readers = () => IDS.map((id) => reader(id));
const components = ["alerts", "tasks", "revenue", "metrics", "activity", "help"];
const clone = <T,>(v: T): T => structuredClone(v);

describe("runContractKit", () => {
  it("passes the fixture manifest with every check named", async () => {
    const report = await runContractKit({ manifest: M, policy: overviewPolicy, readers: readers(), componentIds: components });
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report).toMatchObject({ ok: true, failed: 0, passed: report.checks.length });
    expect(report.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("registration"),
        "default config validates",
        expect.stringContaining("required components are visible"),
        expect.stringContaining("extra top-level key"),
        expect.stringContaining("unknown variant"),
        expect.stringContaining("unknown setting"),
        expect.stringContaining("hiding a required component"),
        expect.stringContaining("moving a locked component"),
        expect.stringContaining("input schema rejects an unknown key"),
      ]),
    );
  });

  it("accepts readers as a map and componentIds as a set", async () => {
    const report = await runContractKit({
      manifest: M,
      policy: overviewPolicy,
      readers: new Map(readers().map((r) => [r.id, r])),
      componentIds: new Set(components),
    });
    expect(report.ok).toBe(true);
  });

  it("fails registration by name when a component ID is duplicated", async () => {
    const m = clone(M) as SurfaceManifest;
    m.components.push(clone(m.components[1]));
    const report = await runContractKit({ manifest: m, policy: overviewPolicy, readers: readers(), componentIds: components });
    expect(report.ok).toBe(false);
    const failed = report.checks.filter((c) => !c.ok);
    const reg = failed.find((c) => c.name.startsWith("registration"));
    expect(reg?.detail).toContain("DUPLICATE_COMPONENT");
    expect(report.failed).toBe(failed.length);
  });

  it("fails the reader checks for a missing reader, an open input schema and a non-agent scope", async () => {
    const report = await runContractKit({
      manifest: M,
      policy: overviewPolicy,
      readers: readers().filter((r) => r.id !== "tasks.list").map((r) =>
        r.id === "revenue.summary" ? { ...r, inputSchema: z.object({}) } : r.id === "metrics.summary" ? { ...r, requiredScope: "view:commit" as const } : r,
      ),
      componentIds: components,
    });
    const byName = (s: string) => report.checks.find((c) => c.name.includes(s));
    expect(byName("registered and agent-readable")).toMatchObject({ ok: false });
    expect(byName("registered and agent-readable")?.detail).toContain("tasks.list");
    expect(byName("registered and agent-readable")?.detail).toContain("view:commit");
    expect(byName("input schema rejects an unknown key")?.detail).toContain("revenue.summary");
  });

  it("reports a policy that misses a task instead of throwing", async () => {
    const policy = { ...overviewPolicy, taskLayouts: { review_performance: overviewPolicy.taskLayouts.review_performance } };
    const report = await runContractKit({ manifest: M, policy, readers: readers(), componentIds: components });
    expect(report.checks.find((c) => c.name.startsWith("candidates"))).toMatchObject({ ok: false });
  });
});
