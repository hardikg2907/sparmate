import type { PublicStepCheck, PublicStepItem } from "../../shared/types";
import { formatClock } from "./format";

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

/** The size of a step nobody has checked: "1 thing to cover." */
export function coverText(total: number): string {
  return total === 1 ? "1 thing to cover." : `${total} things to cover.`;
}

/** Where an item was covered, in the words the checklist shows: "said at 04:12", "on the board", "in the code". */
export function whereText(item: PublicStepItem): string {
  if (item.state === "missing") return "Not yet";
  const where = item.source === "chat" && item.at !== null ? `said at ${formatClock(item.at)}` : item.source === "code" ? "in the code" : "on the board";
  return item.state === "partial" ? `Partly, ${where}${item.detail ? `: ${item.detail}` : ""}` : where.charAt(0).toUpperCase() + where.slice(1);
}

/** "12 s ago" or "3 min ago", from round times. */
export function checkedAgo(checkedAt: number, roundMs: number): string {
  const sec = Math.max(0, Math.round((roundMs - checkedAt) / 1000));
  return sec < 60 ? `${sec} s ago` : `${Math.floor(sec / 60)} min ago`;
}
