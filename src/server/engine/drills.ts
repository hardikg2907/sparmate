import { randomBytes } from "node:crypto";
import {
  DRILL_INFO,
  addDays,
  DRILL_RUBRIC,
  MAX_ELAPSED_SECONDS,
  ATTEMPT_ID,
  applyOutcome,
  betterOutcome,
  isBetterOutcome,
  byDueDay,
  drillForGap,
  drillsForTrack,
  firstDueDay,
  isDue,
  localDay,
  weekDrillStats,
  type DrillAttempt,
  type DrillItem,
  type DrillType,
  type DrillPrompt,
  type DrillResult,
  type DrillTarget,
  type GymDrillRow,
  type GymSummary,
} from "../../shared/drills";
import type { Problem } from "../../shared/problem";
import type { SessionHistoryItem } from "../../shared/types";
import type { PrivacyGuard } from "../guard/privacy";
import { buildDrill, drillFits, drillsAvailable, type DrillContent } from "./drill-content";
import { GraderOutputSchema, finishGrade, graderMessage, type GradedAnswer } from "./drill-grader";
import type { Driver } from "./driver";
import { DriverError } from "./driver";
import type { DrillState, DrillStore } from "./drill-store";
import { sha256Hex } from "./fsutil";
import { describeError, type Logger } from "./log";
import type { ProblemCatalog } from "./problems";
import { commonVars, type PromptLoader } from "./prompts";
import { HttpError } from "./sessions";
import type { SettingsStore } from "./settings";
import { toApiSchema, toCompatSchema } from "./schemas";

export interface DrillDeps {
  store: DrillStore;
  history: () => readonly SessionHistoryItem[];
  problems: Pick<ProblemCatalog, "reload" | "get">;
  driver: Driver;
  settings: SettingsStore;
  prompts: PromptLoader;
  guard: Pick<PrivacyGuard, "redact">;
  log: Logger;
  /** Replaceable so a test can pin the day. */
  now?: () => Date;
}

/** On the first build only, debriefs older than this many days queue no drills. */
export const BACKFILL_DAYS = 14;

/** A round counts as played once it has ended, because until then its hidden facts are still in use. */
const OVER: ReadonlySet<SessionHistoryItem["status"]> = new Set(["ended", "debriefing", "debriefed", "failed"]);

/** The criteria of a grade with their labels, for the page. */
function describeScores(drill: DrillType, scores: readonly { id: string; score: number }[]): DrillResult["scores"] {
  return DRILL_RUBRIC[drill].criteria.map((k) => ({ id: k.id, label: k.label, core: k.core, score: scores.find((s) => s.id === k.id)?.score ?? 1 }));
}

/** The id of a queued drill. It comes from the round and the gap, so the same gap is never queued twice. */
export function drillItemId(sessionId: string, gapTitle: string): string {
  return sha256Hex(`${sessionId}\n${gapTitle}`).slice(0, 16);
}

/**
 * Queues one drill for every scorecard gap that has one, the day after its debrief. Rounds already seen are skipped,
 * and so is a gap that already has an open drill on the same problem. Returns whether a drill was added; the caller also saves a newly set `backfilledOn`.
 */
export function queueGapDrills(draft: DrillState, history: readonly SessionHistoryItem[], problems: ReadonlyMap<string, Problem>, today: string): boolean {
  let added = false;
  // Only the first build looks back a limited time, so rounds from before the Gym existed do not flood it. After that
  // every round debriefed since the first build queues, however long the candidate stayed away. A file from before the
  // marker existed counts as built already; it takes its marker from its oldest drill.
  const firstBuild = draft.backfilledOn === undefined && draft.items.length === 0 && draft.attempts.length === 0;
  const oldest = firstBuild ? addDays(today, -BACKFILL_DAYS) : (draft.backfilledOn ?? draft.items.map((i) => i.createdOn).sort()[0] ?? today);
  if (draft.backfilledOn === undefined) {
    draft.backfilledOn = firstBuild ? today : oldest;
  }
  const known = new Set(draft.items.map((i) => i.id));
  for (const round of history) {
    if (round.status !== "debriefed" || !round.gaps?.length) continue;
    const problem = problems.get(round.problemId);
    if (!problem) continue;
    const debriefDay = localDay(new Date(round.endedAt ?? round.createdAt));
    if (debriefDay < oldest) continue;
    // A round queued late, such as one that was debriefed before the Gym existed, falls due today and never days ago.
    const first = firstDueDay(debriefDay);
    const dueOn = first < today ? today : first;
    for (const gap of round.gaps) {
      const drill = drillForGap({ title: gap.title, ...(gap.whyItMatters ? { whyItMatters: gap.whyItMatters } : {}), drill: gap.drill }, round.track);
      if (!drill || !drillFits(problem, drill)) continue;
      const id = drillItemId(round.id, gap.title);
      if (known.has(id)) continue;
      const repeat = draft.items.some((i) => i.status === "open" && i.problemId === round.problemId && i.drill === drill && i.gapTitle === gap.title);
      known.add(id);
      if (repeat) continue;
      draft.items.push({
        id,
        sessionId: round.id,
        problemId: round.problemId,
        originProblemId: round.problemId,
        variant: null,
        readyOn: [],
        gapTitle: gap.title.slice(0, 600),
        gapHint: (gap.whyItMatters ?? gap.goodLooksLike).slice(0, 1200),
        drill,
        createdOn: first,
        dueOn,
        passes: 0,
        status: "open",
      });
      added = true;
    }
  }
  return added;
}

/** Problems a drill may use: any problem with a finished round, and every custom problem. A live or paused round never counts, so a drill cannot show its hidden facts. */
export function playableProblems(all: readonly Problem[], history: readonly Pick<SessionHistoryItem, "problemId" | "status">[]): Problem[] {
  const played = new Set(history.filter((h) => OVER.has(h.status)).map((h) => h.problemId));
  return all.filter((p) => p.custom || played.has(p.meta.id));
}

function asRow(item: DrillItem, problem: Problem, today: string, rotation: number): GymDrillRow {
  const content = buildDrill(problem, item.drill, { gapTitle: item.gapTitle, hint: item.gapHint, rotation });
  return {
    id: item.id,
    gapTitle: item.gapTitle,
    topic: content?.prompt.topic ?? null,
    drill: item.drill,
    title: DRILL_INFO[item.drill].title,
    problemId: item.problemId,
    problemTitle: problem.meta.title,
    minutes: DRILL_INFO[item.drill].minutes,
    dueOn: item.dueOn,
    due: isDue(item, today),
    passes: item.passes,
    task: content?.prompt.task ?? "",
  };
}

export class DrillService {
  constructor(private readonly deps: DrillDeps) {}

  private today(): string {
    return localDay((this.deps.now ?? (() => new Date()))());
  }

  /** The problems a drill may use right now, loaded fresh so a custom problem shows at once. */
  private async playable(): Promise<Map<string, Problem>> {
    const all = await this.deps.problems.reload();
    return new Map(playableProblems(all, this.deps.history()).map((p) => [p.meta.id, p]));
  }

  private async sync(problems: ReadonlyMap<string, Problem>): Promise<DrillState> {
    const history = this.deps.history();
    const today = this.today();
    await this.deps.store.update((draft) => {
      const marked = draft.backfilledOn;
      const added = queueGapDrills(draft, history, problems, today);
      return { save: added || draft.backfilledOn !== marked, value: null };
    });
    return this.deps.store.snapshot();
  }

  async summary(): Promise<GymSummary> {
    const problems = await this.playable();
    const state = await this.sync(problems);
    const today = this.today();
    const queue = state.items
      .filter((i) => i.status === "open" && problems.has(i.problemId))
      .sort(byDueDay)
      .map((i) =>
        asRow(i, problems.get(i.problemId) as Problem, today, state.attempts.filter((a) => a.status === "done" && a.problemId === i.problemId && a.drill === i.drill).length),
      );
    return {
      today,
      queue,
      dueCount: queue.filter((r) => r.due).length,
      problems: [...problems.values()]
        .map((p) => ({ id: p.meta.id, title: p.meta.title, track: p.meta.track, drills: drillsAvailable(p) }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      week: weekDrillStats(state.attempts, (this.deps.now ?? (() => new Date()))()),
    };
  }

  /** Finds the problem and checks the drill fits it. Throws a 404 for anything the candidate may not drill. */
  private async resolve(target: DrillTarget, state: DrillState): Promise<{ problem: Problem; item: DrillItem | null; content: DrillContent }> {
    const problems = await this.playable();
    const problem = problems.get(target.problemId);
    if (!problem) throw new HttpError(404, "That problem is not available for drills yet. Play a round on it first.");
    if (!drillsForTrack(problem.meta.track).includes(target.drill)) throw new HttpError(400, "That drill does not fit this problem.");
    const item = this.matchItem(state, target, this.today());
    const rotation = state.attempts.filter((a) => a.status === "done" && a.problemId === problem.meta.id && a.drill === target.drill).length;
    const content = buildDrill(problem, target.drill, { ...(item ? { gapTitle: item.gapTitle, hint: item.gapHint } : {}), rotation });
    if (!content) throw new HttpError(400, "This problem has no material for that drill.");
    return { problem, item, content };
  }

  /** The queued drill an attempt may count for: the one named, or else the earliest due one of the same kind on the problem. */
  private matchItem(state: DrillState, target: DrillTarget, today: string): DrillItem | null {
    if (target.drillId) {
      const named = state.items.find((i) => i.id === target.drillId);
      if (!named || named.status !== "open" || named.problemId !== target.problemId || named.drill !== target.drill) {
        throw new HttpError(404, "That drill is no longer in the queue.");
      }
      return named;
    }
    // A free drill counts only for a queued one that is due, so practising early cannot rush a gap to closed.
    return state.items.filter((i) => isDue(i, today) && i.problemId === target.problemId && i.drill === target.drill).sort(byDueDay)[0] ?? null;
  }

  async prompt(target: DrillTarget): Promise<DrillPrompt> {
    const problems = await this.playable();
    const state = await this.sync(problems);
    const { content } = await this.resolve(target, state);
    return content.prompt;
  }

  /** Drills being graded right now, so a second submit for the same drill cannot score it twice. */
  private readonly grading = new Set<string>();

  async submit(target: DrillTarget, answer: string, elapsedSeconds?: number): Promise<DrillResult> {
    if (answer.trim() === "") throw new HttpError(400, "Write an answer first.");
    const key = target.drillId ?? `${target.drill}:${target.problemId}`;
    if (this.grading.has(key)) throw new HttpError(409, "This drill is already being graded. Wait for the result.");
    this.grading.add(key);
    try {
      return await this.submitNow(target, answer, elapsedSeconds);
    } finally {
      this.grading.delete(key);
    }
  }

  private async submitNow(target: DrillTarget, answer: string, elapsedSeconds?: number): Promise<DrillResult> {
    const problems = await this.playable();
    const state = await this.sync(problems);
    const { problem, content } = await this.resolve(target, state);
    const clock = this.deps.now ?? (() => new Date());
    const opened = clock();
    const attemptId = randomBytes(8).toString("hex");

    // The row exists before the grader runs, so an attempt that is cut off still leaves a trace in the index.
    await this.deps.store.update((draft) => {
      draft.attempts.push({
        id: attemptId,
        at: opened.toISOString(),
        day: localDay(opened),
        drill: target.drill,
        problemId: target.problemId,
        variant: null,
        drillId: null,
        status: "open",
        outcome: null,
        firstOutcome: null,
        revised: false,
        scores: [],
        seconds: null,
        legacy: false,
      });
      return { save: true, value: null };
    });

    let graded: GradedAnswer;
    try {
      graded = await this.grade(problem, content, answer, attemptId, target.drill);
      await this.deps.store.writeBody({
        version: 1,
        id: attemptId,
        drill: target.drill,
        problemId: problem.meta.id,
        problemTitle: problem.meta.title.slice(0, 300),
        task: content.prompt.task.slice(0, 2000),
        topic: content.prompt.topic?.slice(0, 300) ?? null,
        answers: [{ at: opened.toISOString(), text: answer }],
        turns: [],
        grades: [
          {
            at: clock().toISOString(),
            outcome: graded.outcome,
            scores: graded.scores,
            wentWell: graded.wentWell,
            improve: graded.improve,
            yourLine: graded.yourLine,
            strong: graded.strong,
          },
        ],
      });
    } catch (err) {
      await this.dropOpen(attemptId);
      throw err;
    }
    const today = localDay(clock());

    return this.deps.store.update((draft) => {
      // The queue may have changed while the grader worked, so the match is made again on the saved state.
      const item = this.matchLive(draft, target, today);
      let readyCount: number | null = null;
      let closed = false;
      let nextDueOn: string | null = null;
      let itemBefore: DrillAttempt["itemBefore"];
      // An attempt before the drill's day is practice: it is logged and changes nothing.
      const counts = item !== null && isDue(item, today);
      if (item && counts) {
        itemBefore = { passes: item.passes, readyOn: [...item.readyOn] };
        const next = applyOutcome({ passes: item.passes, readyOn: item.readyOn, outcome: graded.outcome, revised: false, problemId: target.problemId, today });
        item.passes = next.passes;
        item.readyOn = next.readyOn;
        item.dueOn = next.dueOn;
        item.status = next.status;
        readyCount = next.passes;
        closed = next.status === "closed";
        nextDueOn = closed ? null : next.dueOn;
      }
      const row = draft.attempts.find((a) => a.id === attemptId);
      if (row) {
        row.status = "done";
        row.outcome = graded.outcome;
        row.scores = graded.scores;
        row.drillId = counts ? (item?.id ?? null) : null;
        row.seconds = elapsedSeconds ?? null;
        if (itemBefore) row.itemBefore = itemBefore;
      }
      const result: DrillResult = {
        attemptId,
        outcome: graded.outcome,
        firstOutcome: null,
        revised: false,
        scores: describeScores(target.drill, graded.scores),
        wentWell: graded.wentWell,
        improve: graded.improve,
        yourLine: graded.yourLine,
        canRevise: graded.outcome !== "ready",
        readyCount,
        closed,
        nextDueOn,
        next: this.nextDue(draft, problems, today, counts ? item?.id : undefined),
      };
      return { save: true, value: result };
    });
  }

  private nextDue(draft: DrillState, problems: ReadonlyMap<string, Problem>, today: string, exceptId?: string): DrillTarget | null {
    const other = draft.items.filter((i) => i.id !== exceptId && isDue(i, today) && problems.has(i.problemId)).sort(byDueDay)[0];
    return other ? { drill: other.drill, problemId: other.problemId, drillId: other.id } : null;
  }

  /**
   * Grades one revised answer for a finished attempt. The attempt keeps its first scores; the final outcome is the
   * better of the two, and a better one moves the queued drill's schedule as if the revised answer had come first,
   * with the ready count capped so a revision never closes a drill.
   */
  async revise(attemptId: string, answer: string, elapsedSeconds?: number): Promise<DrillResult> {
    if (answer.trim() === "") throw new HttpError(400, "Write an answer first.");
    if (!ATTEMPT_ID.test(attemptId)) throw new HttpError(404, "That attempt was not found.");
    const key = `revise:${attemptId}`;
    if (this.grading.has(key)) throw new HttpError(409, "This answer is already being graded. Wait for the result.");
    this.grading.add(key);
    try {
      return await this.reviseNow(attemptId, answer, elapsedSeconds);
    } finally {
      this.grading.delete(key);
    }
  }

  private checkRevisable(row: DrillAttempt | undefined, today: string): DrillAttempt {
    if (!row) throw new HttpError(404, "That attempt was not found.");
    if (row.status !== "done" || row.legacy) throw new HttpError(409, "This attempt cannot be revised.");
    if (row.revised) throw new HttpError(409, "This attempt was already revised.");
    if (row.outcome === "ready" || row.outcome === null) throw new HttpError(409, "This answer is already interview-ready, so there is nothing to revise.");
    if (row.day !== today) throw new HttpError(409, "A revision must come on the same day as the attempt.");
    return row;
  }

  private async reviseNow(attemptId: string, answer: string, elapsedSeconds?: number): Promise<DrillResult> {
    const clock = this.deps.now ?? (() => new Date());
    const problems = await this.playable();
    const state = await this.sync(problems);
    this.checkRevisable(
      state.attempts.find((a) => a.id === attemptId),
      localDay(clock()),
    );
    const body = await this.deps.store.readBody(attemptId);
    const firstGrade = body?.grades[0];
    const firstAnswer = body?.answers[0];
    if (!body || !firstGrade || !firstAnswer) throw new HttpError(409, "This attempt cannot be revised.");
    const problem = problems.get(body.problemId);
    if (!problem) throw new HttpError(404, "That problem is not available for drills yet. Play a round on it first.");
    const content = buildDrill(problem, body.drill, { ...(body.topic ? { topic: body.topic } : {}) });
    if (!content) throw new HttpError(400, "This problem has no material for that drill.");

    const opened = clock();
    const graded = await this.grade(problem, content, answer, attemptId, body.drill);
    const better = isBetterOutcome(graded.outcome, firstGrade.outcome);
    const finalOutcome = betterOutcome(firstGrade.outcome, graded.outcome);
    await this.deps.store.writeBody({
      ...body,
      answers: [firstAnswer, { at: opened.toISOString(), text: answer }],
      grades: [
        firstGrade,
        {
          at: clock().toISOString(),
          outcome: graded.outcome,
          scores: graded.scores,
          wentWell: graded.wentWell,
          improve: graded.improve,
          yourLine: graded.yourLine,
          strong: graded.strong,
        },
      ],
    });
    const today = localDay(clock());

    return this.deps.store.update((draft) => {
      const live = this.checkRevisable(
        draft.attempts.find((a) => a.id === attemptId),
        today,
      );
      let readyCount: number | null = null;
      let closed = false;
      let nextDueOn: string | null = null;
      const item = live.drillId ? draft.items.find((i) => i.id === live.drillId) : undefined;
      if (item && item.status === "open" && live.itemBefore && better) {
        const next = applyOutcome({ ...live.itemBefore, outcome: finalOutcome, revised: true, problemId: live.problemId, today });
        item.passes = next.passes;
        item.readyOn = next.readyOn;
        item.dueOn = next.dueOn;
        item.status = next.status;
      }
      if (item) {
        readyCount = item.passes;
        closed = item.status === "closed";
        nextDueOn = closed ? null : item.dueOn;
      }
      live.revised = true;
      live.firstOutcome = live.outcome;
      live.outcome = finalOutcome;
      if (elapsedSeconds !== undefined || live.seconds !== null) live.seconds = Math.min(MAX_ELAPSED_SECONDS, (live.seconds ?? 0) + (elapsedSeconds ?? 0));
      const shown = graded.outcome === finalOutcome ? graded : firstGrade;
      const result: DrillResult = {
        attemptId,
        outcome: finalOutcome,
        firstOutcome: live.firstOutcome,
        revised: true,
        scores: describeScores(body.drill, shown.scores),
        wentWell: shown.wentWell,
        improve: shown.improve,
        yourLine: shown.yourLine,
        canRevise: false,
        readyCount,
        closed,
        nextDueOn,
        next: this.nextDue(draft, problems, today, item?.id),
      };
      return { save: true, value: result };
    });
  }

  /** Removes the open row of an attempt that never got a grade. A failed save is logged so the grader's error still reaches the caller. */
  private async dropOpen(attemptId: string): Promise<void> {
    try {
      await this.deps.store.update((draft) => {
        draft.attempts = draft.attempts.filter((a) => a.id !== attemptId);
        return { save: true, value: null };
      });
    } catch (err) {
      this.deps.log.warn(`Could not remove the open drill attempt ${attemptId}: ${describeError(err)}`);
    }
  }

  private matchLive(draft: DrillState, target: DrillTarget, today: string): DrillItem | null {
    try {
      return this.matchItem(draft, target, today);
    } catch {
      return null;
    }
  }

  private async grade(problem: Problem, content: DrillContent, answer: string, attemptId: string, drill: DrillTarget["drill"]): Promise<GradedAnswer> {
    const settings = this.deps.settings.get();
    const text = graderMessage(content.prompt, content.key, answer);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.deps.driver.runOnce({
          role: "grader",
          model: settings.models.grader,
          effort: settings.effort.grader,
          systemPrompt: async () =>
            this.deps.prompts.render(
              "drill-grader",
              commonVars({
                date: localDay(new Date()),
                problemTitle: problem.meta.title,
                track: problem.meta.track,
                mode: "guided",
                durationMin: content.prompt.minutes,
                candidateProfile: await this.deps.prompts.candidateProfile(),
              }),
            ),
          tools: [],
          fake: { problem, track: problem.meta.track, drill: { kind: drill, key: content.key, answer } },
          usage: { sessionId: null, problemId: problem.meta.id, track: problem.meta.track, mode: null, drillAttemptId: attemptId, drillKind: drill },
          turn: { text, meta: { kind: "oneshot", candidateText: answer } },
          output: { schema: GraderOutputSchema, jsonSchema: toApiSchema(GraderOutputSchema), fallbackJsonSchema: toCompatSchema(GraderOutputSchema) },
          maxTurns: 3,
        });
        if (!res.output) throw new DriverError("The grader returned nothing.");
        return finishGrade(res.output, answer, { drill, key: content.key, redact: (text) => this.deps.guard.redact(text) });
      } catch (err) {
        this.deps.log.warn(`Drill grader attempt ${attempt + 1} failed for ${problem.meta.id}: ${err instanceof DriverError ? err.detail : describeError(err)}`);
      }
    }
    throw new HttpError(502, "The grader did not answer. Your answer is still in the box. Try again.");
  }
}
