import { z } from "zod";
import type { Mode, Track } from "./phases";
import { DrillTypeSchema, type DrillType } from "./drills";
import { LIMITS } from "./protocol";
import { DAY_KINDS, DEFAULT_DSA_GOAL, DEFAULT_WEEKLY_PLAN, DSA_GOAL_MAX, DSA_GOAL_MIN, LEETCODE_USERNAME_PATTERN, isPastOrToday } from "./week";

export const MODEL_IDS = ["claude-opus-5-5", "claude-sonnet-5-5"] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ModelId = (typeof MODEL_IDS)[number];
export type Effort = (typeof EFFORTS)[number];

// ---------------------------------------------------------------------------
// Settings (data/settings.json)

export const SettingsSchema = z.strictObject({
  models: z.strictObject({
    interviewer: z.enum(MODEL_IDS),
    judge: z.enum(MODEL_IDS),
    coach: z.enum(MODEL_IDS),
    scribe: z.enum(MODEL_IDS),
    // Drills arrived after the first settings files, so a file without a grader loads with the default.
    grader: z.enum(MODEL_IDS).default("claude-sonnet-5-5"),
  }),
  effort: z.strictObject({
    interviewer: z.enum(EFFORTS),
    judge: z.enum(EFFORTS),
    coach: z.enum(EFFORTS),
    scribe: z.enum(EFFORTS),
    grader: z.enum(EFFORTS).default("medium"),
  }),
  durations: z.strictObject({
    hld: z.union([z.literal(45), z.literal(60)]),
    lld: z.union([z.literal(90), z.literal(120)]),
  }),
  theme: z.enum(["light", "dark"]),
  // The three below arrived after the first settings files, so a file without them loads with these defaults.
  weeklyPlan: z
    .array(z.enum(DAY_KINDS))
    .length(7)
    .default(() => [...DEFAULT_WEEKLY_PLAN]),
  leetcodeUsername: z.string().regex(LEETCODE_USERNAME_PATTERN).optional(),
  dsaWeeklyGoal: z.number().int().min(DSA_GOAL_MIN).max(DSA_GOAL_MAX).default(DEFAULT_DSA_GOAL),
  /** First local day whose LeetCode solves count on the DSA page, so earlier years never show. */
  dsaCountFrom: z
    .string()
    .refine((day) => isPastOrToday(day), "Pick a real day that is not in the future")
    .optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  models: { interviewer: "claude-opus-5-5", judge: "claude-opus-5-5", coach: "claude-opus-5-5", scribe: "claude-opus-5-5", grader: "claude-sonnet-5-5" },
  effort: { interviewer: "low", judge: "high", coach: "medium", scribe: "medium", grader: "medium" },
  durations: { hld: 45, lld: 120 },
  theme: "dark",
  weeklyPlan: [...DEFAULT_WEEKLY_PLAN],
  dsaWeeklyGoal: DEFAULT_DSA_GOAL,
};

// ---------------------------------------------------------------------------
// Problems

export type TrackerMark = "[ ]" | "[~]" | "[x]";

export interface ProblemSummary {
  id: string;
  track: Track;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  /** Mark of the matching TRACKER.md bullet, or null when the problem is not in the tracker (custom problems). */
  trackerMark: TrackerMark | null;
  lastAttempt: { sessionId: string; date: string; mode: Mode; verdict: Verdict | null; readiness?: Readiness["call"] | null } | null;
  /** First sentence of the problem's opening prompt, which the candidate would hear anyway. */
  summary: string;
  /**
   * The day a redo falls due: seven days after the date the redo rule used, which is the last attempt, else the newest
   * date on the tracker bullet. Null when the problem is not partly done or no date is known.
   */
  redoDueOn?: string | null;
  /** "next" = recommended new problem; "redo" = a [~] problem whose last attempt is 7 or more days old. */
  badge: "next" | "redo" | null;
  custom: boolean;
}

// ---------------------------------------------------------------------------
// Sessions

export type SessionStatus =
  | "live" // clock running
  | "paused" // backend error or guided-mode pause; clock stopped
  | "ended" // candidate or interviewer ended it; debrief not started
  | "debriefing" // tester and judge running
  | "debriefed" // scorecard ready; coach chat and bookkeeping available
  | "failed"; // debrief failed after retries; transcript is still saved

export type Channel = "interview" | "coach";
export type Role = "interviewer" | "candidate" | "coach" | "system";

export interface TranscriptEntry {
  id: string;
  /** Milliseconds of round time (clock time, pauses excluded) when the entry was created. */
  at: number;
  wall: string; // ISO time
  channel: Channel;
  role: Role;
  text: string;
  /** System notes describe events (phase change, run result, extension, clock). Hidden ones are for the model only. */
  kind?: "clock" | "extension" | "hint" | "phase" | "run" | "note" | "error" | "gap";
  hidden?: boolean;
}

export interface CompileDiagnostic {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: "error" | "warning" | "note";
  message: string;
}

export interface RunResult {
  at: number;
  compile: { ok: boolean; diagnostics: CompileDiagnostic[]; stderr: string; durationMs: number };
  run: { exitCode: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number } | null;
}

/** What one step settled, drawn from his chat, board and code when he left the step. Facts only, never a judgement. */
export interface StepSummary {
  status: "pending" | "done" | "failed";
  /** What he put forward in the step, in short lines. */
  proposed: string[];
  /** What both sides treat as settled: answers to his questions, numbers and choices the interviewer accepted. */
  agreed: string[];
}

/** One thing a strong answer covers in a step, derived from the problem brief when the round starts. */
export interface ChecklistItem {
  id: string;
  label: string;
  /** The question that draws this requirement out of the interviewer, when the brief gives one. */
  ask?: string;
}

export type CoverageState = "covered" | "partial" | "missing";

/** The checker's verified reading of one checklist item. Its quote was found in his chat, on the board, in the code or in his written answer. */
export interface StepCheckItem {
  state: CoverageState;
  source: "chat" | "board" | "code" | "notes";
  /** Round time of the chat line the quote came from; null for every other source. */
  at: number | null;
  quote: string;
  /** What a partly covered item still lacks, in a few words. */
  detail: string;
}

export interface StepCheck {
  status: "checking" | "done" | "failed";
  /** Round time of the last finished check, or null before one finished. */
  checkedAt: number | null;
  /** The last finished check looked at an image of the step's frame as well as its text. */
  usedImage: boolean;
  /** By checklist item id. An item missing from the map is not covered yet. */
  items: Record<string, StepCheckItem>;
}

/**
 * The guide's call on one guided step, which is the only "passed" the candidate sees. `at` is round time in
 * milliseconds. A pass is final for the round; a "not yet" carries the one gap the guide named.
 */
export interface StepVerdict {
  verdict: "pass" | "not_yet";
  gap?: string;
  at: number;
}

/** A short note an AI role attached to one board element. */
export interface BoardPin {
  id: string;
  elementId: string;
  /** The step whose frame holds the element, or null when it sits outside every step frame. */
  phase: string | null;
  note: string;
  /** "note" is the guide's remark during the round; the judge marks what held and what is a gap. */
  tone: "note" | "held" | "gap";
  by: "guide" | "judge";
  at: number;
}

/** Where the coach stands on one scorecard gap. `by` is who first opened it and never changes afterwards. */
export interface GapProgress {
  by: "coach" | "candidate";
  state: "started" | "taught" | "core_only";
  at: string;
}

export interface Session {
  id: string;
  problemId: string;
  title: string;
  track: Track;
  mode: Mode;
  custom: boolean;
  createdAt: string;
  durationMs: number;
  /** Wall time the clock started (ISO). */
  startedAt: string;
  /** Total paused milliseconds so far, excluding a pause still in progress. */
  pausedMs: number;
  /** Wall time the current pause started (ISO), if paused. */
  pauseStartedAt: string | null;
  /** Why the round is paused: a model error, the user's own pause, nobody had the room open, or a server restart. */
  pauseReason: "error" | "user" | "away" | "restart" | null;
  endedAt: string | null;
  status: SessionStatus;
  phase: string;
  phaseHistory: { phase: string; at: number; by: "candidate" | "interviewer" }[];
  transcript: TranscriptEntry[];
  hints: { at: number; level: 1 | 2 | 3; topic: string }[];
  /** Guided rounds. Per phase id, the guide's latest call on the step. Sessions saved before this existed load without it. */
  stepVerdicts?: Record<string, StepVerdict>;
  /** Guided rounds. Each time he asked for a model answer; the server records it, never the model. */
  assists?: { at: number; phase: string }[];
  extension: { at: number; text: string } | null;
  board: { version: number; graphText: string; updatedAt: number | null };
  /** The candidate's written answer per phase id, plain text. Sessions saved before this existed load with {}. */
  stepNotes: Record<string, string>;
  /** Counts every accepted notes update; a client update is ignored unless its version is higher. */
  stepNotesVersion: number;
  /** Per phase id, a notepad written when he left the step. Kept for sessions that hold one; loads with {} otherwise. */
  stepSummaries: Record<string, StepSummary>;
  /** Per phase id, what a strong answer covers in that step. */
  checklist: Record<string, ChecklistItem[]>;
  /** Per phase id, the checker's latest verified reading of the step. */
  stepChecks: Record<string, StepCheck>;
  /**
   * LLD only. Per design step, the trimmed text of the code lines he wrote while that step was on the rail, newest
   * last. Sessions saved before this existed load without it, and the runtime fills it when it loads the round.
   */
  stepCode: Record<string, string[]>;
  /** Hidden notes (a pause, a step move) held for the interviewer's next turn. Server only. */
  pendingEvents?: string[];
  pins: BoardPin[];
  /** A gap from an earlier debrief this guided round practises. Null for a normal round. */
  focus: { title: string; goodLooksLike: string } | null;
  /** Per scorecard gap title, what the coach did with it. Sessions saved before this existed load with {}. */
  gapProgress: Record<string, GapProgress>;
  /** The study-notes draft for this round and whether it was saved to the study files. Null before a draft. */
  studyNotes: { proposalId: string; status: Proposal["status"]; appliedCount: number; savedAt: string | null } | null;
  /** LLD only. Path is relative to the study root, for example "lld/parking-lot/attempt-2026-10-30.cpp". */
  code: { path: string; version: number; lastRun: RunResult | null } | null;
  sdk: { interviewerSessionId: string | null; coachSessionId: string | null };
  scorecard: Scorecard | null;
  models: { interviewer: ModelId; judge: ModelId };
}

/** One scored skill from a round's scorecard. */
export interface HistoryScore {
  id: string;
  name: string;
  score: number;
}

/** A scorecard gap with what the coach did about it, so a practice round can start without opening the round. */
export interface HistoryGap {
  title: string;
  goodLooksLike: string;
  severity: "high" | "medium" | "low";
  /** The judge's reason the gap matters; drills read it to pick a topic. */
  whyItMatters?: string;
  /** The coach taught it all the way. */
  done: boolean;
  /** The judge marked the gap as about how the round was run, so no drill trains it. */
  aboutTheRound?: boolean;
  /** The drill the judge chose for this gap, when one fits. */
  drill?: DrillType;
}

/** One row of the round history: enough for Today, Progress and History without fetching each round. */
export interface SessionHistoryItem {
  id: string;
  problemId: string;
  title: string;
  track: Track;
  mode: Mode;
  createdAt: string;
  /** When the round ended. Absent while it is open and for summaries saved before this existed. */
  endedAt?: string;
  status: SessionStatus;
  verdict: Verdict | null;
  /** Guided rounds only: the readiness call the history badge shows in place of the hire verdict. */
  readiness?: Readiness["call"] | null;
  /** Set while the round is paused: why, when, and how much of the round is left (null in a guided round, which has no limit). */
  pause: { reason: NonNullable<Session["pauseReason"]>; pausedAt?: string; timeLeftMs: number | null } | null;
  /** The study-notes draft was saved to the study files. */
  notesSaved: boolean;
  /** The raw clock, so the page can work out the time used at any moment. Absent from a server that predates it. */
  clock?: { startedAt: string; pausedMs: number; pauseStartedAt: string | null; durationMs: number };
  /** A short round practising one gap. It is not an attempt at the problem, so no clock or score counts it. */
  focus?: boolean;
  /** Scored rounds only. */
  scores?: HistoryScore[];
  phaseTiming?: { phase: string; label: string; plannedMinutes: number; actualMinutes: number }[];
  gaps?: HistoryGap[];
}

/** A checklist item as the browser shows it. */
export interface PublicStepItem {
  id: string;
  /** The requirement itself, or, when `question` is true, the question that draws it out. */
  label: string;
  /** True when `label` is a question to ask, shown in place of a requirement he has not yet covered. */
  question: boolean;
  state: CoverageState;
  source: StepCheckItem["source"] | null;
  at: number | null;
  /** Null whenever it would hint at what is still missing. */
  detail: string | null;
}

export interface PublicStepCheck {
  status: StepCheck["status"] | "idle";
  checkedAt: number | null;
  usedImage: boolean;
  items: PublicStepItem[];
  covered: number;
  partial: number;
  total: number;
}

/** What the browser gets: the session minus anything that would reveal the hidden brief early. */
export type PublicSession = Omit<Session, "sdk" | "checklist" | "stepChecks" | "stepCode" | "pendingEvents" | "assists"> & {
  /** How many times he asked for a model answer. The steps stay on the server until the debrief. */
  assistCount: number;
  /** Per phase id, the checklist filtered for the mode and the status of the round. */
  steps: Record<string, PublicStepCheck>;
  clock: { startedAt: string; pausedMs: number; pauseStartedAt: string | null; durationMs: number; serverNow: string };
  phasePlan: { id: string; label: string; minutes: number }[];
  /** Present only once status is "debriefed": the problem's reference sections, for the debrief page. */
  reference: {
    sections: { heading: string; markdown: string }[];
    sources?: { title: string; url: string }[];
  } | null;
};

// ---------------------------------------------------------------------------
// Scorecard (judge output). Also converted to JSON Schema for the SDK's structured output.

export const VERDICTS = ["strong_hire", "hire", "lean_no_hire", "no_hire"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const EvidenceSchema = z.strictObject({
  quote: z.string().describe("Verbatim words copied from the candidate's messages, the board text or the code. No paraphrase."),
  source: z.enum(["candidate", "board", "code"]),
  at: z.string().describe("Round time as mm:ss when the quote happened; empty string for board or code."),
  polarity: z.enum(["plus", "minus"]),
});

/** Gaps a scorecard keeps. The judge is asked for at most this many, and the engine keeps the most severe. */
export const MAX_GAPS = 5;

export const ScorecardSchema = z.strictObject({
  verdict: z.strictObject({
    // The keys are stored in saved sessions: `sde2` is the call at the target level, `senior` the call at the stretch level.
    sde2: z.enum(VERDICTS),
    senior: z.enum(VERDICTS),
    targetLevel: z.string().optional().describe("The target level name, copied exactly from the prompt."),
    stretchLevel: z.string().optional().describe("The stretch level name, copied exactly from the prompt."),
    confidence: z.enum(["low", "medium", "high"]),
    summary: z.string().describe("Three to five plain sentences on how the round went at the target level bar."),
  }),
  dimensions: z.array(
    z.strictObject({
      id: z.string().describe("Rubric dimension id, exactly as written in the rubric."),
      name: z.string(),
      score: z.number().int().min(1).max(4),
      evidence: z.array(EvidenceSchema),
      whatA4LooksLike: z.string().describe("For this problem specifically, what a 4 on this dimension would have sounded like."),
    }),
  ),
  steps: z.array(
    z.strictObject({
      phase: z.string().describe("The phase id as listed in the phase timing."),
      took: z
        .array(
          z.strictObject({
            point: z.string().describe("One plain sentence on what the judge took from his answer."),
            dimensionId: z.string().describe("Rubric dimension id exactly."),
            evidence: EvidenceSchema,
          }),
        )
        .max(8),
      missing: z.array(z.string().describe("What the target level answer had in this step that his did not.")).max(6),
    }),
  ),
  strengths: z.array(z.string()),
  // No max here: a card over the cap is trimmed after the parse, so one extra gap never fails a whole debrief.
  gaps: z
    .array(
      z.strictObject({
        title: z.string(),
        severity: z.enum(["high", "medium", "low"]),
        whyItMatters: z.string(),
        whatGoodLooksLike: z.string(),
        teachMinutes: z.number().int().min(1).max(60),
        drill: DrillTypeSchema.optional().describe("The short drill that trains this gap, or leave it out when none fits."),
        aboutTheRound: z
          .boolean()
          .optional()
          .describe("True when the gap is about how the round was run (pace, time, staying in the round, answering what was asked) rather than what was designed."),
      }),
    )
    .describe(`At most ${MAX_GAPS} gaps, most severe first.`),
  timeline: z.array(z.strictObject({ at: z.string(), note: z.string() })),
  practiceTask: z.string(),
  trackerMark: z.enum(["[~]", "[x]"]),
  trackerMarkReason: z.string(),
  lldScenarios: z
    .array(z.strictObject({ name: z.string(), pass: z.boolean(), detail: z.string(), cause: z.string().optional() }))
    .describe("LLD only: the scenario results the tester produced. Empty array for HLD."),
});

/** Whether a guided round shows the unaided work interview mode asks for. A fixed rule, never the model's call. */
export interface Readiness {
  call: "ready" | "not_yet";
  /** One plain sentence per failed condition. Empty exactly when the call is "ready". */
  reasons: string[];
}

export type Scorecard = z.infer<typeof ScorecardSchema> & {
  /** Guided rounds only; added by the server after validation, not by the model. */
  readiness?: Readiness;
  /** Added by the server after validation, not by the model. */
  quoteChecks?: { dimensionId: string; index: number; verified: boolean }[];
  stepQuoteChecks?: { phase: string; index: number; verified: boolean }[];
  phaseTiming?: { phase: string; label: string; plannedMinutes: number; actualMinutes: number }[];
  lintIssues?: { field: string; issue: string }[];
};

// ---------------------------------------------------------------------------
// Bookkeeping: deterministic edits the scribe proposes and the user approves.

const MARK = z.enum(["[ ]", "[~]", "[x]"]);
const NOTES_PATH = z.string().regex(/^notes\/[a-z0-9][a-z0-9-]{0,80}\.md$/);

export const BookkeepingOpSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("tracker_update_bullet"),
    section: z.string().min(3).max(200).describe("The exact heading line, for example '### C2. Classic HLD Problems'."),
    bullet: z.string().min(2).max(300).describe("The bullet text after the mark and before any ' → ' suffix."),
    mark: MARK.optional(),
    appendSuffix: z
      .string()
      .max(300)
      .optional()
      .describe(
        "Text appended to the bullet line without a leading arrow, for example 'notes/c2-url-shortener.md · 2026-10-30', or just '2026-11-06' on a redo of the same notes file. The app adds ' → ' or ' · ' in front.",
      ),
  }),
  z.strictObject({
    kind: z.literal("tracker_add_subbullet"),
    section: z.string().min(3).max(200),
    parentBullet: z.string().min(2).max(300),
    text: z.string().min(3).max(400).describe("Written as '  - [ ] <text> (added)' under the parent bullet."),
  }),
  z.strictObject({
    kind: z.literal("tracker_append_session_log_row"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    topics: z.string().min(3).max(1500),
    outcome: z.string().min(3).max(3000),
    notesFile: z.string().max(200),
  }),
  z.strictObject({
    kind: z.literal("tracker_append_gap_row"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    gap: z.string().min(3).max(600),
    cameUpWhile: z.string().min(3).max(300),
    filled: z.string().min(2).max(100),
  }),
  z.strictObject({ kind: z.literal("review_append_entry"), markdown: z.string().min(10).max(12000) }),
  z.strictObject({ kind: z.literal("notes_create"), path: NOTES_PATH, content: z.string().min(50).max(60000) }),
  z.strictObject({ kind: z.literal("notes_append"), path: NOTES_PATH, content: z.string().min(10).max(30000) }),
]);
export type BookkeepingOp = z.infer<typeof BookkeepingOpSchema>;

// One apply message carries at most this many op ids, so a draft must never offer more.
export const ScribeOutputSchema = z.strictObject({ ops: z.array(BookkeepingOpSchema).max(LIMITS.proposalOps) });

export interface ProposalOp {
  id: string;
  op: BookkeepingOp;
  file: string; // "TRACKER.md", "REVIEW.md" or "notes/<file>.md"
  summary: string;
  /** Set when the op cannot be applied: bullet not found, deny-listed term present, invalid path, and so on. */
  blocked: string | null;
}

export interface Proposal {
  id: string;
  sessionId: string;
  createdAt: string;
  ops: ProposalOp[];
  /** Unified diff per file, computed with every unblocked op applied. */
  diffs: { file: string; diff: string }[];
  /** sha256 of each target file when the draft was made; apply refuses if a file changed since. */
  baseHashes: Record<string, string | null>;
  status: "draft" | "applied" | "stale";
}

// ---------------------------------------------------------------------------
// Board graph (text form of the whiteboard that the models read).

export interface GraphNode {
  key: string; // element id, or the outermost group id for grouped shapes
  label: string;
  kind: string | null; // customData.kind from the palette, if any
  shape: string; // rectangle | ellipse | diamond | group | frame-less text | image | freedraw
  frame: string | null; // frame name
}
export interface GraphEdge {
  from: string | null; // node key
  to: string | null;
  label: string;
  style: "solid" | "dashed" | "dotted";
  arrow: "none" | "forward" | "backward" | "both";
  quality: "bound" | "guessed" | "dangling";
}
export interface BoardGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  freeText: { text: string; frame: string | null }[];
  frames: string[];
  opaque: { kind: string; frame: string | null }[]; // freedraw, images: things the text form cannot describe
  warnings: string[]; // unlabeled node, dangling arrow, isolated node
}

export type { Mode, Track };
