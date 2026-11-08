import type { PublicStepCheck } from "../../shared/types";

export interface RingView {
  /** 0 to 1. */
  fill: number;
  /** Short text inside or beside the ring. */
  label: string;
  /** Full sentence for screen readers and tooltips. */
  spoken: string;
  tone: "none" | "progress" | "done";
}

/**
 * True while a guided round holds a step's checklist back: no check has finished and no items came with it. An empty
 * ring then means "not looked at yet", never "nothing covered".
 */
export function isUnchecked(step: PublicStepCheck | undefined): boolean {
  return !step || (step.checkedAt === null && step.items.length === 0);
}

/** How full a step's ring is: the covered share of its checklist, a partial item counting half. */
export function ringView(step: PublicStepCheck | undefined): RingView {
  if (!step || isUnchecked(step)) {
    return { fill: 0, label: "–", spoken: step?.status === "checking" ? "Checking now" : "Not checked yet", tone: "none" };
  }
  const covered = step.covered;
  const total = Math.max(1, step.total);
  const fill = Math.min(1, (covered + step.partial / 2) / total);
  return {
    fill,
    label: `${Math.round(fill * 100)}%`,
    spoken: `${covered} of ${step.total} checklist items covered${step.partial > 0 ? `, ${step.partial} partly` : ""}`,
    tone: fill >= 0.8 ? "done" : fill > 0 ? "progress" : "none",
  };
}
