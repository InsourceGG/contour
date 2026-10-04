/** Output shapes of the company's permission-checked readers. Aggregates and
 *  allowlisted fields only; no raw business records beyond what the user can see. */

export type RevenueSummary = {
  period: "7d" | "30d";
  currency: string;
  total: number;
  previousTotal: number;
  changePct: number;
  min: { date: string; net: number };
  max: { date: string; net: number };
  points: { date: string; net: number }[];
  annotations: { date: string; text: string }[];
  observedAt: string;
};

export type MetricsSummary = {
  set: "core" | "extended";
  metrics: {
    id: string;
    label: string;
    definition: string;
    value: number;
    previousValue: number;
    unit: string;
    changePct: number;
  }[];
  observedAt: string;
};

export type TaskList = {
  filter: "all" | "mine" | "overdue";
  tasks: {
    id: string;
    title: string;
    context: string;
    priority: "high" | "medium" | "low";
    dueAt: string;
    status: "open" | "acknowledged" | "done";
    overdue: boolean;
    assignedToMe: boolean;
  }[];
  total: number;
  observedAt: string;
};

export type ActivityFeed = {
  events: { id: string; actor: string; description: string; occurredAt: string }[];
  observedAt: string;
};

export type AlertList = {
  alerts: {
    id: string;
    severity: "critical" | "warning" | "info";
    title: string;
    detail: string;
    raisedAt: string;
    acknowledged: boolean;
  }[];
  observedAt: string;
};

export type ReaderOutputs = {
  "revenue.summary": RevenueSummary;
  "metrics.summary": MetricsSummary;
  "tasks.list": TaskList;
  "activity.recent": ActivityFeed;
  "alerts.active": AlertList;
};

/** Data handed to each rendered component, keyed by componentId. A missing
 *  entry means the reader failed or the user lacks data access. */
export type SurfaceData = {
  revenue?: RevenueSummary;
  metrics?: MetricsSummary;
  tasks?: TaskList;
  activity?: ActivityFeed;
  alerts?: AlertList;
};
