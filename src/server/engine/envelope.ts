import type { Track } from "../../shared/phases";
import type { CompileDiagnostic, RunResult, StepSummary, TranscriptEntry } from "../../shared/types";
import { formatClock, formatStamp, type CheckpointKind } from "./clock";

export { numberedCode } from "../../shared/stepCode";

export interface TimeView {
  roundMs: number;
  durationMs: number;
  guided: boolean;
  phaseId: string;
  plannedStartMs: number | null;
  plannedEndMs: number | null;
}

export interface BoardView {
  version: number;
  graphText: string;
  /** True when the board changed since this model last saw it. */
  changed: boolean;
}

export interface CheckSummary {
  errors: number;
  warnings: number;
}

export interface CodeView {
  lines: number;
  changed: boolean;
  check: CheckSummary | null;
}

export type RunView = Omit<RunResult, "at">;

export interface NotesView {
  version: number;
  /** His written step answers as labelled text, empty when he wrote none. */
  text: string;
  /** True when they changed since this model last saw them. */
  changed: boolean;
}

export interface ContextView {
  time?: TimeView;
  board: BoardView;
  notes?: NotesView;
  code?: CodeView;
  lastRun?: RunView | null;
  events?: string[];
  /** Guided rounds: which steps have a pass, so the guide never states it from memory. */
  steps?: string;
}

export function timeLine(t: TimeView): string {
  const clock = t.guided ? `${formatClock(t.roundMs)} (guided practice, no time limit)` : `${formatClock(t.roundMs)} of ${formatClock(t.durationMs)}`;
  const planned = t.plannedStartMs !== null && t.plannedEndMs !== null ? ` (planned ${formatClock(t.plannedStartMs)}–${formatClock(t.plannedEndMs)})` : "";
  return `time: ${clock} · phase: ${t.phaseId}${planned}`;
}

/** Matches the room's "behind plan" badge, which stays hidden for the first half minute. */
const BEHIND_PLAN_MS = 30_000;

export function behindPlanLine(t: TimeView): string | null {
  if (t.guided || t.plannedEndMs === null) return null;
  const over = t.roundMs - t.plannedEndMs;
  return over >= BEHIND_PLAN_MS ? `behind plan: ${formatClock(over)} past the planned end of this phase` : null;
}

export function stepNotesText(phases: readonly { id: string; label: string }[], notes: Readonly<Record<string, string>>): string {
  return phases
    .filter((p) => (notes[p.id] ?? "").trim() !== "")
    .map((p) => `[${p.label}]\n${(notes[p.id] ?? "").trim()}`)
    .join("\n\n");
}

export function notesLines(n: NotesView | undefined): string[] {
  if (!n || n.version === 0 || !n.changed) return [];
  if (n.text === "") return ["notes: his written answers are now empty"];
  return ["notes: his written step answers, changed since you last looked", "<notes>", n.text, "</notes>"];
}

export function boardLines(b: BoardView): string[] {
  if (b.version === 0 && b.graphText.trim() === "") return ["board: empty"];
  if (!b.changed) return [`board: unchanged (version ${b.version})`];
  return [`board: changed since you last looked (version ${b.version})`, "<board>", b.graphText.trim() || "(nothing on the board)", "</board>"];
}

export function checkSummaryText(check: CheckSummary | null): string {
  if (!check) return "not run yet";
  if (check.errors === 0 && check.warnings === 0) return "clean";
  const parts: string[] = [];
  if (check.errors > 0) parts.push(`${check.errors} error${check.errors === 1 ? "" : "s"}`);
  if (check.warnings > 0) parts.push(`${check.warnings} warning${check.warnings === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export function summarizeDiagnostics(diagnostics: readonly CompileDiagnostic[]): CheckSummary {
  return {
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: diagnostics.filter((d) => d.severity === "warning").length,
  };
}

export function codeLine(c: CodeView): string {
  return `code: ${c.lines} line${c.lines === 1 ? "" : "s"}, ${c.changed ? "changed" : "unchanged"} · last check: ${checkSummaryText(c.check)}`;
}

function outputLines(text: string): number {
  const trimmed = text.replace(/\n+$/, "");
  return trimmed === "" ? 0 : trimmed.split("\n").length;
}

export function runSummary(r: RunView): string {
  if (!r.compile.ok) {
    const errors = r.compile.diagnostics.filter((d) => d.severity === "error").length;
    return `compile failed${errors > 0 ? ` with ${errors} error${errors === 1 ? "" : "s"}` : ""}`;
  }
  if (!r.run) return "compiled, did not run";
  const lines = outputLines(r.run.stdout) + outputLines(r.run.stderr);
  const out = `${lines} line${lines === 1 ? "" : "s"} of output`;
  if (r.run.timedOut) return `timed out after ${r.run.durationMs} ms, ${out}`;
  if (r.run.signal) return `killed by ${r.run.signal} after ${r.run.durationMs} ms, ${out}`;
  return `exit ${r.run.exitCode ?? "?"} in ${r.run.durationMs} ms, ${out}`;
}

export function contextBlock(v: ContextView): string {
  const lines: string[] = ["<context>"];
  if (v.time) {
    lines.push(timeLine(v.time));
    const behind = behindPlanLine(v.time);
    if (behind) lines.push(behind);
  }
  if (v.steps) lines.push(`steps: ${v.steps}`);
  lines.push(...boardLines(v.board));
  lines.push(...notesLines(v.notes));
  if (v.code) lines.push(codeLine(v.code));
  if (v.lastRun) lines.push(`last run: ${runSummary(v.lastRun)}`);
  if (v.events && v.events.length > 0) lines.push(`events: ${v.events.join("; ")}`);
  lines.push("</context>");
  return lines.join("\n");
}

/** The candidate's words go in verbatim; the model never sees them without the context around them. */
export function candidateEnvelope(v: ContextView, text: string): string {
  return `${contextBlock(v)}\n<candidate>\n${text}\n</candidate>`;
}

export function startTurn(v: ContextView): string {
  return `${contextBlock(v)}\n<start>\nThe candidate has joined and the clock is running. Open the round now.\n</start>`;
}

export function requestTurn(v: ContextView, body: string): string {
  return `${contextBlock(v)}\n<request>\n${body}\n</request>`;
}

const SILENT_LINE = "Say one short line only if a real interviewer would speak now. Otherwise reply with exactly <silent/>.";

/** Facts a clock instruction may need beyond its kind. */
export interface ClockDetail {
  /** For silence: how long he has been quiet. */
  quietMs?: number;
  /** For overtime: the round's planned length. */
  plannedMs?: number;
}

function minutesText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min === 1 ? "about a minute" : `about ${min} minutes`;
}

export function clockInstruction(kind: CheckpointKind, track: Track, detail: ClockDetail = {}): string {
  switch (kind) {
    case "phase_end":
      return `The planned time for this phase is over and the candidate is still in it. ${SILENT_LINE}`;
    case "phase_over":
      return "The candidate has spent about twice the planned time on this step. Reply with one short line that offers to move on to the next step, and leave the choice to the candidate. Raise no new gap and give no feedback. This turn is never silent.";
    case "extension": {
      const section = track === "hld" ? "Curveballs" : "Extensions";
      return `This is the extension point. Deliver the extension now in one short message, choosing one item from the brief's ${section} section that the candidate has not already handled.`;
    }
    case "five_minutes":
      return "Five minutes are left. You may warn the candidate in one short line. Otherwise reply with exactly <silent/>.";
    case "time_up":
      return "Time is up. Close the round in one or two sentences. Give no feedback and no signal about how it went. If your last reply already closed the round, reply with exactly <silent/>.";
    case "silence": {
      const work = track === "lld" ? "the code, the board and the step notes" : "the board and the step notes";
      return `The candidate has sent nothing, and nothing in ${work} has changed, for ${minutesText(detail.quietMs ?? 0)}. Check in once with one short line that invites them to talk you through where they are. Give no hint, name no concern and point at no area. Reply with exactly <silent/> only if they said they wanted time to work alone.`;
    }
    case "overtime":
      return `The round has reached its planned length of ${minutesText(detail.plannedMs ?? 0)}. Reply with one short line that says so and leaves the choice to the candidate: finish what they are on, or end the round. Give no feedback. This turn is never silent.`;
  }
}

export function clockTurn(time: TimeView, sinceCandidateMs: number | null, kind: CheckpointKind, track: Track, detail: ClockDetail = {}): string {
  const last = sinceCandidateMs === null ? "none yet" : `${formatClock(sinceCandidateMs)} ago`;
  return `<clock>\n${timeLine(time)} · candidate's last message: ${last}\n${clockInstruction(kind, track, detail)}\n</clock>`;
}

const SILENT = /<silent\s*\/>/gi;
const SILENT_FORMS = ["<silent/>", "<silent />"];

/** The stored form of a reply: every <silent/> removed, trimmed. Empty means "say nothing". */
export function cleanReply(text: string): string {
  return text.replace(SILENT, "").trim();
}

function heldSuffixLength(text: string): number {
  const lower = text.slice(-12).toLowerCase();
  for (let len = Math.min(lower.length, 10); len > 0; len--) {
    const tail = lower.slice(-len);
    if (SILENT_FORMS.some((f) => f.startsWith(tail) && tail.length < f.length)) return len;
  }
  return 0;
}

/**
 * Streams reply text to the browser while holding back anything that could still turn into <silent/>.
 * A reply that is only <silent/> never shows up at all.
 */
export class SilentFilter {
  private held = "";
  private full = "";
  private emittedAny = false;

  constructor(private readonly emit: (text: string) => void) {}

  push(delta: string): void {
    this.full += delta;
    this.held += delta;
    this.drain(false);
  }

  /** Flushes what is left and returns the reply as it should be stored. */
  finish(): string {
    this.drain(true);
    return cleanReply(this.full);
  }

  /** Whether any text reached the browser. */
  get streamed(): boolean {
    return this.emittedAny;
  }

  /** The text so far, cleaned, for keeping a partial reply when a turn fails half way. */
  partial(): string {
    return cleanReply(this.full);
  }

  private drain(final: boolean): void {
    this.held = this.held.replace(SILENT, "");
    const keep = final ? 0 : heldSuffixLength(this.held);
    let out = this.held.slice(0, this.held.length - keep);
    this.held = this.held.slice(this.held.length - keep);
    if (!this.emittedAny) {
      const trimmed = out.replace(/^\s+/, "");
      if (trimmed === "") {
        // Whitespace before the first visible character is held, not dropped, in case real text follows.
        this.held = out + this.held;
        if (final) this.held = "";
        return;
      }
      out = trimmed;
    }
    if (out) {
      this.emittedAny = true;
      this.emit(out);
    }
  }
}

/** The finished step notepads, in step order. Empty when no step has one. */
export function stepSummariesText(phases: readonly { id: string; label: string }[], summaries: Readonly<Record<string, StepSummary>>): string {
  return phases
    .flatMap((p) => {
      const s = summaries[p.id];
      if (s?.status !== "done" || s.proposed.length + s.agreed.length === 0) return [];
      const list = (title: string, lines: string[]) => (lines.length ? [title, ...lines.map((l) => `- ${l}`)] : []);
      return [[`[${p.label}]`, ...list("He proposed:", s.proposed), ...list("Agreed:", s.agreed)].join("\n")];
    })
    .join("\n\n");
}

/** Interview chat made while `phase` was the current step, across every visit to it. */
export function stepEntries(entries: readonly TranscriptEntry[], history: readonly { phase: string; at: number }[], phase: string, endAt: number): TranscriptEntry[] {
  const spans = history.flatMap((h, i) => (h.phase === phase ? [[h.at, history[i + 1]?.at ?? endAt] as const] : []));
  return entries.filter((e) => e.channel === "interview" && !e.hidden && e.kind !== "phase" && spans.some(([from, to]) => e.at >= from && e.at <= to));
}

export function transcriptLines(entries: readonly TranscriptEntry[], channel: TranscriptEntry["channel"]): string {
  return entries
    .filter((e) => e.channel === channel)
    .map((e) => {
      const stamp = `[${formatStamp(e.at)}]`;
      return e.role === "system" ? `${stamp} (event) ${e.text}` : `${stamp} ${e.role}: ${e.text}`;
    })
    .join("\n");
}

/** Round time before and after a moment that `roundTranscript` shows around it. */
export const TRANSCRIPT_WINDOW_MS = { before: 3 * 60_000, after: 2 * 60_000 } as const;
/** A full transcript past this size is cut, with a note, so one tool call stays a sane size. */
export const MAX_TRANSCRIPT_CHARS = 60_000;

/** "12:05" (or "[12:05]", as the transcript prints it) as round milliseconds, or null when it is not a mm:ss time. */
export function parseStamp(stamp: string): number | null {
  const m = /^\[?(\d{1,3}):([0-5]\d)\]?$/.exec(stamp.trim());
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null;
}

/**
 * One transcript line for a reader who talks to the candidate. A hidden hint record keeps only its topic, because its
 * level code means nothing to the candidate, and other hidden notes are clock bookkeeping. Continuation lines are
 * indented, so text typed by the candidate can never pass for a line of its own.
 */
function readableLine(e: TranscriptEntry): string | null {
  const stamp = `[${formatStamp(e.at)}]`;
  const body = (text: string) => text.replace(/\r\n?|[\n\u0085\u2028\u2029]/g, "\n    ");
  if (e.role !== "system") return `${stamp} ${e.role}: ${body(e.text)}`;
  if (e.kind === "hint") return `${stamp} (event) The interviewer gave a hint on: ${body(e.text.replace(/^hint H\d:\s*/, ""))}`;
  if (e.hidden) return null;
  return `${stamp} (event) ${body(e.text)}`;
}

/** One channel of the transcript for a model that reads it after the round and writes for the candidate. */
export function readableTranscript(entries: readonly TranscriptEntry[], channel: TranscriptEntry["channel"]): string {
  return entries
    .filter((e) => e.channel === channel)
    .flatMap((e) => readableLine(e) ?? [])
    .join("\n");
}

/**
 * The round's interview transcript for a model that reads it after the round, either whole or the few minutes around
 * one moment.
 */
export function roundTranscript(entries: readonly TranscriptEntry[], atMs: number | null): string {
  const inRange = atMs === null ? entries : entries.filter((e) => e.at >= atMs - TRANSCRIPT_WINDOW_MS.before && e.at <= atMs + TRANSCRIPT_WINDOW_MS.after);
  const text = readableTranscript(inRange, "interview");
  if (!text) return atMs === null ? "(the round has no transcript)" : "(nothing was said in the round around that time)";
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  return `${text.slice(0, MAX_TRANSCRIPT_CHARS)}\n(the transcript goes on; ask for a time with "at" to read a later part)`;
}

export function countLines(content: string): number {
  if (content === "") return 0;
  return content.replace(/\n$/, "").split("\n").length;
}

export function diagnosticsText(diagnostics: readonly CompileDiagnostic[], max = 40): string {
  if (diagnostics.length === 0) return "(none)";
  const shown = diagnostics.slice(0, max).map((d) => `- line ${d.line}:${d.column} ${d.severity}: ${d.message}`);
  if (diagnostics.length > max) shown.push(`- … ${diagnostics.length - max} more`);
  return shown.join("\n");
}

const OUTPUT_FOR_MODEL = 8000;

function clip(text: string): string {
  return text.length <= OUTPUT_FOR_MODEL ? text : `${text.slice(0, OUTPUT_FOR_MODEL)}\n… (output cut for length)`;
}

/** A run result as plain text, for the run_code and run_harness tools and the judge. */
export function runResultText(r: RunView): string {
  const parts: string[] = [];
  parts.push(r.compile.ok ? `compile: ok in ${r.compile.durationMs} ms` : "compile: failed");
  if (r.compile.diagnostics.length > 0) parts.push(`diagnostics:\n${diagnosticsText(r.compile.diagnostics)}`);
  else if (!r.compile.ok && r.compile.stderr) parts.push(`compiler output:\n${clip(r.compile.stderr)}`);
  if (r.run) {
    parts.push(`run: ${runSummary(r)}`);
    parts.push(`stdout:\n${r.run.stdout ? clip(r.run.stdout) : "(empty)"}`);
    if (r.run.stderr) parts.push(`stderr:\n${clip(r.run.stderr)}`);
  }
  return parts.join("\n");
}

/**
 * The first message of a fresh conversation after a failure. The role prompts treat any first turn as the cue to
 * open, so it says plainly that the opening already happened.
 */
export function replayTurn(v: ContextView, transcript: string, maxChars = 80_000): string {
  const text = transcript.length > maxChars ? `… (earlier lines left out)\n${transcript.slice(-maxChars)}` : transcript;
  return [
    contextBlock(v),
    "<replay>",
    "The connection to this conversation was lost and has been restored. The conversation is already under way and was opened earlier, so do not open it again. Here is everything so far, oldest first:",
    text,
    "Carry on from here. If the candidate's last message has no answer yet, answer it now. Otherwise reply with exactly <silent/>.",
    "</replay>",
  ].join("\n");
}
