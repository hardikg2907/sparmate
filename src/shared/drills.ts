import { z } from "zod";
import type { Track } from "./phases";
import { weekStart } from "./week";

export const DRILL_TYPES = ["capacity", "walk", "requirements", "deep_dive", "lld_skeleton"] as const;
export type DrillType = (typeof DRILL_TYPES)[number];

export const DrillTypeSchema = z.enum(DRILL_TYPES);

export interface DrillInfo {
  title: string;
  minutes: number;
  track: Track;
  /** One sentence for the picker: what the drill trains. */
  about: string;
}

export const DRILL_INFO: Record<DrillType, DrillInfo> = {
  capacity: { title: "Capacity math", minutes: 10, track: "hld", about: "Turn the scale facts into numbers, and each number into a design decision." },
  walk: { title: "Walk a request", minutes: 10, track: "hld", about: "Follow one request through every box of your design, in order." },
  requirements: { title: "Requirements sprint", minutes: 10, track: "hld", about: "Say what to ask and what to settle before you draw anything." },
  deep_dive: { title: "Pick a deep dive", minutes: 15, track: "hld", about: "Take one hard part of the design one level deeper than the first answer." },
  lld_skeleton: { title: "LLD skeleton", minutes: 15, track: "lld", about: "Name the classes, their fields and their method signatures, with no bodies." },
};

export function drillsForTrack(track: Track): DrillType[] {
  return DRILL_TYPES.filter((d) => DRILL_INFO[d].track === track);
}

// ---------------------------------------------------------------------------
// Gap to drill

interface Rule {
  drill: DrillType;
  pattern: RegExp;
}

const HLD_RULES: Rule[] = [
  { drill: "capacity", pattern: /capacity|back[- ]of[- ]the[- ]envelope|estimat|\bqps\b|throughput|sizing|storage (math|numbers)|scale (math|numbers)|numbers?\b.*\bdecision/ },
  { drill: "deep_dive", pattern: /deep[- ]dive/ },
  { drill: "requirements", pattern: /requirement|clarif|scoping|\bscope\b|non-functional|assumption|constraint|ask(ing)? (the )?(right )?questions/ },
  { drill: "walk", pattern: /walk(ed|ing|s)? (a |one |the |every )?(request|flow)|request (path|flow)|end[- ]to[- ]end|data flow|\b(read|write|miss) path\b|trace (a|the|one) / },
  {
    drill: "deep_dive",
    pattern:
      /trade-?off|cach|consisten|shard|partition|replica|failure|failover|stampede|hot (key|shard|spot)|idempoten|queue|rate limit|bottleneck|durab|availab|latency|ordering|fan-?out|backpressure|retry|\bttls?\b|click|\bcount|batch|analytics/,
  },
];

const LLD_RULE: Rule = {
  drill: "lld_skeleton",
  pattern: /entit|class|interface|skeleton|model(l)?ing|object|relationship|data shape|abstraction|pattern|strategy|extensib|responsib|encapsulat|\bapi\b|noun/,
};

/** Gaps about how the round was run, not about what was designed. No drill trains them. */
const ABOUT_THE_ROUND = /pacing|leading the round|time[- ]?(management|box)|drive the (round|interview)|communicat|running out of time|phase (timing|pacing)/;

/**
 * Picks a drill for a scorecard gap. The judge's own choice wins when it fits the track. Otherwise the gap's title is
 * matched first, then its title with the reason it matters. A gap about pacing or communication gets none, and so does
 * a gap no rule fits: null queues nothing.
 */
export function drillForGap(gap: { title: string; whyItMatters?: string; drill?: DrillType | undefined }, track: Track): DrillType | null {
  if (gap.drill && DRILL_INFO[gap.drill].track === track) return gap.drill;
  const title = gap.title.toLowerCase();
  if (ABOUT_THE_ROUND.test(title)) return null;
  const rules = track === "lld" ? [LLD_RULE] : HLD_RULES;
  const full = `${title} ${(gap.whyItMatters ?? "").toLowerCase()}`;
  for (const text of [title, full]) {
    const hit = rules.find((r) => r.pattern.test(text));
    if (hit) return hit.drill;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Local calendar days. The schedule works in whole days in the user's own time zone.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const DaySchema = z.string().regex(DAY);

/** "2026-11-08" for the local calendar day of `date`. */
export function localDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function parseLocalDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Calendar arithmetic through the local date parts, so a daylight-saving shift never moves the result by a day. */
export function addDays(day: string, days: number): string {
  const date = parseLocalDay(day);
  date.setDate(date.getDate() + days);
  return localDay(date);
}

// ---------------------------------------------------------------------------
// Schedule

export const PASSES_TO_CLOSE = 3;
/** Days until the next drill after the first and the second pass in a row. */
export const PASS_INTERVAL_DAYS = [3, 7] as const;

export type DrillStatus = "open" | "closed";
export type DrillVerdict = "pass" | "not_yet";

export interface DrillItem {
  id: string;
  sessionId: string;
  problemId: string;
  gapTitle: string;
  /** What the judge said good looks like; it helps pick the deep dive that matches the gap. */
  gapHint: string;
  drill: DrillType;
  /** The day after the debrief. */
  createdOn: string;
  dueOn: string;
  passes: number;
  status: DrillStatus;
}

/** The first drill falls due the day after the debrief. */
export function firstDueDay(debriefDay: string): string {
  return addDays(debriefDay, 1);
}

/**
 * What one attempt on a queued drill does. A pass moves the next drill out (3 days, then 7) and the third pass in a
 * row closes it. A "not yet" starts the count again and brings the drill back tomorrow.
 */
export function applyVerdict(item: Pick<DrillItem, "passes">, verdict: DrillVerdict, today: string): { passes: number; dueOn: string; status: DrillStatus } {
  if (verdict === "not_yet") return { passes: 0, dueOn: addDays(today, 1), status: "open" };
  const passes = Math.min(PASSES_TO_CLOSE, item.passes + 1);
  if (passes >= PASSES_TO_CLOSE) return { passes, dueOn: today, status: "closed" };
  return { passes, dueOn: addDays(today, PASS_INTERVAL_DAYS[passes - 1] ?? 7), status: "open" };
}

/** How a due day reads: "Due today", "Overdue" (with the day it fell due), "Tomorrow", or the day itself. */
export function dueStatus(dueOn: string, today: string): { label: string; since?: string; tone: "due" | "overdue" | "later" } {
  if (dueOn === today) return { label: "Due today", tone: "due" };
  if (dueOn < today) return { label: "Overdue", since: dueOn, tone: "overdue" };
  if (dueOn === addDays(today, 1)) return { label: "Tomorrow", tone: "later" };
  return { label: dueOn, tone: "later" };
}

export function isDue(item: Pick<DrillItem, "dueOn" | "status">, today: string): boolean {
  return item.status === "open" && item.dueOn <= today;
}

/** Due drills first, oldest due day first, then the ones still ahead in date order. */
export function byDueDay<T extends Pick<DrillItem, "dueOn" | "id">>(a: T, b: T): number {
  return a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id);
}

export interface DrillAttempt {
  at: string;
  day: string;
  drill: DrillType;
  problemId: string;
  drillId: string | null;
  verdict: DrillVerdict;
}

/** Passed and attempted drills in the local week that holds `now`. Free drills count too. */
export function weekDrillStats(attempts: readonly Pick<DrillAttempt, "day" | "verdict">[], now: Date): { passed: number; attempted: number } {
  const first = localDay(weekStart(now));
  const next = addDays(first, 7);
  const mine = attempts.filter((a) => a.day >= first && a.day < next);
  return { passed: mine.filter((a) => a.verdict === "pass").length, attempted: mine.length };
}

// ---------------------------------------------------------------------------
// What the browser and the server say to each other

export const PROBLEM_ID = /^[a-z0-9][a-z0-9-]{1,80}$/;
export const DRILL_ID = /^[a-f0-9]{16}$/;
export const MAX_ANSWER_CHARS = 8000;

/** Names one drill to run. `drillId` is set when it comes from the queue. */
export const DrillTargetSchema = z.strictObject({
  drill: DrillTypeSchema,
  problemId: z.string().regex(PROBLEM_ID),
  drillId: z.string().regex(DRILL_ID).optional(),
});
export type DrillTarget = z.infer<typeof DrillTargetSchema>;

export const DrillSubmitSchema = z.strictObject({
  ...DrillTargetSchema.shape,
  answer: z
    .string()
    .max(MAX_ANSWER_CHARS)
    .refine((text) => text.trim().length > 0, "Write an answer first."),
});
export type DrillSubmit = z.infer<typeof DrillSubmitSchema>;

export interface GymDrillRow {
  id: string;
  /** The scorecard gap this drill trains. */
  gapTitle: string;
  /** The deep-dive topic, for a deep dive. */
  topic: string | null;
  drill: DrillType;
  title: string;
  problemId: string;
  problemTitle: string;
  minutes: number;
  dueOn: string;
  due: boolean;
  passes: number;
  /** The one-line task, ready for the hero. */
  task: string;
}

export interface GymSummary {
  today: string;
  /** Open drills, due ones first. */
  queue: GymDrillRow[];
  dueCount: number;
  /** Problems a drill may use: played ones and custom ones. */
  problems: { id: string; title: string; track: Track; /** The drills this problem can supply. */ drills: DrillType[] }[];
  week: { passed: number; attempted: number };
}

export interface DrillPrompt {
  drill: DrillType;
  title: string;
  minutes: number;
  task: string;
  /** The deep-dive topic, for a deep dive. */
  topic?: string;
  problem: { id: string; title: string; track: Track };
  material: { heading: string; markdown: string }[];
  /** Short line under the answer box. */
  answerHint: string;
}

export interface DrillResult {
  verdict: DrillVerdict;
  fix: string;
  yourLine: string;
  passSounds: string;
  /** Null for a free drill that matched no queued one. */
  passesInRow: number | null;
  closed: boolean;
  nextDueOn: string | null;
  /** The next due drill other than this one, if any. */
  next: DrillTarget | null;
}
