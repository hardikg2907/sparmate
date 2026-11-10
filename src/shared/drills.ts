import { z } from "zod";
import type { Track } from "./phases";
import { weekStart } from "./week";

export const DRILL_TYPES = ["capacity", "walk", "requirements", "deep_dive", "tradeoff", "lld_skeleton"] as const;
export type DrillType = (typeof DRILL_TYPES)[number];

export const DrillTypeSchema = z.enum(DRILL_TYPES);

export interface DrillInfo {
  title: string;
  minutes: number;
  /** The tracks whose problems can supply the drill. */
  tracks: Track[];
  /** One sentence for the picker: what the drill trains. */
  about: string;
  /** True when the grader asks follow-up questions before the result. */
  dialogue?: boolean;
}

export const DRILL_INFO: Record<DrillType, DrillInfo> = {
  capacity: { title: "Capacity math", minutes: 10, tracks: ["hld"], about: "Turn the scale facts into numbers, and each number into a design decision." },
  walk: { title: "Walk a request", minutes: 10, tracks: ["hld"], about: "Follow one request through every box of your design, in order." },
  requirements: { title: "Requirements sprint", minutes: 10, tracks: ["hld"], about: "Say what to ask and what to settle before you draw anything." },
  deep_dive: { title: "Pick a deep dive", minutes: 15, tracks: ["hld"], about: "Take one hard part of the design one level deeper than the first answer.", dialogue: true },
  tradeoff: {
    title: "Defend a trade-off",
    minutes: 15,
    tracks: ["hld", "lld"],
    about: "Choose a side of one design choice, or name the patterns to use and leave out, and defend your reasons under questions.",
    dialogue: true,
  },
  lld_skeleton: { title: "LLD skeleton", minutes: 15, tracks: ["lld"], about: "Name the classes, their fields and their method signatures, with no bodies." },
};

/** The kinds that run as a dialogue (`DRILL_INFO[kind].dialogue`), and the kinds that are one written answer. */
export type DialogueDrill = "deep_dive" | "tradeoff";
export type WrittenDrill = Exclude<DrillType, DialogueDrill>;

export function drillsForTrack(track: Track): DrillType[] {
  return DRILL_TYPES.filter((d) => DRILL_INFO[d].tracks.includes(track));
}

export function drillServesTrack(drill: DrillType, track: Track): boolean {
  return DRILL_INFO[drill].tracks.includes(track);
}

/** Follow-up questions the grader may ask in one dialogue attempt. */
export const MAX_FOLLOW_UPS = 2;

/** What the server says when a dialogue moved on, so the page knows to load the conversation again. */
export const CONVERSATION_MOVED = "This conversation moved on. Reload to continue.";
export const DRILL_IN_PROGRESS = "This drill already has an answer in progress.";

// ---------------------------------------------------------------------------
// Gap to drill

interface Rule {
  drill: DrillType;
  pattern: RegExp;
  /** A rule that reads the title alone: the reason a gap matters often names a topic it only touches on. */
  titleOnly?: true;
}

const HLD_RULES: Rule[] = [
  { drill: "capacity", pattern: /capacity|back[- ]of[- ]the[- ]envelope|estimat|\bqps\b|throughput|sizing|storage (math|numbers)|scale (math|numbers)/ },
  {
    // "Numbers that decide nothing": the title only, because a reason often says what some number must decide.
    drill: "capacity",
    pattern: /\bnumbers?\b[^.]{0,60}\b(decid(e|es|ed|ing)|decisions?|drove|driven|driv(e|es|ing)|shap(e|es|ed|ing))\b/,
    titleOnly: true,
  },
  { drill: "deep_dive", pattern: /deep[- ]dive/ },
  { drill: "requirements", pattern: /requirement|clarif|scoping|\bscope\b|non-functional|assumption|constraint|ask(ing)? (the )?(right )?questions/ },
  {
    drill: "walk",
    pattern:
      /walk(ed|ing|s)? (a |one |the |every )?(request|flow)|request (path|flow)|end[- ]to[- ]end|data flow|\b(read|write|miss|missing[- ]key|accept|send|delivery) path\b|trace (a|the|one) |\b(every|each) box\b/,
  },
  {
    drill: "tradeoff",
    pattern:
      /trade-?off|justif|alternative|unreason|rationale|\bchoos\w*|\bchose\b|\bchoice\b|\bpick\w* (without|with no|lacking|and no)\b|no (reason|why)|without (a |any |stating )?(reason|why)/,
    titleOnly: true,
  },
  {
    // Words this broad also turn up in the reason of a gap about something else, so only the title counts. A title
    // that says the answer stayed shallow counts too: its topic is often named only in the reason.
    drill: "deep_dive",
    pattern:
      /cach|consisten|shard|partition|replica|failure|failover|stampede|hot (key|shard|spot)|idempoten|exactly[- ]once|dedup|duplicat|queue|rate limit|bottleneck|durab|availab|latency|ordering|fan-?out|backpressure|retry|\bttls?\b|click|\bcount|batch|analytics|hard part|first answer|shallow|hand-?wav|one level|deeper/,
    titleOnly: true,
  },
];

const LLD_RULES: Rule[] = [
  { drill: "tradeoff", pattern: /pattern|strategy|extens(ib|ion)|trade-?off|justif|alternative|unreason|rationale|\bchoos\w*|\bchose\b|\bchoice\b/, titleOnly: true },
  { drill: "lld_skeleton", pattern: /entit|class|interface|skeleton|model(l)?ing|object|relationship|data shape|abstraction|responsib|encapsulat|\bapi\b|noun/ },
];

/**
 * The steps of a round, as a gap title names them. "The API", "capacity" and "design" also name parts of a design
 * ("never reached the API gateway"), so only a phrase that is about time on a step may use the wider list.
 */
const STEP = String.raw`(the )?(step|phase|round|requirements|scoping|clarif\w*|capacity math|deep dives?|curveball|extension|skeleton)`;
const ANY_STEP = String.raw`(the )?(step|phase|round|requirements|scoping|clarif\w*|capacity( math)?|api|entities|design|deep dives?|curveball|extension|skeleton)`;
const NUMBER_WORD = String.raw`(\d+|five|ten|fifteen|twenty|twenty-five|thirty|forty)`;

/**
 * Phrases that tie time or pace to a step of the round, the round itself or the question asked, so they cannot name a
 * part of a design. They overrule even the judge's drill, because no drill trains them.
 */
const ROUND_ONLY = new RegExp(
  [
    String.raw`staying in the round|leading the round|drive the (round|interview)`,
    String.raw`\b(ran|running) out of (round )?time\b|\bran over time\b`,
    String.raw`\b(ran|running|went) (long|over)( time)? (on|in) ${STEP}\b`,
    String.raw`\b(requirements|scoping|capacity|api|design|entities|skeleton) step (ran|went|running) (long|over)\b`,
    String.raw`\b(spent|spending|spend|spends) too long on ${STEP}\b|\btoo much time on ${STEP}\b`,
    String.raw`\b${NUMBER_WORD} minutes on ${ANY_STEP}\b|\b${NUMBER_WORD} minutes (left )?unused\b`,
    String.raw`\bround's (remaining |spare )?time\b|\bunused round time\b|\btook (half|most) of the round\b`,
    String.raw`\bstay(ed|ing|s)? on the question\b`,
    String.raw`\b(questions?|curveball|probes?|follow-ups?|halves|half) (left |went )?unanswered\b|\bleft the (questions?|curveball|probes?) unanswered\b`,
    String.raw`\b(never|didn'?t|did not) (reach(ed)?|get|got) (to )?${STEP}\b|\btimed out before ${STEP}\b|\brushed ${STEP}\b`,
    String.raw`\btime to spare\b|\b(to|inside|within) its time box\b`,
    String.raw`\b(us(e|ed|ing)|spen(d|ds|ding|t)) (the )?(remaining|spare|leftover) (minutes|round time)\b`,
  ].join("|"),
);

/**
 * Words that usually describe how the round was run, but also name parts of some designs ("broadcast pacing", "a
 * time-boxed lease", "offers left unanswered"). They decide only when the judge chose no drill.
 */
const ROUND_LIKELY =
  /pacing|\bpace\b|time[- ]?(management|box)|phase (timing|pacing)|\b(when|while|once) stuck\b|\bstall(ed|ing)\b|\b(remaining|spare|leftover) (time(?![- ]to)|minutes)\b|answering (both|every|all|each) (questions?|probes?|parts?|halves|half|follow-ups?)\b|\bfinished early\b|\bout of time\b|\bunanswered\b|\bover-?long\b/;

/** A gap about getting the idea across is trained by defending a choice aloud. */
const ABOUT_EXPLAINING = /explain|explanation|communicat|articulat/;

/** Model-written text: a cap keeps the matching cheap whatever the gap holds. */
const MAX_MATCH_CHARS = 2000;

export interface GapForDrill {
  title: string;
  whyItMatters?: string;
  drill?: DrillType | undefined;
  /** The judge's own mark for a gap about how the round was run rather than what was designed. */
  aboutTheRound?: boolean | undefined;
}

/**
 * Picks a drill for a scorecard gap. A gap about how the round was run (pace, time, staying in the round, answering
 * what was asked) gets none: the judge marks one with `aboutTheRound`, and a title that can only mean that overrules
 * even the judge's drill. Otherwise the judge's own choice wins when it fits the track. Failing that, a title that
 * likely means the round gets none, then the gap's title is matched first, then its title with the reason it matters;
 * the trade-off and broad deep-dive rules read the title only. A gap about explaining or communicating names no topic
 * of its own, so it is the last resort: it gets the trade-off drill only when no topic rule matched, and it reads the
 * title only. A gap no rule fits gets none: null queues nothing.
 */
export function drillForGap(gap: GapForDrill, track: Track): DrillType | null {
  if (gap.aboutTheRound) return null;
  const title = gap.title.slice(0, MAX_MATCH_CHARS).toLowerCase();
  if (ROUND_ONLY.test(title)) return null;
  if (gap.drill && drillServesTrack(gap.drill, track)) return gap.drill;
  if (ROUND_LIKELY.test(title)) return null;
  const rules = track === "lld" ? LLD_RULES : HLD_RULES;
  const full = `${title} ${(gap.whyItMatters ?? "").slice(0, MAX_MATCH_CHARS).toLowerCase()}`;
  for (const text of [title, full]) {
    const hit = rules.find((r) => (text === title || !r.titleOnly) && r.pattern.test(text));
    if (hit) return hit.drill;
  }
  return ABOUT_EXPLAINING.test(title) ? "tradeoff" : null;
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

/** Interview-ready results that close a drill. */
export const READY_TO_CLOSE = 3;
/** Days until the next drill after the first and the second first-try ready result. */
export const READY_INTERVAL_DAYS = [3, 7] as const;
/** Days until the next drill after a ready result that came with a revision, and after a "getting there". */
export const REVISED_INTERVAL_DAYS = 2;

export type DrillStatus = "open" | "closed";
export const DRILL_OUTCOMES = ["ready", "getting_there", "needs_work"] as const;
export type DrillOutcome = (typeof DRILL_OUTCOMES)[number];

export const OUTCOME_LABEL: Record<DrillOutcome, string> = { ready: "Interview-ready", getting_there: "Getting there", needs_work: "Needs work" };

const OUTCOME_RANK: Record<DrillOutcome, number> = { needs_work: 0, getting_there: 1, ready: 2 };

/** The better of two outcomes; the first wins a tie. */
export function betterOutcome(a: DrillOutcome, b: DrillOutcome): DrillOutcome {
  return OUTCOME_RANK[b] > OUTCOME_RANK[a] ? b : a;
}

export function isBetterOutcome(a: DrillOutcome, than: DrillOutcome): boolean {
  return OUTCOME_RANK[a] > OUTCOME_RANK[than];
}

// ---------------------------------------------------------------------------
// Rubric. Scores use the judge's scale: 1 missing or wrong, 2 partly there, 3 at the bar, 4 strong.

export interface DrillCriterion {
  id: string;
  label: string;
  /** A core criterion decides the outcome; the others only colour the feedback. */
  core: boolean;
  /** Added after attempts were already saved: a saved row without a score for it is judged on the criteria it has. */
  added?: boolean;
}

export interface DrillRubric {
  /** The round scorecard dimension the drill trains. */
  skill: string;
  /** Tracks where the drill trains another dimension than `skill`. */
  skillOn?: Partial<Record<Track, string>>;
  criteria: DrillCriterion[];
}

const c = (id: string, label: string, core = false, added = false): DrillCriterion => ({ id, label, core, ...(added ? { added } : {}) });

export const DRILL_RUBRIC: Record<DrillType, DrillRubric> = {
  capacity: {
    skill: "scale_reliability",
    criteria: [
      c("picks_numbers", "Picks the numbers that decide", true),
      c("math", "Math is about right", true),
      c("decisions", "Each number ends in a decision", true),
      c("assumptions", "States its assumptions"),
    ],
  },
  walk: {
    skill: "design",
    criteria: [
      c("path", "Full path in the right order", true),
      c("jobs", "Each box has a job", true),
      c("data", "Says what is read and written where"),
      c("weak_step", "Names the slow or weak step"),
    ],
  },
  requirements: {
    skill: "navigation",
    criteria: [
      c("functions", "Core functions", true),
      c("numbers", "Quality needs as numbers", true),
      c("questions", "Asks the questions that change the design", true),
      c("scope", "Says what is out of scope"),
    ],
  },
  deep_dive: {
    skill: "depth",
    criteria: [
      c("naive", "Says what breaks in the naive way", true),
      c("mechanism", "A mechanism that works, one level deeper", true),
      c("cost", "States the cost"),
      c("follow_up", "Holds up under the follow-up", true, true),
    ],
  },
  tradeoff: {
    skill: "depth",
    skillOn: { lld: "design" },
    criteria: [
      c("position", "Takes a clear position", true),
      c("reason", "Reason uses this problem's needs", true),
      c("other_side", "Says when the other option wins"),
      c("holds", "Holds or changes position for a good reason", true),
    ],
  },
  lld_skeleton: {
    skill: "design",
    criteria: [
      c("classes", "Right classes", true),
      c("owners", "Each rule has one owner", true),
      c("signatures", "Signatures express the behaviour", true),
      c("relations", "Relations and states"),
      c("change", "Room for the next change"),
    ],
  },
};

/** The round scorecard dimension a drill trains on a track. */
export function drillSkill(drill: DrillType, track: Track): string {
  const rubric = DRILL_RUBRIC[drill];
  return rubric.skillOn?.[track] ?? rubric.skill;
}

/**
 * Ready needs every core criterion at 3 or more and no criterion at 1. A core criterion at 1, or two core criteria
 * below 3, needs work. Everything else is getting there. A criterion with no score counts as 1, except one added after
 * attempts were saved: a saved row that never had it is judged on the criteria it has.
 */
export function outcomeFor(drill: DrillType, scores: readonly { id: string; score: number }[]): DrillOutcome {
  const byId = new Map(scores.map((s) => [s.id, s.score]));
  const criteria = DRILL_RUBRIC[drill].criteria.filter((k) => !k.added || byId.has(k.id));
  const score = (id: string) => byId.get(id) ?? 1;
  const core = criteria.filter((k) => k.core);
  if (core.some((k) => score(k.id) === 1)) return "needs_work";
  if (core.filter((k) => score(k.id) < 3).length >= 2) return "needs_work";
  if (core.every((k) => score(k.id) >= 3) && criteria.every((k) => score(k.id) !== 1)) return "ready";
  return "getting_there";
}

/** Most proof keys one item remembers a ready result on. */
export const MAX_READY_ON = 50;
/** Longest variant id: a slug of the changed-constraint title. */
export const MAX_VARIANT_ID = 80;
export const VARIANT_ID = /^[a-z0-9][a-z0-9-]*$/;
/** Interview-ready results on this many different proofs are needed before a drill may close. */
export const DIFFERENT_PROOFS_TO_CLOSE = 2;

/** What a ready result proves: the problem, or a problem with one changed constraint. */
export function proofKey(problemId: string, variant: string | null): string {
  return variant ? `${problemId}#${variant}` : problemId;
}

export interface DrillItem {
  id: string;
  sessionId: string;
  /** The problem of the next attempt. The server picks it. */
  problemId: string;
  /** The problem of the round that showed the gap. It never changes. */
  originProblemId: string;
  /** The changed constraint of the next attempt, or null for the problem as written. */
  variant: string | null;
  /** Proof keys of the ready results for this item, without duplicates. Emptied when the count starts again. */
  readyOn: string[];
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

export interface OutcomeInput {
  /** The ready count before the attempt. */
  passes: number;
  readyOn: readonly string[];
  outcome: DrillOutcome;
  /** True when the outcome came after a revision. */
  revised: boolean;
  /** What this result proves; see `proofKey`. */
  proof: string;
  /** True when the picker can offer this item another problem, or a changed constraint, for the next attempt. */
  canVary: boolean;
  today: string;
}

/**
 * What one attempt on a queued drill does to its item. The stored field `passes` is the ready count: Interview-ready
 * results in a row. A first-try ready result moves the next drill out (3 days, then 7) and the third closes the
 * drill, but only when the ready results cover at least two different proofs or the picker has nothing else to offer;
 * otherwise the count stays at 2 and the drill returns in 3 days on another problem or a changed constraint. A ready
 * result after a revision counts but stops at 2, so a drill never closes on a revised answer. A "getting there" keeps
 * the count and returns in 2 days. "Needs work" starts the count again and returns tomorrow.
 */
export function applyOutcome(input: OutcomeInput): { passes: number; readyOn: string[]; dueOn: string; status: DrillStatus } {
  const { outcome, today } = input;
  if (outcome === "needs_work") return { passes: 0, readyOn: [], dueOn: addDays(today, 1), status: "open" };
  if (outcome === "getting_there") return { passes: input.passes, readyOn: [...input.readyOn], dueOn: addDays(today, REVISED_INTERVAL_DAYS), status: "open" };
  const readyOn = input.readyOn.includes(input.proof) ? [...input.readyOn] : [...input.readyOn, input.proof].slice(-MAX_READY_ON);
  if (input.revised) return { passes: Math.min(READY_TO_CLOSE - 1, input.passes + 1), readyOn, dueOn: addDays(today, REVISED_INTERVAL_DAYS), status: "open" };
  const passes = Math.min(READY_TO_CLOSE, input.passes + 1);
  if (passes >= READY_TO_CLOSE) {
    if (new Set(readyOn).size >= DIFFERENT_PROOFS_TO_CLOSE || !input.canVary) return { passes, readyOn, dueOn: today, status: "closed" };
    return { passes: READY_TO_CLOSE - 1, readyOn, dueOn: addDays(today, READY_INTERVAL_DAYS[0]), status: "open" };
  }
  return { passes, readyOn, dueOn: addDays(today, READY_INTERVAL_DAYS[passes - 1] ?? 7), status: "open" };
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

/** One row of the attempt index. The full answer and grade live in a body file named by `id`. */
export interface DrillAttempt {
  id: string;
  /** When the attempt was opened. */
  at: string;
  day: string;
  drill: DrillType;
  problemId: string;
  variant: string | null;
  /** The queued item the attempt counted for. */
  drillId: string | null;
  status: "open" | "done";
  /** Null while the attempt is open. */
  outcome: DrillOutcome | null;
  /** The outcome before a revision changed it. */
  firstOutcome: DrillOutcome | null;
  revised: boolean;
  /** Rubric scores from 1 to 4. */
  scores: { id: string; score: number }[];
  /** Time taken as the browser measured it. */
  seconds: number | null;
  /** True for a row that came from the first file format and has no body file. */
  legacy: boolean;
  /** The queued item's state before this attempt; set only when the attempt counted for an item. */
  itemBefore?: { passes: number; readyOn: string[] } | undefined;
}

/** Ready and finished drills in the local week that holds `now`. Free drills count too; an open attempt does not. */
export function weekDrillStats(attempts: readonly Pick<DrillAttempt, "day" | "status" | "outcome">[], now: Date): { ready: number; attempted: number } {
  const first = localDay(weekStart(now));
  const next = addDays(first, 7);
  const mine = attempts.filter((a) => a.status === "done" && a.day >= first && a.day < next);
  return { ready: mine.filter((a) => a.outcome === "ready").length, attempted: mine.length };
}

// ---------------------------------------------------------------------------
// What the browser and the server say to each other

export const PROBLEM_ID = /^[a-z0-9][a-z0-9-]{1,80}$/;
export const DRILL_ID = /^[a-f0-9]{16}$/;
export const ATTEMPT_ID = /^[a-f0-9]{16}$/;
export const MAX_ELAPSED_SECONDS = 7200;
export const MAX_ANSWER_CHARS = 8000;
export const MAX_TOPIC_CHARS = 200;

/** Names one drill to run. `drillId` is set when it comes from the queue. */
export const DrillTargetSchema = z.strictObject({
  drill: DrillTypeSchema,
  problemId: z.string().regex(PROBLEM_ID),
  drillId: z.string().regex(DRILL_ID).optional(),
});
export type DrillTarget = z.infer<typeof DrillTargetSchema>;

export const DrillSubmitSchema = z.strictObject({
  ...DrillTargetSchema.shape,
  /** The changed constraint the prompt named, sent back so a tab that opened an older prompt is never graded on another one. */
  variant: z.string().max(MAX_VARIANT_ID).regex(VARIANT_ID).nullable().optional(),
  /** The topic the prompt named, sent back so a drill whose topic moved since is never graded on another one. */
  topic: z.string().min(1).max(MAX_TOPIC_CHARS).optional(),
  answer: z
    .string()
    .max(MAX_ANSWER_CHARS)
    .refine((text) => text.trim().length > 0, "Write an answer first."),
  elapsedSeconds: z.number().int().min(0).max(MAX_ELAPSED_SECONDS).optional(),
});
export type DrillSubmit = z.infer<typeof DrillSubmitSchema>;

const AnswerSchema = DrillSubmitSchema.shape.answer;

export const DrillReviseSchema = z.strictObject({
  attemptId: z.string().regex(ATTEMPT_ID),
  answer: AnswerSchema,
  elapsedSeconds: z.number().int().min(0).max(MAX_ELAPSED_SECONDS).optional(),
});
export type DrillRevise = z.infer<typeof DrillReviseSchema>;

/** The candidate's answer to a follow-up question of a dialogue drill. */
export const DrillReplySchema = z.strictObject({
  attemptId: z.string().regex(ATTEMPT_ID),
  /** The question the reply answers, counted from 1. A reply to a question the conversation moved past is refused. */
  asked: z.number().int().min(1).max(MAX_FOLLOW_UPS),
  answer: AnswerSchema,
  elapsedSeconds: z.number().int().min(0).max(MAX_ELAPSED_SECONDS).optional(),
});
export type DrillReply = z.infer<typeof DrillReplySchema>;

export const DrillAbandonSchema = z.strictObject({ attemptId: z.string().regex(ATTEMPT_ID) });

export interface GymDrillRow {
  id: string;
  /** The scorecard gap this drill trains. */
  gapTitle: string;
  /** The deep dive's or trade-off's topic. */
  topic: string | null;
  drill: DrillType;
  title: string;
  /** The problem of the next attempt. */
  problemId: string;
  problemTitle: string;
  /** The title of the changed constraint, when the next attempt asks one. */
  variantTitle: string | null;
  /** The problem of the round that showed the gap. */
  originProblemTitle: string;
  minutes: number;
  dueOn: string;
  due: boolean;
  /** Interview-ready results in a row. */
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
  week: { ready: number; attempted: number };
  /** Closed drills, newest first. */
  closed: GymClosedRow[];
  /** Finished attempts of the last `DRILL_POINT_DAYS` days, oldest first. Progress counts them in its skill rows. */
  points: DrillPoint[];
}

/** Most closed drills a summary lists. */
export const MAX_CLOSED_ROWS = 50;

export interface GymClosedRow {
  id: string;
  gapTitle: string;
  drill: DrillType;
  title: string;
  originProblemTitle: string;
  /** The day the drill closed. */
  closedOn: string;
}

/** One finished drill as Progress counts it: the skill it trains and the mean of its first grade. */
export interface DrillPoint {
  day: string;
  kind: DrillType;
  /** The round scorecard skill the attempt trained. */
  skill: string;
  /** Mean of the first grade's scores, on the 1 to 4 scale. */
  score: number;
  outcome: DrillOutcome;
  /** Interview-ready with no revision. */
  firstTry: boolean;
}

export interface DrillScoreView {
  id: string;
  label: string;
  core: boolean;
  score: number;
}

/** One finished attempt as the history lists it. The cost comes from the usage ledger. */
export interface DrillAttemptRow {
  id: string;
  at: string;
  problemTitle: string;
  variantTitle: string | null;
  outcome: DrillOutcome;
  firstOutcome: DrillOutcome | null;
  revised: boolean;
  scores: DrillScoreView[];
  seconds: number | null;
  costUsd: number | null;
  legacy: boolean;
}

/** An attempt row in a list that mixes kinds. */
export interface RecentAttemptRow extends DrillAttemptRow {
  drill: DrillType;
  title: string;
  drillId: string | null;
}

export interface DrillDetail {
  today: string;
  item: {
    id: string;
    drill: DrillType;
    title: string;
    gapTitle: string;
    status: DrillStatus;
    passes: number;
    dueOn: string;
    originProblemTitle: string;
    /** The problem of the next attempt. */
    problemId: string;
    problemTitle: string;
    variantTitle: string | null;
    /** The problems, and changed constraints, that earned an Interview-ready result. */
    proofs: string[];
  };
  /** The attempts that counted for this drill, newest first. */
  attempts: DrillAttemptRow[];
}

/** One saved attempt for display. `strong` is absent unless the candidate can no longer be asked the question for credit. */
export interface AttemptView {
  id: string;
  drill: DrillType;
  title: string;
  problemTitle: string;
  task: string;
  changed: string | null;
  answers: string[];
  turns: DrillTurn[];
  grades: { outcome: DrillOutcome; scores: DrillScoreView[]; wentWell: string[]; improve: string[]; yourLine: string; strong?: string }[];
}

export const DEFAULT_ATTEMPT_LIMIT = 30;
export const MAX_ATTEMPT_LIMIT = 100;

/** The query of `GET /api/gym/attempts`. A repeated key, an unknown key or a number out of range is refused. */
export const AttemptsQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.number().int().max(MAX_ATTEMPT_LIMIT))
    .optional(),
});

export interface DrillPrompt {
  drill: DrillType;
  title: string;
  minutes: number;
  task: string;
  /** The deep dive's or trade-off's topic. The browser sends it back with its answer. */
  topic?: string;
  problem: { id: string; title: string; track: Track };
  /** Set when the drill asks the problem with one changed constraint. The browser sends `id` back with its answer. */
  variant?: { id: string; title: string };
  material: { heading: string; markdown: string }[];
  /** Short line under the answer box. */
  answerHint: string;
  /** Set when a dialogue attempt for this drill is still open today, so the page can pick the conversation up again. */
  open?: DrillOpen;
  /** Set for a queued drill that is not due yet: an attempt now is practice and moves no schedule. */
  early?: { dueOn: string; today: string };
}

/** One line of a dialogue. The grader is the interviewer who asks the follow-up questions. */
export interface DrillTurn {
  role: "candidate" | "grader";
  text: string;
}

export interface DrillOpen {
  attemptId: string;
  /** When the attempt was opened, as an ISO time, so a resumed page counts its time from then. */
  openedAt: string;
  turns: DrillTurn[];
  /** Follow-up questions asked so far. */
  asked: number;
  /** Most follow-up questions this drill asks. */
  of: number;
}

/** The interviewer's next question, sent instead of a result while a dialogue drill goes on. */
export interface DrillQuestion {
  kind: "question";
  attemptId: string;
  question: string;
  asked: number;
  of: number;
}

/** What submit and reply answer: a question while the dialogue goes on, then the result. */
export type DrillTurnResponse = DrillQuestion | (DrillResult & { kind: "result" });

export interface DrillResult {
  attemptId: string;
  outcome: DrillOutcome;
  /** The outcome of the first try; null until a revision has been graded. */
  firstOutcome: DrillOutcome | null;
  revised: boolean;
  /** The criteria of the grade that set the outcome. */
  scores: { id: string; label: string; core: boolean; score: number }[];
  wentWell: string[];
  improve: string[];
  yourLine: string;
  /** One revision is allowed, on the day of the attempt, unless the first try was ready. A dialogue drill has none. */
  canRevise: boolean;
  /** The whole conversation of a dialogue drill, in order; empty for a written drill. */
  turns: DrillTurn[];
  /** Interview-ready results in a row for the queued drill; null for a free drill that matched none. */
  readyCount: number | null;
  closed: boolean;
  nextDueOn: string | null;
  /** The next due drill other than this one, if any. */
  next: DrillTarget | null;
}
