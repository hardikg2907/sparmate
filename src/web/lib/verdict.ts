import type { Mode } from "../../shared/phases";
import { VERDICTS, type Readiness, type Verdict } from "../../shared/types";
import { VERDICT_TONE, type Tone } from "./format";

/**
 * What each verdict is called on screen, and what it means in one plain sentence. The stored values (`hire` and the
 * rest) are the judge's own terms and stay as they are; every place that shows a verdict reads its words from here.
 */
export const VERDICT_LABEL: Record<Verdict, string> = {
  strong_hire: "Strong pass",
  hire: "Pass",
  lean_no_hire: "Close, not yet",
  no_hire: "Not yet",
};

export const VERDICT_EXPLANATION: Record<Verdict, string> = {
  strong_hire: "An interviewer would pass this round with confidence, and you showed more than the bar asks.",
  hire: "An interviewer would likely pass this round. You met the bar.",
  lean_no_hire: "An interviewer would likely not pass this round, but one or two fixes would change that.",
  no_hire: "An interviewer would not pass this round. Several parts fell below the bar.",
};

/** The label, then its explanation, for text that has no room for a separate line. */
export function verdictSentence(verdict: Verdict): string {
  return `${VERDICT_LABEL[verdict]}: ${VERDICT_EXPLANATION[verdict]}`;
}

/** The debrief's headline for a guided round, in place of a hire verdict. */
export const READINESS_TITLE: Record<Readiness["call"], string> = { ready: "Ready for interview mode", not_yet: "Not yet ready for interview mode" };

export const READINESS_LABEL: Record<Readiness["call"], string> = { ready: "Ready", not_yet: "Not yet" };

/**
 * The badge for a past attempt. A guided round that has a readiness call shows it instead of a hire verdict; one
 * saved before the call existed keeps its verdict.
 */
export function attemptBadge(a: { mode: Mode; verdict: Verdict | null; readiness?: Readiness["call"] | null }): { label: string; tone: Tone } | null {
  if (a.mode === "guided" && a.readiness) return { label: READINESS_LABEL[a.readiness], tone: a.readiness === "ready" ? "good" : "warn" };
  return a.verdict ? { label: VERDICT_LABEL[a.verdict], tone: VERDICT_TONE[a.verdict] } : null;
}

export function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value);
}
