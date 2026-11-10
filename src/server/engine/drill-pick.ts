import { proofKey, type DrillAttempt, type DrillItem } from "../../shared/drills";
import type { Problem } from "../../shared/problem";
import { deepDiveEntries, drillFits, matchDeepDive, variantEntries, variantsFor } from "./drill-content";

/** Where the next attempt of a queued drill goes: a problem, and a changed constraint of it or null. */
export interface DrillPick {
  problemId: string;
  variant: string | null;
}

type Playable = ReadonlyMap<string, Problem>;
type PickItem = Pick<DrillItem, "id" | "drill" | "gapTitle" | "gapHint" | "originProblemId" | "problemId" | "variant">;
type PickAttempt = Pick<DrillAttempt, "drill" | "problemId" | "variant" | "drillId" | "status">;

/**
 * The problems a drill may use for this item: playable problems of its track that have the material for the kind.
 * A deep dive also needs an entry whose title shares a word with the gap's title, so a repeat never lands on an unrelated topic.
 */
export function pickPool(item: PickItem, problems: Playable): Problem[] {
  return [...problems.values()].filter((p) => drillFits(p, item.drill) && (item.drill !== "deep_dive" || matchDeepDive(deepDiveEntries(p), item.gapTitle, item.gapHint) !== null));
}

function countedAttempts(item: Pick<DrillItem, "id">, attempts: readonly PickAttempt[]): PickAttempt[] {
  return attempts.filter((a) => a.status === "done" && a.drillId === item.id);
}

/** Whether the saved pick can still be played: the problem is playable, fits, and a variant is still in the brief. */
export function isPickValid(item: PickItem, problems: Playable): boolean {
  const problem = problems.get(item.problemId);
  if (!problem || !drillFits(problem, item.drill)) return false;
  return item.variant === null || variantEntries(problem).some((e) => e.id === item.variant);
}

/** The last counted attempt of an item, in the order the attempts were saved. */
function lastCounted(item: Pick<DrillItem, "id">, attempts: readonly PickAttempt[]): PickAttempt | undefined {
  return countedAttempts(item, attempts).at(-1);
}

/**
 * Staying on one problem alternates between its proofs: the plain problem and each changed constraint. It takes the
 * one this item used least, a tie going to the last one in brief order, and never the proof of the last counted attempt
 * while another exists.
 */
function stayOn(problem: Problem, drill: DrillItem["drill"], counted: readonly PickAttempt[]): DrillPick {
  const id = problem.meta.id;
  const proofs: (string | null)[] = [null, ...variantsFor(problem, drill).map((e) => e.id)];
  const here = counted.filter((a) => a.problemId === id);
  const last = counted.at(-1);
  const lastProof = last?.problemId === id ? last.variant : undefined;
  const open = proofs.filter((v) => v !== lastProof);
  let best: string | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const variant of open.length > 0 ? open : proofs) {
    const count = here.filter((a) => a.variant === variant).length;
    if (count <= bestCount) {
      best = variant;
      bestCount = count;
    }
  }
  return { problemId: id, variant: best };
}

/**
 * Picks the next attempt for a queued drill. The first attempt is the origin problem. Each repeat leaves the problem of
 * the last counted attempt: it takes a problem this item never used, else the one used longest ago, else the one with
 * the fewest finished attempts of this kind, else the lowest id. With nothing else to offer it stays on that problem
 * and alternates between the plain problem and its changed constraints (see `stayOn`). Null when no playable problem
 * fits the drill at all.
 */
export function pickNext(item: PickItem, problems: Playable, attempts: readonly PickAttempt[]): DrillPick | null {
  const counted = countedAttempts(item, attempts);
  const last = counted.at(-1);
  const origin = problems.get(item.originProblemId);
  const originFits = origin !== undefined && drillFits(origin, item.drill);
  if (!last && origin && originFits) return { problemId: origin.meta.id, variant: null };

  const usedAt = new Map<string, number>();
  counted.forEach((a, index) => usedAt.set(a.problemId, index));
  const finished = (id: string) => attempts.filter((a) => a.status === "done" && a.drill === item.drill && a.problemId === id).length;
  const candidates = pickPool(item, problems)
    .filter((p) => p.meta.id !== last?.problemId)
    .sort((a, b) => {
      const ua = usedAt.get(a.meta.id) ?? -1;
      const ub = usedAt.get(b.meta.id) ?? -1;
      return ua - ub || finished(a.meta.id) - finished(b.meta.id) || a.meta.id.localeCompare(b.meta.id);
    });
  const first = candidates[0];
  if (first) return { problemId: first.meta.id, variant: null };

  const stay = (last ? problems.get(last.problemId) : undefined) ?? (originFits ? origin : undefined);
  if (stay && drillFits(stay, item.drill)) return stayOn(stay, item.drill, counted);
  const any = [...problems.values()].filter((p) => drillFits(p, item.drill)).sort((a, b) => a.meta.id.localeCompare(b.meta.id))[0];
  return any ? { problemId: any.meta.id, variant: null } : null;
}

/** True when the next pick asks a proof the item has not earned yet: `earned` holds its ready proofs and the one just played. */
export function canVaryFrom(pick: DrillPick | null, earned: readonly string[]): boolean {
  return pick !== null && !earned.includes(proofKey(pick.problemId, pick.variant));
}

/**
 * Picks again for every open item whose saved pick can no longer be played, or that repeats the proof of its last
 * counted attempt while the picker can offer another. Returns whether anything changed.
 */
export function repickStale(items: DrillItem[], attempts: readonly PickAttempt[], problems: Playable): boolean {
  let changed = false;
  for (const item of items) {
    if (item.status !== "open") continue;
    const last = lastCounted(item, attempts);
    const repeats = last !== undefined && proofKey(last.problemId, last.variant) === proofKey(item.problemId, item.variant);
    if (isPickValid(item, problems) && !repeats) continue;
    const pick = pickNext(item, problems, attempts);
    if (!pick || (pick.problemId === item.problemId && pick.variant === item.variant)) continue;
    item.problemId = pick.problemId;
    item.variant = pick.variant;
    changed = true;
  }
  return changed;
}
