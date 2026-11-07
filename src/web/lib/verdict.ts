import { VERDICTS, type Verdict } from "../../shared/types";

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

export function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value);
}
