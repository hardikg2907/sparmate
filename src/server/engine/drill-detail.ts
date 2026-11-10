import {
  DRILL_INFO,
  DRILL_RUBRIC,
  MAX_CLOSED_ROWS,
  type AttemptView,
  type DrillAttempt,
  type DrillDetail,
  type DrillScoreView,
  type DrillType,
  type GymClosedRow,
  type GymSummary,
  type RecentAttemptRow,
  type DrillAttemptRow,
} from "../../shared/drills";
import { drillPoints } from "../../shared/progress";
import type { Problem } from "../../shared/problem";
import { variantEntries } from "./drill-content";
import type { AttemptBody, DrillState } from "./drill-store";

/** What the history needs from the rest of the app: the briefs for titles and the ledger for cost. */
export interface DetailContext {
  problem: (problemId: string) => Problem | undefined;
  costs: ReadonlyMap<string, number>;
}

const problemTitle = (ctx: Pick<DetailContext, "problem">, id: string) => ctx.problem(id)?.meta.title ?? id;

function variantTitle(ctx: Pick<DetailContext, "problem">, problemId: string, variant: string | null): string | null {
  if (!variant) return null;
  const problem = ctx.problem(problemId);
  return (problem ? variantEntries(problem).find((e) => e.id === variant)?.title : undefined) ?? variant;
}

/** The criteria of a saved grade in the rubric's order. A score for a criterion the rubric no longer has is left out. */
export function labelScores(drill: DrillType, scores: readonly { id: string; score: number }[]): DrillScoreView[] {
  return DRILL_RUBRIC[drill].criteria.flatMap((k) => {
    const found = scores.find((s) => s.id === k.id);
    return found ? [{ id: k.id, label: k.label, core: k.core, score: found.score }] : [];
  });
}

/** "News Feed" for a plain problem, "News Feed (Hot spot)" for a problem with one changed constraint. */
function proofLabel(ctx: Pick<DetailContext, "problem">, key: string): string {
  const [problemId = key, variant] = key.split("#");
  const title = problemTitle(ctx, problemId);
  return variant ? `${title} (${variantTitle(ctx, problemId, variant) ?? variant})` : title;
}

type Finished = DrillAttempt & { outcome: NonNullable<DrillAttempt["outcome"]> };

const isFinished = (a: DrillAttempt): a is Finished => a.status === "done" && a.outcome !== null;

/** Newest first. Rows saved in the same instant keep the later row first. */
function newestFirst<T extends { at: string }>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => y.row.at.localeCompare(x.row.at) || y.index - x.index)
    .map((x) => x.row);
}

function attemptRow(a: Finished, ctx: DetailContext): DrillAttemptRow {
  return {
    id: a.id,
    at: a.at,
    problemTitle: problemTitle(ctx, a.problemId),
    variantTitle: variantTitle(ctx, a.problemId, a.variant),
    outcome: a.outcome,
    firstOutcome: a.firstOutcome,
    revised: a.revised,
    scores: labelScores(a.drill, a.scores),
    seconds: a.seconds,
    costUsd: ctx.costs.get(a.id) ?? null,
    legacy: a.legacy,
  };
}

/** One queued drill with the attempts that counted for it, or null for an id that is not in the schedule. */
export function buildDetail(state: DrillState, drillId: string, today: string, ctx: DetailContext): DrillDetail | null {
  const item = state.items.find((i) => i.id === drillId);
  if (!item) return null;
  return {
    today,
    item: {
      id: item.id,
      drill: item.drill,
      title: DRILL_INFO[item.drill].title,
      gapTitle: item.gapTitle,
      status: item.status,
      passes: item.passes,
      dueOn: item.dueOn,
      originProblemTitle: problemTitle(ctx, item.originProblemId),
      problemId: item.problemId,
      problemTitle: problemTitle(ctx, item.problemId),
      variantTitle: variantTitle(ctx, item.problemId, item.variant),
      proofs: item.readyOn.map((key) => proofLabel(ctx, key)),
    },
    attempts: newestFirst(state.attempts.filter((a): a is Finished => isFinished(a) && a.drillId === item.id)).map((a) => attemptRow(a, ctx)),
  };
}

/** The newest finished attempts of every kind, free drills included. An open attempt is never listed. */
export function recentAttempts(state: DrillState, limit: number, ctx: DetailContext): RecentAttemptRow[] {
  return newestFirst(state.attempts.filter(isFinished))
    .slice(0, limit)
    .map((a) => ({ ...attemptRow(a, ctx), drill: a.drill, title: DRILL_INFO[a.drill].title, drillId: a.drillId }));
}

/**
 * A saved attempt for display. The line on what a strong answer says is kept back while a queued drill of the same
 * kind is open, because that drill would ask the candidate the same question again. Fields are copied by name, so
 * nothing else in the saved file can reach the page.
 */
export function attemptView(body: AttemptBody, state: DrillState, today: string): AttemptView {
  const row = state.attempts.find((a) => a.id === body.id);
  // A written attempt can still be revised on its own day, and the line would hand that revision its answer.
  const revisable = row !== undefined && !DRILL_INFO[body.drill].dialogue && !row.revised && row.outcome !== "ready" && row.day === today;
  const showStrong = !revisable && !state.items.some((i) => i.status === "open" && i.drill === body.drill);
  return {
    id: body.id,
    drill: body.drill,
    title: DRILL_INFO[body.drill].title,
    problemTitle: body.problemTitle,
    task: body.task,
    changed: body.changed ?? null,
    answers: body.answers.map((a) => a.text),
    turns: body.turns.map((t) => ({ role: t.role, text: t.text })),
    grades: body.grades.map((g) => ({
      outcome: g.outcome,
      scores: labelScores(body.drill, g.scores),
      wentWell: [...g.wentWell],
      improve: [...g.improve],
      yourLine: g.yourLine,
      ...(showStrong ? (g.strong !== "" ? { strong: g.strong } : { noStrong: true }) : {}),
    })),
  };
}

/** The closed drills, newest first, and the drill points Progress counts. */
export function gymExtras(state: DrillState, today: string, problem: DetailContext["problem"]): Pick<GymSummary, "closed" | "points"> {
  const closed: GymClosedRow[] = state.items
    .filter((i) => i.status === "closed")
    .sort((a, b) => b.dueOn.localeCompare(a.dueOn) || a.id.localeCompare(b.id))
    .slice(0, MAX_CLOSED_ROWS)
    .map((i) => ({
      id: i.id,
      gapTitle: i.gapTitle,
      drill: i.drill,
      title: DRILL_INFO[i.drill].title,
      originProblemTitle: problemTitle({ problem }, i.originProblemId),
      closedOn: i.dueOn,
    }));
  return { closed, points: drillPoints(state.attempts, today, (id) => problem(id)?.meta.track ?? null) };
}
