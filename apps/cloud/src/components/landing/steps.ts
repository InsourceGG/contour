export type Layout = "base" | "guided" | "dense";
export type Bar = "ask" | "cursor" | "saved";

export type Step = {
  layout: Layout;
  chapter: number;
  duration: number;
  caption: string;
  locks?: boolean;
  outline?: boolean;
  deck?: boolean;
  prompt?: "a" | "b";
  typing?: boolean;
  status?: string;
  thinking?: boolean;
  proposed?: boolean;
  bar?: Bar;
  console?: boolean;
  kill?: boolean;
};

export const PROMPTS = {
  a: "I'm new here, triaging tickets.",
  b: "Expert. Reviewing performance, keep it dense.",
} as const;

export const CHAPTERS = [
  { title: "One interface" },
  { title: "The company's rules" },
  { title: "Someone new to the work" },
  { title: "An expert" },
  { title: "The company's view" },
] as const;

export const STEPS: Step[] = [
  { layout: "base", chapter: 0, duration: 2800, caption: "A support dashboard, exactly as the company built it." },
  { layout: "base", chapter: 1, duration: 3600, locks: true, outline: true, deck: true, caption: "Alerts, the required action and navigation are locked. The outlined area can adapt, using approved variants." },
  { layout: "base", chapter: 2, duration: 2300, locks: true, outline: true, prompt: "a", typing: true, caption: "A new teammate tells their own agent how they work." },
  { layout: "base", chapter: 2, duration: 1600, locks: true, outline: true, prompt: "a", status: "Reading what this app allows", thinking: true, caption: "The agent reads the rules. Skeletons hold the space while it works." },
  { layout: "guided", chapter: 2, duration: 2300, locks: true, prompt: "a", status: "Proposed a guided view", proposed: true, bar: "ask", caption: "It proposes a guided view from approved pieces. Every change is marked." },
  { layout: "guided", chapter: 2, duration: 1200, locks: true, prompt: "a", status: "Proposed a guided view", proposed: true, bar: "cursor", caption: "Nothing is saved until the person decides." },
  { layout: "guided", chapter: 2, duration: 1900, locks: true, prompt: "a", status: "Saved by you", bar: "saved", caption: "Accepted. The locked blocks never moved." },
  { layout: "guided", chapter: 3, duration: 2500, locks: true, prompt: "b", typing: true, caption: "Someone else asks for the opposite." },
  { layout: "guided", chapter: 3, duration: 1500, locks: true, prompt: "b", status: "Reading what this app allows", thinking: true, caption: "Same rules. Same approved pieces." },
  { layout: "dense", chapter: 3, duration: 2300, locks: true, prompt: "b", status: "Proposed a compact view", proposed: true, bar: "ask", caption: "A compact, data-dense view. The alerts stay locked in place." },
  { layout: "dense", chapter: 3, duration: 1200, locks: true, prompt: "b", status: "Proposed a compact view", proposed: true, bar: "cursor", caption: "Again, only the person can save it." },
  { layout: "dense", chapter: 3, duration: 1900, locks: true, prompt: "b", status: "Saved by you", bar: "saved", caption: "Saved by them. Undo is always one click away." },
  { layout: "dense", chapter: 4, duration: 2300, console: true, caption: "The company sees every proposal, acceptance and undo." },
  { layout: "dense", chapter: 4, duration: 2600, console: true, kill: true, caption: "And can turn off agent access at any time." },
];

export const CHAPTER_START = CHAPTERS.map((_, c) => STEPS.findIndex((s) => s.chapter === c));

export const SEQUENCE_DESCRIPTION = [
  "A support dashboard with an alerts strip, a ticket queue, a chart, a metrics row, a help panel and an activity list.",
  "The company locks the alerts, the required action and navigation, and marks the rest as adaptable, with approved variants for each block.",
  "A new teammate tells their agent: I'm new here, triaging tickets. The adaptable blocks turn into loading skeletons, then rearrange into a guided layout with a large annotated queue and an expanded help panel. Changed blocks are marked. The locked blocks do not move.",
  "The person clicks Accept and a confirmation reads: Saved by you. Undo anytime.",
  "An expert tells their agent: Expert. Reviewing performance, keep it dense. The same blocks re-form into a compact, data-dense layout. The alerts stay locked in place, and the person accepts.",
  "The company's console shows proposals, acceptance and undo rates, cost and a decision log, with a switch that turns off agent access.",
];
