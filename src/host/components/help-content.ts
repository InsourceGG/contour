/** Static, company-written help content per topic. */

export type HelpTopic = "auto" | "performance" | "triage";

type HelpContent = {
  title: string;
  intro: string;
  steps: string[];
  tips: { term: string; text: string }[];
};

export const HELP: Record<HelpTopic, HelpContent> = {
  auto: {
    title: "Using this dashboard",
    intro: "Alerts stay at the top. Everything below can be arranged to suit your work, within company rules.",
    steps: [
      "Scan the alerts first. They are required and always shown.",
      "Check Your tasks and acknowledge anything you are taking on.",
      "Use Net revenue and Key metrics to see how the period is going.",
      "Choose Adapt my view to get a layout suited to your task. Nothing changes until you accept it.",
    ],
    tips: [
      { term: "Pinned", text: "A pinned panel keeps its place and style when a new view is proposed." },
      { term: "Undo", text: "Undo restores your previous view. Reset returns to the company default." },
      { term: "Times", text: "All times are shown in UTC." },
    ],
  },
  performance: {
    title: "Reviewing performance",
    intro: "Start with the trend, then use the metrics to explain it.",
    steps: [
      "Read the revenue total and its change against the previous period.",
      "Look for days that break the pattern; annotated views explain notable ones.",
      "Compare with Key metrics. A revenue dip with steady orders often points to refunds or discounts.",
      "Note anything unexpected as a task so it gets followed up.",
    ],
    tips: [
      { term: "Net revenue", text: "Sales minus refunds and discounts, by the day payment settled." },
      { term: "Period change", text: "This period's total compared with the same-length period before it." },
      { term: "Average line", text: "The mean daily value for the period, to show which days ran high or low." },
    ],
  },
  triage: {
    title: "Triaging your work",
    intro: "Work from the most urgent item down and leave a clear trail for the next person.",
    steps: [
      "Clear critical alerts first. They are listed most severe first.",
      "Acknowledge overdue tasks you are taking on so the team knows they are owned.",
      "Check recent activity for context before you act.",
      "Leave a handoff note for anything you can't finish.",
    ],
    tips: [
      { term: "Acknowledge", text: "Marks a task as owned by you. It doesn't close the task." },
      { term: "Overdue", text: "Past its due time and not yet done." },
      { term: "Priority", text: "Set by the source system. High means it affects customers or revenue today." },
    ],
  },
};
