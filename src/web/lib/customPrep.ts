import type { CustomProblemJobStatus } from "../../shared/protocol";

type Correction = NonNullable<CustomProblemJobStatus["corrections"]>[number];

/** The checker labels a wording fix by its whole source ("Editorial") or marks it in the fix itself ("(grammar only)"). */
const WORDING_SOURCE = /^\s*(?:editorial(?: edit)?|copy[- ]?edit(?:ing)?|grammar|spelling|typo(?:graphical)?|style(?: only)?|formatting|n\/a)\s*\.?\s*$/i;
const WORDING_FIX =
  /\((?:grammar|spelling|typo|wording|punctuation)(?:\s+(?:only|fix|change|correction)s?)?\)|\b(?:grammar|spelling|punctuation|wording)\s+(?:only|fix|change)\b|\bfor the interviewer\b/i;

export function isFactualCorrection(correction: Pick<Correction, "fix" | "source">): boolean {
  return !WORDING_SOURCE.test(correction.source) && !WORDING_FIX.test(correction.fix);
}

/**
 * The line under a prepared question: what research backed it, and how many facts were checked. A fact is checked
 * when a source backs it or a correction changed it.
 */
export function preparedSummary(job: Pick<CustomProblemJobStatus, "sourcesCount" | "searches" | "pages">, factualCorrections: number): string {
  const sources = job.sourcesCount ?? 0;
  const searched = job.searches + job.pages > 0;
  const research = sources > 0 ? `${sources} ${sources === 1 ? "source" : "sources"}` : searched ? "Searched the web, no source cited" : "No web search was needed";
  const checks = sources + factualCorrections;
  return checks === 0 ? research : `${research}, ${checks} ${checks === 1 ? "fact" : "facts"} checked`;
}

export type PrepStep = "writing" | "checking";

/** Which of the two steps runs. The server keeps its research stage while the writer works, and the writer may search or not. */
export function prepProgress(job: Pick<CustomProblemJobStatus, "stage"> | null): { steps: PrepStep[]; active: PrepStep } {
  return { steps: ["writing", "checking"], active: job?.stage === "checking" ? "checking" : "writing" };
}

/** What the model has looked up so far, whoever asked for it. Null while nothing was looked up. */
export function lookupNote(job: Pick<CustomProblemJobStatus, "searches" | "pages"> | null): string | null {
  if (!job || job.searches + job.pages === 0) return null;
  return `${job.searches} ${job.searches === 1 ? "search" : "searches"}, ${job.pages} ${job.pages === 1 ? "page" : "pages"} read so far.`;
}
