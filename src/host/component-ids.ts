/** Component IDs that have a registered React renderer in src/host/components.
 *  Kept free of React imports so server registration can check it cheaply. */
export const COMPONENT_IDS: ReadonlySet<string> = new Set(["alerts", "tasks", "revenue", "metrics", "activity", "help"]);
