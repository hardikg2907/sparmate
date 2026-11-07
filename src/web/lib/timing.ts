import type { PublicSession } from "../../shared/types";

type Clock = PublicSession["clock"];

/**
 * Round time in milliseconds at a given server time: wall time since the start, minus every pause so far,
 * including the pause that is still running.
 */
export function roundMsAt(clock: Clock, serverNowMs: number): number {
  const started = Date.parse(clock.startedAt);
  const pausedNow = clock.pauseStartedAt ? Math.max(0, serverNowMs - Date.parse(clock.pauseStartedAt)) : 0;
  return Math.max(0, serverNowMs - started - clock.pausedMs - pausedNow);
}

/** Offset to add to the local clock to get server time, measured when a state message arrives. */
export function clockOffset(clock: Clock, localNowMs: number): number {
  const server = Date.parse(clock.serverNow);
  return Number.isNaN(server) ? 0 : server - localNowMs;
}

/** Round time once the round is over; the clock stops at the end instead of running on. */
export function finalRoundMs(session: Pick<PublicSession, "clock" | "endedAt">): number | null {
  if (!session.endedAt) return null;
  return roundMsAt(session.clock, Date.parse(session.endedAt));
}

type PhaseHistory = PublicSession["phaseHistory"];

/** Milliseconds spent in each phase. A phase can be visited more than once, so segments add up. */
export function phaseSpentMs(
  history: PhaseHistory,
  firstPhase: string | undefined,
  currentPhase: string,
  roundMs: number,
): Record<string, number> {
  const spent: Record<string, number> = {};
  let phase = firstPhase ?? currentPhase;
  let since = 0;
  for (const entry of history) {
    const at = Math.min(Math.max(entry.at, since), roundMs);
    spent[phase] = (spent[phase] ?? 0) + (at - since);
    phase = entry.phase;
    since = at;
  }
  // History can lag a click on the rail, so the live phase wins for the open segment.
  spent[currentPhase] = (spent[currentPhase] ?? 0) + Math.max(0, roundMs - since);
  return spent;
}
