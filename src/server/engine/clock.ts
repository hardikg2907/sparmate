import { EXTENSION_LEAD_MINUTES, type Mode, type Track } from "../../shared/phases";
import type { Session } from "../../shared/types";

export type ClockFields = Pick<Session, "startedAt" | "pausedMs" | "pauseStartedAt" | "endedAt">;

/** Round time: wall time since the start, minus every pause, frozen once the round has ended. */
export function roundTimeMs(clock: ClockFields, nowMs: number): number {
  const started = Date.parse(clock.startedAt);
  const end = clock.endedAt ? Date.parse(clock.endedAt) : nowMs;
  const currentPause = clock.pauseStartedAt ? Math.max(0, end - Date.parse(clock.pauseStartedAt)) : 0;
  return Math.max(0, end - started - clock.pausedMs - currentPause);
}

export type CheckpointKind = "phase_end" | "phase_over" | "extension" | "five_minutes" | "time_up";

export interface Checkpoint {
  id: string;
  kind: CheckpointKind;
  atMs: number;
  /** For phase_end and phase_over: the phase the checkpoint is about. */
  phase?: string;
}

const MINUTE = 60_000;

/** Planned [start, end) of each phase in round milliseconds, from the scaled phase plan. */
export function phaseWindows(plan: readonly { id: string; minutes: number }[]): { id: string; startMs: number; endMs: number }[] {
  let t = 0;
  return plan.map((p) => {
    const startMs = t;
    t += Math.round(p.minutes * MINUTE);
    return { id: p.id, startMs, endMs: t };
  });
}

/**
 * Every checkpoint of a round. Guided rounds keep only the phase nudges: they count up, have no end and no
 * extension. The last phase's end is left out because time-up (or nothing, in guided mode) covers it. The guided
 * offer to move on depends on where the candidate is, so `phaseOverCheckpoint` builds it when a step is entered.
 */
export function planCheckpoints(track: Track, mode: Mode, durationMs: number, plan: readonly { id: string; minutes: number }[]): Checkpoint[] {
  const out: Checkpoint[] = [];
  const windows = phaseWindows(plan);
  windows.slice(0, -1).forEach((w) => {
    if (mode === "interview" && w.endMs >= durationMs - MINUTE) return;
    out.push({ id: `phase_end:${w.id}`, kind: "phase_end", atMs: w.endMs, phase: w.id });
  });
  if (mode === "interview") {
    out.push({ id: "extension", kind: "extension", atMs: durationMs - EXTENSION_LEAD_MINUTES[track] * MINUTE });
    out.push({ id: "five_minutes", kind: "five_minutes", atMs: durationMs - 5 * MINUTE });
    out.push({ id: "time_up", kind: "time_up", atMs: durationMs });
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/** Round time he has spent in `phase` across every visit; the open visit counts up to `nowMs`. */
export function timeInPhase(history: readonly { phase: string; at: number }[], firstPhase: string | undefined, phase: string, nowMs: number): number {
  const sorted = [...history].sort((a, b) => a.at - b.at);
  let total = 0;
  let current = firstPhase ?? phase;
  let since = 0;
  for (const h of sorted) {
    if (h.at <= 0) {
      current = h.phase;
      continue;
    }
    const at = Math.min(h.at, nowMs);
    if (current === phase) total += Math.max(0, at - since);
    current = h.phase;
    since = Math.max(since, at);
  }
  if (current === phase) total += Math.max(0, nowMs - since);
  return total;
}

/**
 * The guided offer to move on from `phase`: it falls when his total time in the step reaches twice the step's plan.
 * The last step has no next step to offer, so it gets none. Round time stops while paused, so a pause never counts.
 */
export function phaseOverCheckpoint(
  plan: readonly { id: string; minutes: number }[],
  history: readonly { phase: string; at: number }[],
  phase: string,
  nowMs: number,
): Checkpoint | null {
  const index = plan.findIndex((p) => p.id === phase);
  const step = plan[index];
  if (!step || index === plan.length - 1) return null;
  const left = Math.max(0, 2 * step.minutes * MINUTE - timeInPhase(history, plan[0]?.id, phase, nowMs));
  return { id: `phase_over:${phase}`, kind: "phase_over", atMs: nowMs + left, phase };
}

/** Pure: which checkpoints are due now, and when the next one falls. */
export function dueCheckpoints(checkpoints: readonly Checkpoint[], fired: ReadonlySet<string>, nowRoundMs: number): { due: Checkpoint[]; nextAtMs: number | null } {
  const due: Checkpoint[] = [];
  let nextAtMs: number | null = null;
  for (const cp of checkpoints) {
    if (fired.has(cp.id)) continue;
    if (cp.atMs <= nowRoundMs) due.push(cp);
    else if (nextAtMs === null || cp.atMs < nextAtMs) nextAtMs = cp.atMs;
  }
  return { due, nextAtMs };
}

export interface SchedulerOptions {
  checkpoints: readonly Checkpoint[];
  fired: Set<string>;
  roundTime: () => number;
  /** False while paused or ended: nothing fires and no timer is armed. */
  running: () => boolean;
  onDue: (cp: Checkpoint) => void;
}

/** One timer for the next checkpoint, re-armed on every pause, resume and fire. */
export class CheckpointScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: SchedulerOptions) {}

  /** Swaps the list the scheduler reads, for rounds whose checkpoints depend on where the candidate is. */
  setCheckpoints(checkpoints: readonly Checkpoint[]): void {
    this.opts = { ...this.opts, checkpoints };
  }

  reschedule(): void {
    this.stop();
    if (!this.opts.running()) return;
    const now = this.opts.roundTime();
    const { due, nextAtMs } = dueCheckpoints(this.opts.checkpoints, this.opts.fired, now);
    for (const cp of due) {
      this.opts.fired.add(cp.id);
      this.opts.onDue(cp);
      if (!this.opts.running()) return;
    }
    if (nextAtMs !== null) {
      // Timers can fire a little early; a short floor avoids a busy loop when that happens.
      const delay = Math.max(25, nextAtMs - now);
      this.timer = setTimeout(() => this.reschedule(), delay);
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** On restart nothing in the past fires again, except the extension if it was never delivered. */
  static restoreFired(checkpoints: readonly Checkpoint[], nowRoundMs: number, extensionDelivered: boolean): Set<string> {
    const fired = new Set<string>();
    for (const cp of checkpoints) {
      if (cp.atMs > nowRoundMs) continue;
      if (cp.kind === "extension" && !extensionDelivered) continue;
      if (cp.kind === "time_up") continue;
      fired.add(cp.id);
    }
    return fired;
  }
}

/** m:ss with unbounded minutes, as the envelope shows it ("0:05", "12:34", "120:00"). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** mm:ss with at least two minute digits, used in the judge's transcript and evidence times. */
export function formatStamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
