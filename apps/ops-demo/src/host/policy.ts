import type { CandidatePolicy } from "@contour/sdk/core";

/**
 * Company-authored candidate policy for the overview surface. These are the
 * only arrangements and explanation levels the JEV selector may choose from.
 */
export const overviewPolicy: CandidatePolicy = {
  taskLayouts: {
    review_performance: {
      templateId: "focus-performance",
      placements: {
        revenue: { regionId: "main", order: 0 },
        metrics: { regionId: "main", order: 1 },
        tasks: { regionId: "rail", order: 0 },
        help: { regionId: "rail", order: 1 },
        activity: { regionId: "secondary", order: 0 },
      },
      settings: { revenue: { period: "30d" }, tasks: { filter: "all" } },
      helpTopic: "performance",
    },
    triage_work: {
      templateId: "focus-triage",
      placements: {
        tasks: { regionId: "main", order: 0 },
        activity: { regionId: "main", order: 1 },
        metrics: { regionId: "rail", order: 0 },
        help: { regionId: "rail", order: 1 },
        revenue: { regionId: "secondary", order: 0 },
      },
      settings: { revenue: { period: "7d" }, tasks: { filter: "overdue" } },
      helpTopic: "triage",
    },
  },
  levels: {
    guided: {
      label: "Guided",
      summary: "Best fit for beginners or anyone who wants explanations: annotated charts, metric definitions, detailed task rows and step-by-step help.",
      defaultDensity: "comfortable",
      variants: { revenue: "annotated", metrics: "annotated", tasks: "detailed", activity: "feed" },
      settings: { revenue: { showLegend: true }, metrics: { set: "core" }, tasks: { limit: 5 }, activity: { limit: 5 } },
      helpVariant: "guide",
    },
    balanced: {
      label: "Balanced",
      summary: "Best fit for users with some familiarity: task-focused arrangement with moderate detail and short tips.",
      defaultDensity: "comfortable",
      variants: { revenue: "summary", metrics: "cards", tasks: "list", activity: "feed" },
      settings: { revenue: { showLegend: true }, metrics: { set: "core" }, tasks: { limit: 5 }, activity: { limit: 10 } },
      helpVariant: "tips",
    },
    dense: {
      label: "Dense",
      summary: "Best fit for experts: compact, information-rich task view with daily values and extended metrics; help collapsed unless requested.",
      defaultDensity: "compact",
      variants: { revenue: "dense", metrics: "strip", tasks: "compact", activity: "compact" },
      settings: { revenue: { showLegend: false }, metrics: { set: "extended" }, tasks: { limit: 10 }, activity: { limit: 20 } },
      helpVariant: "collapsed",
    },
  },
  helpComponentId: "help",
  helpShowVariant: "tips",
  densityTokens: { comfortable: "density.comfortable", compact: "density.compact" },
};
