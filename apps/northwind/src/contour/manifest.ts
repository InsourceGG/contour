import type { LayoutTemplate, SurfaceManifest, TemplateBreakpoint } from "@contour/sdk/core";

/**
 * The approved adaptive region of /desk (checkpoint 1). Serializable metadata
 * only: renderers live in components.tsx and readers in readers.ts.
 * Navigation, account, admin, the page heading, and notices stay outside.
 */

const regions = [
  { id: "fixed", label: "Alerts" },
  { id: "main", label: "Work queue" },
  { id: "rail", label: "Service insights" },
] as const;

const regionOrder = ["fixed", "main", "rail"] as const;
const regionCapacity = { fixed: 1, main: 5, rail: 4 };

/** Below 60rem the host desk stacks in one column, in DOM order. */
function stacked(id: "narrow" | "medium", minWidth: number): TemplateBreakpoint {
  return { id, minWidth, columns: 1, regionOrder, regionSpan: { fixed: 1, main: 1, rail: 1 }, regionCapacity };
}

function template(id: string, label: string, description: string, columns: number, mainSpan: number): LayoutTemplate {
  return {
    id,
    label,
    description,
    regions,
    breakpoints: [
      stacked("narrow", 0),
      stacked("medium", 768),
      { id: "wide", minWidth: 960, columns, regionOrder, regionSpan: { fixed: columns, main: mainSpan, rail: columns - mainSpan }, regionCapacity },
    ],
  };
}

export const manifest: SurfaceManifest = {
  schemaVersion: "1",
  appId: "northwind",
  surfaceId: "desk",
  label: "Support desk",
  description: "Northwind's support desk: SLA alerts, the team ticket queue, satisfaction, workload, knowledge articles, and customer activity.",
  manifestVersion: "1",
  policyVersion: "1",
  components: [
    {
      id: "sla-alerts",
      semanticRole: "sla_alerts",
      description: "Overdue response commitments for the user's authorized teams. Locked by company policy.",
      variants: ["banner", "expanded"],
      variantDescriptions: {
        banner: "Up to three overdue tickets with a count of the rest.",
        expanded: "Every overdue ticket.",
      },
      settingsSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
      defaultSettings: {},
      readerId: "sla.active",
      requiredScope: "data:read",
      locked: true,
      required: true,
      allowedRegions: ["fixed"],
    },
    {
      id: "ticket-queue",
      semanticRole: "ticket_queue",
      description: "Visible team tickets with Assign to me and Reply actions.",
      variants: ["list", "cards"],
      variantDescriptions: {
        list: "Rows using the host's existing queue.",
        cards: "Cards using the host's existing queue.",
      },
      settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: { filter: { enum: ["all", "open", "pending", "resolved", "mine"], description: "Initial queue filter." } },
        required: ["filter"],
      },
      defaultSettings: { filter: "all" },
      readerId: "tickets.list",
      requiredScope: "data:read",
      locked: false,
      required: true,
      allowedRegions: ["main"],
    },
    {
      id: "csat-trend",
      semanticRole: "satisfaction_trend",
      description: "Response-weighted daily customer satisfaction for the user's authorized teams.",
      variants: ["chart", "summary"],
      variantDescriptions: {
        chart: "Line chart with a daily score table.",
        summary: "Highest score, days at target, and the team target.",
      },
      settingsSchema: {
        type: "object",
        additionalProperties: false,
        properties: { range: { enum: ["7d", "30d"], description: "Reporting period." } },
        required: ["range"],
      },
      defaultSettings: { range: "7d" },
      readerId: "csat.trend",
      requiredScope: "data:read",
      locked: false,
      required: false,
      allowedRegions: ["main", "rail"],
    },
    {
      id: "workload",
      semanticRole: "team_workload",
      description: "Open and pending tickets per teammate against capacity.",
      variants: ["comfortable", "compact"],
      variantDescriptions: {
        comfortable: "Names with team labels.",
        compact: "Names only.",
      },
      settingsSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
      defaultSettings: {},
      readerId: "workload.team",
      requiredScope: "data:read",
      locked: false,
      required: false,
      allowedRegions: ["main", "rail"],
    },
    {
      id: "knowledge-base",
      semanticRole: "knowledge_base",
      description: "Team reference articles. Serves as the help panel.",
      variants: ["guided", "collapsed"],
      variantDescriptions: {
        guided: "Article summaries with the first article open.",
        collapsed: "Titles only.",
      },
      settingsSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
      defaultSettings: {},
      readerId: "kb.articles",
      requiredScope: "data:read",
      locked: false,
      required: false,
      allowedRegions: ["main", "rail"],
    },
    {
      id: "customer-timeline",
      semanticRole: "customer_timeline",
      description: "Recent customer conversations and ticket updates.",
      variants: ["comfortable", "compact"],
      variantDescriptions: {
        comfortable: "Each update shown in full.",
        compact: "Updates collapsed behind View update.",
      },
      settingsSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
      defaultSettings: {},
      readerId: "customers.timeline",
      requiredScope: "data:read",
      locked: false,
      required: false,
      allowedRegions: ["main", "rail"],
    },
  ],
  tokenIds: ["density.comfortable", "density.compact"],
  templates: [
    template("standard", "Standard", "The current desk: a wide work column with service insights alongside.", 3, 2),
    template("focus-triage", "Focus on triage", "A wider work column for working through the queue.", 4, 3),
    template("focus-quality", "Focus on quality", "Equal columns so service insights sit beside the queue.", 2, 1),
  ],
  dependencies: [],
  tasks: [
    { id: "triage_queue", label: "Triage the queue", description: "Work through open tickets, assign owners, and reply to customers." },
    { id: "review_quality", label: "Review service quality", description: "Check satisfaction, workload, and recent customer activity." },
  ],
  expertiseLevels: [
    { id: "new", label: "New to the desk", description: "Prefers guidance and fuller explanations." },
    { id: "experienced", label: "Experienced", description: "Prefers dense, scannable panels." },
  ],
  defaultConfig: {
    schemaVersion: "1",
    manifestVersion: "1",
    templateId: "standard",
    densityToken: "density.comfortable",
    placements: [
      { componentId: "sla-alerts", regionId: "fixed", order: 0, variantId: "banner", visible: true, settings: {} },
      { componentId: "ticket-queue", regionId: "main", order: 0, variantId: "list", visible: true, settings: { filter: "all" } },
      { componentId: "csat-trend", regionId: "rail", order: 0, variantId: "chart", visible: true, settings: { range: "7d" } },
      { componentId: "workload", regionId: "rail", order: 1, variantId: "comfortable", visible: true, settings: {} },
      { componentId: "knowledge-base", regionId: "main", order: 1, variantId: "guided", visible: true, settings: {} },
      { componentId: "customer-timeline", regionId: "main", order: 2, variantId: "comfortable", visible: true, settings: {} },
    ],
  },
  limits: { maxPlacements: 6, maxNoteLength: 280, proposalTtlSeconds: 900, historyLimit: 20 },
};

/** Human labels for failure fallbacks and previews. */
export const componentLabels: Readonly<Record<string, string>> = {
  "sla-alerts": "SLA alerts",
  "ticket-queue": "Ticket queue",
  "csat-trend": "Customer satisfaction",
  workload: "Team workload",
  "knowledge-base": "Knowledge base",
  "customer-timeline": "Customer timeline",
};
