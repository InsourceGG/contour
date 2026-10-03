import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LiveData, PreviewData } from "../src/core/broker";
import { AdaptiveSurface, LiveSurface } from "../src/react";
import { initialLiveState, liveActionError, livePollDelay, liveReducer, resolveLivePresentation, shouldDeferLiveProposal } from "../src/react/live-state";
import { measuredGridCells, surfaceCss } from "../src/react/layout";
import { overviewManifest as manifest } from "./fixtures/manifest";

const config = manifest.defaultConfig;
const preview: PreviewData = {
  state: "ready", stateReason: null, pins: [], changes: [{ kind: "region", componentId: "tasks", from: "rail", to: "main", summary: "Move Your tasks to the primary workspace" }],
  current: { surfaceId: "overview", revision: 2, policyVersion: "1", configHash: "current", config, source: "saved" },
  proposed: { ...config, templateId: "focus-triage" },
  proposal: { id: "proposal-1", ownerSubjectId: "user", tenantId: "tenant", appId: "ops-demo", surfaceId: "overview", baseRevision: 2, manifestVersion: "1.0.0", policyVersion: "1", roleVersion: "1", config, configHash: "proposed", expiresAt: "2026-10-04T00:00:00Z", createdAt: "2026-10-03T00:00:00Z", status: "READY", decisionId: "decision", requestId: "request", candidateId: "triage", task: "triage_work", expertise: "expert", preferences: {}, changes: [], rationale: "Task first" },
};
const live: LiveData = { revision: 2, configHash: "current", proposal: preview, job: { id: "job-1", status: "ready", task: "triage_work", expertise: "expert", changedComponents: ["tasks"], message: null, startedAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:01Z" } };
const componentMap = Object.fromEntries(manifest.components.map((component) => [component.id, () => createElement("article", null, component.id)]));
const props = { manifest, config, data: {}, componentMap };

describe("live polling state and backoff", () => {
  it("exposes a READY preview and recovers from a polling error", () => {
    const received = liveReducer(initialLiveState, { type: "received", data: live });
    expect(received.proposal).toBe(preview);
    const failed = liveReducer(received, { type: "failed", error: { code: "OFFLINE", message: "Offline" } });
    expect(failed.proposal).toBe(preview);
    expect(liveReducer(failed, { type: "received", data: live }).error).toBeNull();
    expect(liveReducer(failed, { type: "reset" })).toEqual(initialLiveState);
  });
  it.each(["expired", "stale", "invalid", "applied", "rejected"] as const)("never presents a %s proposal", (state) => {
    expect(liveReducer(initialLiveState, { type: "received", data: { ...live, proposal: { ...preview, state } } }).proposal).toBeNull();
  });
  it("does not present a ready proposal belonging to a non-ready or missing job", () => {
    for (const status of ["working", "kept", "asked", "failed"] as const) expect(liveReducer(initialLiveState, { type: "received", data: { ...live, job: { ...live.job!, status } } }).proposal).toBeNull();
    expect(liveReducer(initialLiveState, { type: "received", data: { ...live, job: null } }).proposal).toBeNull();
  });
  it("backs off exponentially, caps at 30 seconds, and never shortens the interval", () => {
    expect([0, 1, 2, 3, 4, 5, 8].map((failures) => livePollDelay(1200, failures))).toEqual([1200, 2400, 4800, 9600, 19200, 30000, 30000]);
    expect(livePollDelay(60_000, 5)).toBe(60_000);
    expect(livePollDelay(NaN)).toBe(1200);
    expect(livePollDelay(1200, -1)).toBe(1200);
  });
  it("distinguishes failed commit causes using safe copy", () => {
    const messages = ["STALE_REVISION", "EXPIRED_PROPOSAL", "INVALID_CONFIG"].map((code) => liveActionError({ code, message: "secret diagnostic" }).message);
    expect(new Set(messages).size).toBe(3);
    expect(messages.join()).not.toContain("secret diagnostic");
    expect(liveActionError({ ok: false, error: { code: "EXPIRED_PROPOSAL" } }).code).toBe("EXPIRED_PROPOSAL");
    expect(liveActionError(new Error("private provider error")).message).toContain("hasn't been saved");
  });
  it("holds a new proposal while editing but never reverses a preview when typing resumes", () => {
    expect(shouldDeferLiveProposal("proposal-1", null, true)).toBe(true);
    expect(shouldDeferLiveProposal("proposal-1", null, false)).toBe(false);
    expect(shouldDeferLiveProposal("proposal-1", "proposal-1", true)).toBe(false);
    expect(shouldDeferLiveProposal("proposal-2", "proposal-1", true)).toBe(true);
    expect(shouldDeferLiveProposal(undefined, "proposal-1", true)).toBe(false);
  });
  it("holds a displayed preview if it disappears or is replaced during editing, until blur or Review", () => {
    const previous = { config: preview.proposed, preview: true, highlightIds: new Set(["tasks"]) };
    const saved = { config, preview: false };
    expect(resolveLivePresentation(previous, saved, true)).toBe(previous);
    expect(resolveLivePresentation(previous, saved, false)).toBe(saved);
    const next = { config: { ...config, densityToken: "density.compact" }, preview: true };
    expect(resolveLivePresentation(previous, next, true)).toBe(previous);
    expect(resolveLivePresentation(previous, next, true, true)).toBe(next);
    expect(resolveLivePresentation(previous, { ...previous, config: structuredClone(previous.config) }, true)).not.toBe(previous);
  });
});

describe("live presentation", () => {
  it("keeps the saved layout and overlays only adaptable panels while working", () => {
    const html = renderToStaticMarkup(createElement(LiveSurface, { ...props, live: { ...live, error: null, proposal: null, job: { ...live.job!, status: "working", changedComponents: [] } }, onAccept: vi.fn(), onKeep: vi.fn() }));
    expect(html).toContain('data-live-state="working"');
    expect(html).toContain("Your agent is preparing a view for Triage work.");
    expect(html).toContain('data-template="guided-overview"');
    expect(html.match(/data-testid="live-skeleton"/g)).toHaveLength(5);
    const alert = html.slice(html.indexOf('data-component="alerts"'), html.indexOf('data-component="revenue"'));
    expect(alert).not.toContain('data-testid="live-skeleton"');
    expect(html).toContain("prefers-reduced-motion:reduce");
  });
  it("previews inline with labels, comparison and explicit actions without invoking persistence", () => {
    const onAccept = vi.fn();
    const onKeep = vi.fn();
    const html = renderToStaticMarkup(createElement(LiveSurface, { ...props, live: { ...live, error: null }, onAccept, onKeep, componentLabels: { tasks: "Your tasks" }, comparisonHref: (proposal) => `/views/${proposal.proposal.id}` }));
    expect(html).toContain('data-live-state="ready"');
    expect(html).toContain('data-template="focus-triage"');
    expect(html).toContain('data-preview="true"');
    expect(html).toContain("Proposed changes to Your tasks");
    expect(html).toContain("Accept</button>");
    expect(html).toContain("Keep current</button>");
    expect(html).toContain('href="/views/proposal-1"');
    expect(html).toContain('class="contour-live-badge"');
    expect(onAccept).not.toHaveBeenCalled();
    expect(onKeep).not.toHaveBeenCalled();
  });
  it("retains hidden mounted panels and has no changing region parents", () => {
    const hidden = { ...config, placements: config.placements.map((placement) => placement.componentId === "help" ? { ...placement, visible: false } : placement) };
    const html = renderToStaticMarkup(createElement(AdaptiveSurface, { ...props, config: hidden }));
    expect(html).toContain('hidden=""');
    expect(html).toContain('data-component="help"');
    expect(html).not.toContain('class="cs-region"');
    expect(html.match(/class="cs-slot"/g)).toHaveLength(6);
  });
  it("places stable direct slots at their responsive region coordinates", () => {
    const css = surfaceCss("surface", manifest.templates[0], "wide", config);
    expect(css).toContain('[data-component="alerts"]{grid-column:1/span 12;grid-row:1;}');
    expect(css).toContain('[data-component="revenue"]{grid-column:1/span 8;grid-row:2;}');
    expect(css).toContain('[data-component="tasks"]{grid-column:9/span 4;grid-row:2;}');
    const narrow = surfaceCss("surface", manifest.templates[0], "narrow", config);
    expect(narrow).toContain('[data-component="tasks"]{grid-column:1/span 1;grid-row:4;}');
  });
  it("stacks measured panels independently and starts the next band below its tallest region", () => {
    const heights = new Map([["alerts", 100], ["revenue", 200], ["metrics", 150], ["tasks", 1000], ["help", 50], ["activity", 200]]);
    const template = manifest.templates[0];
    const wide = measuredGridCells(template, template.breakpoints.find((bp) => bp.id === "wide")!, config, heights, 18);
    expect(wide.get("revenue")).toEqual({ column: 1, span: 8, row: 119, rowSpan: 200 });
    expect(wide.get("metrics")?.row).toBe(337);
    expect(wide.get("tasks")).toEqual({ column: 9, span: 4, row: 119, rowSpan: 1000 });
    expect(wide.get("help")?.row).toBe(1137);
    expect(wide.get("activity")?.row).toBe(1205);
    const narrow = measuredGridCells(template, template.breakpoints[0], config, heights, 18);
    expect(narrow.get("tasks")?.column).toBe(1);
    expect(narrow.get("tasks")?.row).toBe(505);
    expect(narrow.get("activity")?.row).toBe(1591);
  });
});
