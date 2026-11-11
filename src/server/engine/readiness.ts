import type { Readiness, Session } from "../../shared/types";
import { roundTimeMs } from "./clock";

/** A guided round may run this much longer than its plan before the time itself counts against readiness. */
export const READY_TIME_FACTOR = 1.5;

function list(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The readiness call for a guided round: ready only when every step passed on his own, he took no hint that offered two options,
 * and the round stayed near its plan. It is a fixed rule so the same round always gets the same call.
 */
export function computeReadiness(
  session: Pick<Session, "stepVerdicts" | "assists" | "hints" | "startedAt" | "pausedMs" | "pauseStartedAt" | "endedAt" | "durationMs">,
  plan: readonly { id: string; label: string }[],
  nowMs: number = Date.now(),
): Readiness {
  const reasons: string[] = [];

  const open = plan.filter((p) => session.stepVerdicts?.[p.id]?.verdict !== "pass").map((p) => p.label);
  if (open.length > 0) reasons.push(`${open.length === 1 ? "This step" : "These steps"} did not pass: ${list(open)}.`);

  const assisted = new Set((session.assists ?? []).map((a) => a.phase));
  const assistedLabels = plan.filter((p) => assisted.has(p.id)).map((p) => p.label);
  if (assistedLabels.length > 0) reasons.push(`${list(assistedLabels)} ${assistedLabels.length === 1 ? "was" : "were"} assisted.`);

  const hints = session.hints ?? [];
  const deep = hints.filter((h) => h.level === 3).length;
  if (deep > 0) {
    const which = hints.length === 1 ? "it" : deep === hints.length ? "each of them" : `${deep} of them`;
    reasons.push(`${hints.length === 1 ? "1 hint" : `${hints.length} hints`}, and ${which} gave you two options to pick from.`);
  }

  const activeMin = Math.round(roundTimeMs(session, nowMs) / 60_000);
  const planMin = Math.round(session.durationMs / 60_000);
  if (roundTimeMs(session, nowMs) > session.durationMs * READY_TIME_FACTOR) reasons.push(`The round took ${activeMin} minutes against a ${planMin}-minute plan.`);

  return { call: reasons.length === 0 ? "ready" : "not_yet", reasons };
}
