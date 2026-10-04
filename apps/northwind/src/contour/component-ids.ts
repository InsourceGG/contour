/** Renderer IDs implemented in components.tsx, importable by server code without client modules. */
export const componentIds: ReadonlySet<string> = new Set([
  "sla-alerts",
  "ticket-queue",
  "csat-trend",
  "workload",
  "knowledge-base",
  "customer-timeline",
]);
