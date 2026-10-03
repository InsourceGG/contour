/** Test fixture: copy of the ops-demo overview manifest (apps/ops-demo/src/host/manifest.ts). */
import type { LayoutTemplate, SurfaceManifest } from "../../src/core/types";

/**
 * Company-authored, versioned manifest for the "overview" surface of the
 * ops-demo app. This file lives in the company's reviewed repository and is
 * deployed with the app. Agents can read a description of it; they can never
 * supply or modify it.
 */

const standardBreakpoints = (
  wide: { main: number; rail: number },
  medium: { main: number; rail: number },
  caps: { main: number; rail: number; secondary: number },
): LayoutTemplate["breakpoints"] => [
  {
    id: "narrow",
    minWidth: 0,
    columns: 1,
    regionOrder: ["fixed", "main", "rail", "secondary"],
    regionSpan: { fixed: 1, main: 1, rail: 1, secondary: 1 },
    regionCapacity: { fixed: 1, ...caps },
  },
  {
    id: "medium",
    minWidth: 768,
    columns: 8,
    regionOrder: ["fixed", "main", "rail", "secondary"],
    regionSpan: { fixed: 8, main: medium.main, rail: medium.rail, secondary: 8 },
    regionCapacity: { fixed: 1, ...caps },
  },
  {
    id: "wide",
    minWidth: 1200,
    columns: 12,
    regionOrder: ["fixed", "main", "rail", "secondary"],
    regionSpan: { fixed: 12, main: wide.main, rail: wide.rail, secondary: 12 },
    regionCapacity: { fixed: 1, ...caps },
  },
];

const regions = [
  { id: "fixed", label: "Pinned status" },
  { id: "main", label: "Primary workspace" },
  { id: "rail", label: "Side rail" },
  { id: "secondary", label: "Supporting detail" },
] as const;

export const overviewManifest: SurfaceManifest = {
  schemaVersion: "1",
  appId: "ops-demo",
  surfaceId: "overview",
  label: "Operations overview",
  description:
    "The daily operations dashboard: revenue, key metrics, the assigned task queue, recent activity, contextual help and required alerts.",
  manifestVersion: "1.0.0",
  policyVersion: "1",
  components: [
    {
      id: "alerts",
      semanticRole: "alerts_panel",
      description: "Active operational alerts. Required and locked by company policy; always visible at the top.",
      variants: ["standard"],
      variantDescriptions: { standard: "Severity-ordered list of active alerts with acknowledgement status." },
      settingsSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
      defaultSettings: {},
      readerId: "alerts.active",
      requiredScope: "data:read",
      locked: true,
      required: true,
      allowedRegions: ["fixed"],
    },
    {
      id: "tasks",
      semanticRole: "task_queue",
      description:
        "Tasks assigned to the signed-in user, including the required Acknowledge action. Required: may move or change density, never hidden.",
      variants: ["list", "detailed", "compact"],
      variantDescriptions: {
        list: "Readable list with priority, due date and one primary action.",
        detailed: "Expanded rows with context, owner and step-by-step guidance.",
        compact: "Dense single-line rows for fast triage.",
      },
      settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          filter: { enum: ["all", "mine", "overdue"], description: "Which tasks to show first" },
          limit: { enum: [5, 10], description: "Maximum rows" },
        },
        required: ["filter", "limit"],
      },
      defaultSettings: { filter: "all", limit: 5 },
      readerId: "tasks.list",
      requiredScope: "data:read",
      locked: false,
      required: true,
      allowedRegions: ["main", "rail", "secondary"],
    },
    {
      id: "revenue",
      semanticRole: "revenue_trend",
      description: "Net revenue by day in account currency.",
      variants: ["summary", "annotated", "dense"],
      variantDescriptions: {
        summary: "Headline total with a clean trend line.",
        annotated: "Trend line with plain-language annotations explaining notable changes.",
        dense: "Trend with daily values, min/max and period-over-period delta.",
      },
      settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          period: { enum: ["7d", "30d"], description: "Time window" },
          showLegend: { type: "boolean", description: "Show the chart legend" },
        },
        required: ["period", "showLegend"],
      },
      defaultSettings: { period: "30d", showLegend: true },
      readerId: "revenue.summary",
      requiredScope: "data:read",
      locked: false,
      required: false,
      allowedRegions: ["main", "secondary"],
    },
    {
      id: "metrics",
      semanticRole: "key_metrics",
      description: "Key operating metrics with definitions and period change.",
      variants: ["cards", "annotated", "strip"],
      variantDescriptions: {
        cards: "Large metric cards with change indicators.",
        annotated: "Metric cards with a one-line definition of each metric.",
        strip: "A compact single-row strip of values.",
      },
      settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: { set: { enum: ["core", "extended"], description: "Which metrics to show" } },
        required: ["set"],
      },
      defaultSettings: { set: "core" },
      readerId: "metrics.summary",
      requiredScope: "data:read",
      locked: false,
      required: false,
      allowedRegions: ["main", "rail", "secondary"],
    },
    {
      id: "activity",
      semanticRole: "recent_activity",
      description: "Recent workspace activity from teammates and systems.",
      variants: ["feed", "timeline", "compact"],
      variantDescriptions: {
        feed: "Readable activity feed with actors and descriptions.",
        timeline: "Chronological timeline grouped by hour.",
        compact: "One line per event.",
      },
      settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: { limit: { enum: [5, 10, 20], description: "Maximum events" } },
        required: ["limit"],
      },
      defaultSettings: { limit: 10 },
      readerId: "activity.recent",
      requiredScope: "data:read",
      locked: false,
      required: false,
      allowedRegions: ["main", "rail", "secondary"],
    },
    {
      id: "help",
      semanticRole: "help_panel",
      description: "Contextual help explaining the dashboard and the current task.",
      variants: ["guide", "tips", "collapsed"],
      variantDescriptions: {
        guide: "Step-by-step guide for the current task.",
        tips: "Short tips and definitions.",
        collapsed: "A single expandable help link.",
      },
      settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: { topic: { enum: ["auto", "performance", "triage"], description: "Help topic" } },
        required: ["topic"],
      },
      defaultSettings: { topic: "auto" },
      locked: false,
      required: false,
      allowedRegions: ["rail", "secondary"],
    },
  ],
  tokenIds: ["density.comfortable", "density.compact"],
  templates: [
    {
      id: "guided-overview",
      label: "Guided overview",
      description: "Balanced default: primary workspace with a side rail for tasks and help.",
      regions,
      breakpoints: standardBreakpoints({ main: 8, rail: 4 }, { main: 5, rail: 3 }, { main: 3, rail: 3, secondary: 3 }),
    },
    {
      id: "focus-performance",
      label: "Performance focus",
      description: "Wide primary area for revenue and metrics; narrow rail.",
      regions,
      breakpoints: standardBreakpoints({ main: 9, rail: 3 }, { main: 5, rail: 3 }, { main: 3, rail: 2, secondary: 3 }),
    },
    {
      id: "focus-triage",
      label: "Triage focus",
      description: "Task queue first with a broad rail for supporting context.",
      regions,
      breakpoints: standardBreakpoints({ main: 7, rail: 5 }, { main: 4, rail: 4 }, { main: 2, rail: 3, secondary: 3 }),
    },
  ],
  dependencies: [
    {
      componentId: "revenue",
      whenVariants: ["annotated"],
      requiresVisible: "metrics",
      reason: "Revenue annotations reference metric definitions shown in Key metrics.",
    },
  ],
  tasks: [
    {
      id: "review_performance",
      label: "Review performance",
      description: "Understand how revenue and key metrics are trending.",
    },
    {
      id: "triage_work",
      label: "Triage work",
      description: "Work through assigned tasks and active alerts.",
    },
  ],
  expertiseLevels: [
    { id: "beginner", label: "Beginner", description: "New to this dashboard or domain; benefits from explanations." },
    { id: "expert", label: "Expert", description: "Familiar with the domain; prefers direct, information-rich views." },
  ],
  defaultConfig: {
    schemaVersion: "1",
    manifestVersion: "1.0.0",
    templateId: "guided-overview",
    densityToken: "density.comfortable",
    placements: [
      { componentId: "alerts", regionId: "fixed", order: 0, variantId: "standard", visible: true, settings: {} },
      { componentId: "revenue", regionId: "main", order: 0, variantId: "summary", visible: true, settings: { period: "30d", showLegend: true } },
      { componentId: "metrics", regionId: "main", order: 1, variantId: "cards", visible: true, settings: { set: "core" } },
      { componentId: "tasks", regionId: "rail", order: 0, variantId: "list", visible: true, settings: { filter: "all", limit: 5 } },
      { componentId: "help", regionId: "rail", order: 1, variantId: "tips", visible: true, settings: { topic: "auto" } },
      { componentId: "activity", regionId: "secondary", order: 0, variantId: "feed", visible: true, settings: { limit: 10 } },
    ],
  },
  limits: { maxPlacements: 12, maxNoteLength: 280, proposalTtlSeconds: 86400, historyLimit: 20 },
};
