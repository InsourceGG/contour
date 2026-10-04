import type { CandidatePolicy } from "@contour/sdk/core";

/**
 * Candidate layouts approved at checkpoint 1. Tasks choose the arrangement,
 * levels choose explanatory variants, and density follows the user's stated
 * preference. Locked SLA alerts always keep their default placement.
 */
export const policy: CandidatePolicy = {
  taskLayouts: {
    triage_queue: {
      templateId: "focus-triage",
      placements: {
        "ticket-queue": { regionId: "main", order: 0 },
        "customer-timeline": { regionId: "main", order: 1 },
        "knowledge-base": { regionId: "main", order: 2 },
        workload: { regionId: "rail", order: 0 },
        "csat-trend": { regionId: "rail", order: 1 },
      },
      settings: { "ticket-queue": { filter: "open" } },
    },
    review_quality: {
      templateId: "focus-quality",
      placements: {
        "csat-trend": { regionId: "main", order: 0 },
        "ticket-queue": { regionId: "main", order: 1 },
        workload: { regionId: "rail", order: 0 },
        "customer-timeline": { regionId: "rail", order: 1 },
        "knowledge-base": { regionId: "rail", order: 2 },
      },
    },
  },
  levels: {
    guided: {
      label: "Guided",
      summary: "Fuller explanations: guided articles, the satisfaction chart, and every update in full.",
      defaultDensity: "comfortable",
      variants: { "ticket-queue": "list", "csat-trend": "chart", workload: "comfortable", "customer-timeline": "comfortable" },
      helpVariant: "guided",
    },
    balanced: {
      label: "Balanced",
      summary: "Article titles only and collapsed timeline updates, with the satisfaction chart.",
      defaultDensity: "comfortable",
      variants: { "ticket-queue": "list", "csat-trend": "chart", workload: "comfortable", "customer-timeline": "compact" },
      helpVariant: "collapsed",
    },
    dense: {
      label: "Dense",
      summary: "Compact spacing, a satisfaction summary instead of the chart, and collapsed detail everywhere.",
      defaultDensity: "compact",
      variants: { "ticket-queue": "list", "csat-trend": "summary", workload: "compact", "customer-timeline": "compact" },
      helpVariant: "collapsed",
    },
  },
  helpComponentId: "knowledge-base",
  helpShowVariant: "guided",
  densityTokens: { comfortable: "density.comfortable", compact: "density.compact" },
};
