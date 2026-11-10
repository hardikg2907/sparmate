import type { CustomProblemJobStatus } from "../../shared/protocol";

type Correction = NonNullable<CustomProblemJobStatus["corrections"]>[number];

/** A fix of wording, spelling or layout is not a correction of a fact, whatever source the model gave it. */
const NOT_A_FACT = /\b(editorial|grammar|grammatical|typo|spelling|punctuation|wording|phrasing|style|formatting)\b/i;

export function isFactualCorrection(correction: Pick<Correction, "fix" | "source">): boolean {
  return !NOT_A_FACT.test(correction.source) && !NOT_A_FACT.test(correction.fix);
}

/** The line under a prepared question: what research backed it, and how many facts were checked. */
export function preparedSummary(job: Pick<CustomProblemJobStatus, "sourcesCount" | "checksCount">): string {
  const sources = job.sourcesCount ?? 0;
  const checks = job.checksCount ?? 0;
  const searched = sources === 0 ? "No web search was needed" : `${sources} ${sources === 1 ? "source" : "sources"}`;
  return checks === 0 ? searched : `${searched}, ${checks} ${checks === 1 ? "fact" : "facts"} checked`;
}

export type PrepStep = "research" | "writing" | "checking";

/**
 * The steps to list while a brief is prepared, and the one that is running. The research step shows only once a search
 * or a page read has happened, because the writer may need none, and a stage that never did anything is not shown.
 */
export function prepProgress(job: Pick<CustomProblemJobStatus, "stage" | "searches" | "pages"> | null): { steps: PrepStep[]; active: PrepStep } {
  const researched = job !== null && job.searches + job.pages > 0;
  const steps: PrepStep[] = researched ? ["research", "writing", "checking"] : ["writing", "checking"];
  if (job?.stage === "checking") return { steps, active: "checking" };
  if (job?.stage === "researching" && researched) return { steps, active: "research" };
  return { steps, active: "writing" };
}
