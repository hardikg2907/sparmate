import { randomBytes } from "node:crypto";
import {
  DRILL_INFO,
  addDays,
  DRILL_RUBRIC,
  MAX_ELAPSED_SECONDS,
  MAX_FOLLOW_UPS,
  ATTEMPT_ID,
  CONVERSATION_MOVED,
  DRILL_IN_PROGRESS,
  applyOutcome,
  betterOutcome,
  isBetterOutcome,
  byDueDay,
  drillForGap,
  drillsForTrack,
  firstDueDay,
  isDue,
  localDay,
  proofKey,
  weekDrillStats,
  type DrillAttempt,
  type DrillItem,
  type DrillType,
  type DrillPrompt,
  type DrillResult,
  type DrillTarget,
  type DrillTurn,
  type DrillTurnResponse,
  type GymDrillRow,
  type WrittenDrill,
  type GymSummary,
} from "../../shared/drills";
import type { Problem } from "../../shared/problem";
import type { SessionHistoryItem } from "../../shared/types";
import type { PrivacyGuard } from "../guard/privacy";
import type { AttemptView, DrillDetail, RecentAttemptRow } from "../../shared/drills";
import { attemptView, buildDetail, gymExtras, recentAttempts, type DetailContext } from "./drill-detail";
import { buildDrill, drillFits, drillsAvailable, topicTitles, variantEntries, type DrillContent } from "./drill-content";
import { canVaryFrom, pickNext, repickStale } from "./drill-pick";
import {
  FALLBACK_QUESTION,
  FirstQuestionSchema,
  GraderOutputSchema,
  NextQuestionSchema,
  finishGrade,
  followUpMessage,
  graderMessage,
  reviewQuestion,
  salvageQuestion,
  type GradedAnswer,
  type RejectedQuestion,
} from "./drill-grader";
import type { Driver, FakeFacts } from "./driver";
import { DriverError } from "./driver";
import type { AttemptBody, DrillState, DrillStore } from "./drill-store";
import { sha256Hex } from "./fsutil";
import { describeError, type Logger } from "./log";
import type { ProblemCatalog } from "./problems";
import { commonVars, type PromptLoader } from "./prompts";
import { HttpError } from "./sessions";
import type { SettingsStore } from "./settings";
import { toApiSchema, toCompatSchema } from "./schemas";
import type { z } from "zod";

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
  /** Cost in dollars by drill attempt id, read from the usage ledger. Without it no attempt shows a cost. */
  costs?: () => Promise<ReadonlyMap<string, number>>;
}

const MOVED = "This drill moved to another problem. Open it again from Practice.";
const CANNOT_CONTINUE = "This conversation cannot continue. Start the drill again.";
const isDialogue = (drill: DrillType) => DRILL_INFO[drill].dialogue === true;

/** On the first build only, debriefs older than this many days queue no drills. */
export const BACKFILL_DAYS = 14;

/** A round counts as played once it has ended, because until then its hidden facts are still in use. */
const OVER: ReadonlySet<SessionHistoryItem["status"]> = new Set(["ended", "debriefing", "debriefed", "failed"]);

/** The criteria of a grade with their labels, for the page. A grade saved before a criterion existed shows only the criteria it has. */
function describeScores(drill: DrillType, scores: readonly { id: string; score: number }[]): DrillResult["scores"] {
  return DRILL_RUBRIC[drill].criteria
    .filter((k) => !k.added || scores.some((s) => s.id === k.id))
    .map((k) => ({ id: k.id, label: k.label, core: k.core, score: scores.find((s) => s.id === k.id)?.score ?? 1 }));
}

function gradeRecord(graded: GradedAnswer, at: Date): AttemptBody["grades"][number] {
  return {
    at: at.toISOString(),
    outcome: graded.outcome,
    scores: graded.scores,
    wentWell: graded.wentWell,
    improve: graded.improve,
    yourLine: graded.yourLine,
    strong: graded.strong,
  };
}

/** Adds the time of one call to the time an attempt already holds, never above the longest a drill may report. */
function addSeconds(current: number | null, more: number | undefined): number | null {
  if (more === undefined && current === null) return null;
  return Math.min(MAX_ELAPSED_SECONDS, (current ?? 0) + (more ?? 0));
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
      const drill = drillForGap(
        { title: gap.title, ...(gap.whyItMatters ? { whyItMatters: gap.whyItMatters } : {}), drill: gap.drill, aboutTheRound: gap.aboutTheRound },
        round.track,
      );
      if (!drill || !drillFits(problem, drill)) continue;
      const id = drillItemId(round.id, gap.title);
      if (known.has(id)) continue;
      const repeat = draft.items.some((i) => i.status === "open" && i.originProblemId === round.problemId && i.drill === drill && i.gapTitle === gap.title);
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

/**
 * What a gap's topic rotates on when its title matches none. A queued drill moves on after each attempt that counted
 * for it, so its topic holds until one is done. A free drill moves on after each finished attempt on the problem.
 */
function rotationOf(attempts: readonly DrillAttempt[], target: DrillTarget, item: DrillItem | null): number {
  const done = attempts.filter((a) => a.status === "done");
  if (target.drillId && item) return done.filter((a) => a.drillId === item.id).length;
  return done.filter((a) => a.problemId === target.problemId && a.drill === target.drill).length;
}

/** What a drill shows the candidate: words from it are never a giveaway of the key. */
function shownText(content: DrillContent): string {
  return [content.prompt.problem.title, content.prompt.task, ...content.prompt.material.map((m) => m.markdown)].join("\n");
}

function asRow(item: DrillItem, problem: Problem, originTitle: string, today: string, attempts: readonly DrillAttempt[]): GymDrillRow {
  const rotation = rotationOf(attempts, { drill: item.drill, problemId: item.problemId, drillId: item.id }, item);
  const content = buildDrill(problem, item.drill, { gapTitle: item.gapTitle, hint: item.gapHint, rotation, ...(item.variant ? { variant: item.variant } : {}) });
  return {
    id: item.id,
    gapTitle: item.gapTitle,
    topic: content?.prompt.topic ?? null,
    drill: item.drill,
    title: DRILL_INFO[item.drill].title,
    problemId: item.problemId,
    problemTitle: problem.meta.title,
    variantTitle: content?.prompt.variant?.title ?? null,
    originProblemTitle: originTitle,
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

  /** Attempts whose open row is being worked on right now, so the day-change cleanup never removes one under a running call. */
  private readonly active = new Set<string>();

  private async sync(problems: ReadonlyMap<string, Problem>): Promise<DrillState> {
    const history = this.deps.history();
    const today = this.today();
    const dropped: string[] = [];
    await this.deps.store.update((draft) => {
      const marked = draft.backfilledOn;
      const added = queueGapDrills(draft, history, problems, today);
      const moved = repickStale(draft.items, draft.attempts, problems);
      // A conversation left open past its day can never be continued, so its row and body go.
      const stale = draft.attempts.filter((a) => a.status === "open" && a.day < today && !this.active.has(a.id));
      if (stale.length > 0) {
        const ids = new Set(stale.map((a) => a.id));
        draft.attempts = draft.attempts.filter((a) => !ids.has(a.id));
        dropped.push(...ids);
      }
      return { save: added || moved || stale.length > 0 || draft.backfilledOn !== marked, value: null };
    });
    for (const id of dropped) await this.deps.store.removeBody(id).catch(() => undefined);
    return this.deps.store.snapshot();
  }

  /** The graded attempts still on record, so the usage page can tell them from a drill that was started over, failed or is still open. */
  attemptsOnRecord(): { ids: Set<string>; legacy: number } {
    const attempts = this.deps.store.snapshot().attempts;
    return { ids: new Set(attempts.filter((a) => a.status === "done" && !a.legacy).map((a) => a.id)), legacy: attempts.filter((a) => a.legacy).length };
  }

  async summary(): Promise<GymSummary> {
    const problems = await this.playable();
    const state = await this.sync(problems);
    const today = this.today();
    const queue = state.items
      .filter((i) => i.status === "open" && problems.has(i.problemId))
      .sort(byDueDay)
      .map((i) => asRow(i, problems.get(i.problemId) as Problem, this.deps.problems.get(i.originProblemId)?.meta.title ?? i.originProblemId, today, state.attempts));
    return {
      today,
      queue,
      dueCount: queue.filter((r) => r.due).length,
      problems: [...problems.values()]
        .map((p) => ({ id: p.meta.id, title: p.meta.title, track: p.meta.track, drills: drillsAvailable(p) }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      week: weekDrillStats(state.attempts, (this.deps.now ?? (() => new Date()))()),
      ...gymExtras(state, today, (id) => this.deps.problems.get(id)),
    };
  }

  private async detailContext(): Promise<DetailContext> {
    return { problem: (id) => this.deps.problems.get(id), costs: (await this.deps.costs?.()) ?? new Map() };
  }

  async detail(drillId: string): Promise<DrillDetail> {
    const state = await this.sync(await this.playable());
    const detail = buildDetail(state, drillId, this.today(), await this.detailContext());
    if (!detail) throw new HttpError(404, "That drill was not found.");
    return detail;
  }

  async attempts(limit: number): Promise<RecentAttemptRow[]> {
    return recentAttempts(this.deps.store.snapshot(), limit, await this.detailContext());
  }

  /** The saved attempt for display. Open and legacy attempts have no body to show. */
  async attempt(attemptId: string): Promise<AttemptView> {
    const state = await this.sync(await this.playable());
    const row = state.attempts.find((a) => a.id === attemptId);
    const body = row && row.status === "done" && !row.legacy ? await this.deps.store.readBody(attemptId) : null;
    if (!body) throw new HttpError(404, "No detail was saved for this attempt.");
    return attemptView(body, state, this.today());
  }

  /**
   * Finds the problem and checks the drill fits it. Throws a 404 for anything the candidate may not drill. A topic the
   * page names must be one the brief offers for this drill, and then it is the topic of the content, so an answer is
   * graded on the topic its writer saw.
   */
  private async resolve(
    target: DrillTarget,
    state: DrillState,
    requested?: { variant: string | null; topic?: string | undefined },
  ): Promise<{ problem: Problem; item: DrillItem | null; content: DrillContent; variant: string | null }> {
    const problems = await this.playable();
    // The queue answers first: a stale problem on a queued drill is a conflict, not a missing problem.
    const item = this.matchItem(state, target, this.today());
    if (requested) {
      // The answer is graded on the item's pick, so a tab that saw another changed constraint must open the drill again.
      if (target.drillId) {
        if (item && requested.variant !== item.variant) throw new HttpError(409, MOVED);
      } else if (requested.variant !== null) {
        throw new HttpError(400, "A free drill has no changed constraint.");
      }
    }
    const problem = problems.get(target.problemId);
    if (!problem) throw new HttpError(404, "That problem is not available for drills yet. Play a round on it first.");
    if (!drillsForTrack(problem.meta.track).includes(target.drill)) throw new HttpError(400, "That drill does not fit this problem.");
    const rotation = rotationOf(state.attempts, target, item);
    const base = item ? { gapTitle: item.gapTitle, hint: item.gapHint, ...(item.variant ? { variant: item.variant } : {}) } : {};
    let content = buildDrill(problem, target.drill, { ...base, rotation });
    if (!content) throw new HttpError(400, "This problem has no material for that drill.");
    const topic = requested?.topic;
    if (topic !== undefined) {
      // Behind a changed constraint the topic is the one the brief builds for the item now, so the two must match.
      if (content.prompt.variant) {
        if (content.prompt.topic !== topic) throw new HttpError(409, MOVED);
      } else {
        if (!topicTitles(problem, target.drill).includes(topic)) throw new HttpError(409, MOVED);
        content = buildDrill(problem, target.drill, { ...base, rotation, topic });
        if (!content) throw new HttpError(400, "This problem has no material for that drill.");
      }
    }
    return { problem, item, content, variant: content.prompt.variant && item ? item.variant : null };
  }

  /** The queued drill an attempt may count for: the one named, or else the earliest due one of the same kind on the problem. */
  private matchItem(state: DrillState, target: DrillTarget, today: string): DrillItem | null {
    if (target.drillId) {
      const named = state.items.find((i) => i.id === target.drillId);
      if (!named || named.status !== "open" || named.drill !== target.drill) throw new HttpError(404, "That drill is no longer in the queue.");
      if (named.problemId !== target.problemId) throw new HttpError(409, MOVED);
      return named;
    }
    // A free drill counts only for a queued one that is due and asks the same plain problem, so practising early cannot rush a gap to closed.
    return state.items.filter((i) => isDue(i, today) && i.problemId === target.problemId && i.drill === target.drill && i.variant === null).sort(byDueDay)[0] ?? null;
  }

  /** The prompt for a drill. A dialogue with an open attempt shows the topic and changed constraint that attempt saved, so the page and the grader never disagree. */
  async prompt(target: DrillTarget): Promise<DrillPrompt> {
    const problems = await this.playable();
    const state = await this.sync(problems);
    const { problem, item, content, variant } = await this.resolve(target, state);
    // A queued drill opened before its day is graded but counts for nothing, so the page says so before the answer.
    const today = this.today();
    const early = item && !isDue(item, today) ? { early: { dueOn: item.dueOn, today } } : {};
    if (!isDialogue(target.drill)) return { ...content.prompt, ...early };
    const row = this.findOpen(state, target, variant);
    if (!row) return { ...content.prompt, ...early };
    const body = await this.deps.store.readBody(row.id);
    const conversation = this.conversationOf(body);
    if (!body || !conversation) return { ...content.prompt, ...early };
    const saved = buildDrill(problem, target.drill, { ...(body.topic ? { topic: body.topic } : {}), ...(variant ? { variant } : {}) });
    const shown = saved && (body.topic === null || saved.prompt.topic === body.topic) ? saved : content;
    return { ...shown.prompt, ...early, open: { attemptId: row.id, openedAt: row.at, turns: conversation.turns, asked: conversation.asked, of: MAX_FOLLOW_UPS } };
  }

  /** The open attempt of today for exactly this target: same kind, problem, changed constraint and queued drill. */
  private findOpen(state: DrillState, target: DrillTarget, variant: string | null): DrillAttempt | undefined {
    const today = this.today();
    return state.attempts.find(
      (a) =>
        a.status === "open" &&
        !a.legacy &&
        a.day === today &&
        a.drill === target.drill &&
        a.problemId === target.problemId &&
        a.variant === variant &&
        a.drillId === (target.drillId ?? null),
    );
  }

  /** What a dialogue body says about its conversation, or null when the body cannot be continued. */
  private conversationOf(body: AttemptBody | null): { turns: DrillTurn[]; asked: number } | null {
    if (!body || body.grades.length > 0 || body.turns.length === 0 || body.turns.length % 2 !== 0) return null;
    const turns = body.turns.map((t) => ({ role: t.role, text: t.text }));
    const alternates = turns.every((t, i) => t.role === (i % 2 === 0 ? "candidate" : "grader"));
    const asked = turns.length / 2;
    return alternates && asked <= MAX_FOLLOW_UPS ? { turns, asked } : null;
  }

  /** Targets with a call in progress, so a submit, a reply and an abandon for one target never overlap. */
  private readonly locks = new Set<string>();
  /** Revisions being graded right now, so a second one for the same attempt cannot score it twice. */
  private readonly grading = new Set<string>();

  private lockKey(t: { drill: DrillType; problemId: string; drillId?: string | null }): string {
    return t.drillId ?? `${t.drill}:${t.problemId}`;
  }

  /** A written drill always answers with a result; a dialogue drill answers with its first question. */
  submit(
    target: DrillTarget & { drill: WrittenDrill },
    answer: string,
    elapsedSeconds?: number,
    variant?: string | null,
    topic?: string,
  ): Promise<DrillTurnResponse & { kind: "result" }>;
  submit(target: DrillTarget, answer: string, elapsedSeconds?: number, variant?: string | null, topic?: string): Promise<DrillTurnResponse>;
  async submit(target: DrillTarget, answer: string, elapsedSeconds?: number, variant?: string | null, topic?: string): Promise<DrillTurnResponse> {
    if (answer.trim() === "") throw new HttpError(400, "Write an answer first.");
    const key = this.lockKey(target);
    if (this.locks.has(key)) throw new HttpError(409, "This drill is already being graded. Wait for the result.");
    this.locks.add(key);
    try {
      return await this.submitNow(target, answer, elapsedSeconds, variant ?? null, topic);
    } finally {
      this.locks.delete(key);
    }
  }

  private async submitNow(
    target: DrillTarget,
    answer: string,
    elapsedSeconds: number | undefined,
    requestedVariant: string | null,
    requestedTopic: string | undefined,
  ): Promise<DrillTurnResponse> {
    const problems = await this.playable();
    const state = await this.sync(problems);
    const { problem, content, variant } = await this.resolve(target, state, { variant: requestedVariant, topic: requestedTopic });
    const clock = this.deps.now ?? (() => new Date());
    const dialogue = isDialogue(target.drill);
    if (dialogue) {
      const open = this.findOpen(state, target, variant);
      if (open) {
        if (this.active.has(open.id)) throw new HttpError(409, DRILL_IN_PROGRESS);
        // A row whose body never got written belongs to a call that died; it must not lock the drill. A body that
        // already holds a grade is an attempt being finished, and dropping it would lose the grade.
        const body = await this.deps.store.readBody(open.id);
        if (body && (body.grades.length > 0 || this.conversationOf(body))) throw new HttpError(409, DRILL_IN_PROGRESS);
        await this.dropOpen(open.id);
      }
    }
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
        variant,
        drillId: dialogue ? (target.drillId ?? null) : null,
        status: "open",
        outcome: null,
        firstOutcome: null,
        revised: false,
        scores: [],
        seconds: dialogue ? (elapsedSeconds ?? null) : null,
        legacy: false,
      });
      return { save: true, value: null };
    });
    this.active.add(attemptId);
    try {
      const head = {
        version: 1 as const,
        id: attemptId,
        drill: target.drill,
        problemId: problem.meta.id,
        problemTitle: problem.meta.title.slice(0, 300),
        task: content.prompt.task.slice(0, 2000),
        topic: content.prompt.topic?.slice(0, 300) ?? null,
        ...(content.changed ? { changed: content.changed.slice(0, 2000) } : {}),
        answers: [{ at: opened.toISOString(), text: answer }],
      };
      if (dialogue) {
        const asked = await this.ask(problem, content, [{ role: "candidate", text: answer }], 0, attemptId, target.drill);
        await this.deps.store.writeBody({
          ...head,
          turns: [
            { role: "candidate", at: opened.toISOString(), text: answer },
            { role: "grader", at: clock().toISOString(), text: asked.question },
          ],
          grades: [],
        });
        return { kind: "question", attemptId, question: asked.question, asked: 1, of: MAX_FOLLOW_UPS };
      }

      let graded: GradedAnswer;
      try {
        graded = await this.grade(problem, content, answer, undefined, attemptId, target.drill);
        await this.deps.store.writeBody({ ...head, turns: [], grades: [gradeRecord(graded, clock())] });
      } catch (err) {
        await this.dropOpen(attemptId);
        throw err;
      }
      return await this.finishAttempt({ attemptId, target, variant, graded, turns: [], seconds: () => elapsedSeconds ?? null });
    } catch (err) {
      // A first question that failed leaves no row, as a failed grade does.
      if (dialogue) await this.dropOpen(attemptId);
      throw err;
    } finally {
      this.active.delete(attemptId);
    }
  }

  /**
   * Moves the schedule for a graded attempt and builds the result. It runs at grade time for every kind, so a dialogue
   * attempt counts exactly as a written one does.
   */
  private async finishAttempt(input: {
    attemptId: string;
    target: DrillTarget;
    variant: string | null;
    graded: GradedAnswer;
    turns: DrillTurn[];
    /** The time the attempt reports once it is done, from the time its row holds now. */
    seconds: (held: number | null) => number | null;
  }): Promise<DrillTurnResponse> {
    const { attemptId, target, variant, graded, turns } = input;
    const clock = this.deps.now ?? (() => new Date());
    const dialogue = isDialogue(target.drill);
    const today = localDay(clock());
    // The briefs may have changed while the grader worked, and the next pick must come from what is playable now.
    const latest = await this.playable();

    const finished = await this.deps.store.update<DrillTurnResponse | null>((draft) => {
      // The row is gone when the attempt was ended or dropped while it was graded, and then nothing may move.
      const row = draft.attempts.find((a) => a.id === attemptId);
      if (!row || row.status !== "open") return { save: false, value: null };
      // The queue may have changed while the grader worked, so the match is made again on the saved state.
      const item = this.matchLive(draft, target, today, variant);
      let readyCount: number | null = null;
      let closed = false;
      let nextDueOn: string | null = null;
      let itemBefore: DrillAttempt["itemBefore"];
      // An attempt before the drill's day is practice: it is logged and changes nothing.
      const counts = item !== null && isDue(item, today);
      row.status = "done";
      row.outcome = graded.outcome;
      row.scores = graded.scores;
      row.drillId = counts ? (item?.id ?? null) : null;
      row.seconds = input.seconds(row.seconds);
      if (item && counts) {
        itemBefore = { passes: item.passes, readyOn: [...item.readyOn] };
        // The pick is made with this attempt in the history, and saved with the schedule in the same update.
        const pick = pickNext(item, latest, draft.attempts);
        const proof = proofKey(target.problemId, variant);
        const next = applyOutcome({
          passes: item.passes,
          readyOn: item.readyOn,
          outcome: graded.outcome,
          revised: false,
          proof,
          canVary: canVaryFrom(pick, [...item.readyOn, proof]),
          today,
        });
        item.passes = next.passes;
        item.readyOn = next.readyOn;
        item.dueOn = next.dueOn;
        item.status = next.status;
        if (pick) {
          item.problemId = pick.problemId;
          item.variant = pick.variant;
        }
        readyCount = next.passes;
        closed = next.status === "closed";
        nextDueOn = closed ? null : next.dueOn;
      }
      if (itemBefore) row.itemBefore = itemBefore;
      const result: DrillResult = {
        attemptId,
        outcome: graded.outcome,
        firstOutcome: null,
        revised: false,
        scores: describeScores(target.drill, graded.scores),
        wentWell: graded.wentWell,
        improve: graded.improve,
        yourLine: graded.yourLine,
        canRevise: !dialogue && graded.outcome !== "ready",
        turns,
        readyCount,
        closed,
        nextDueOn,
        next: this.nextDue(draft, latest, today, counts ? item?.id : undefined),
      };
      return { save: true, value: { kind: "result" as const, ...result } };
    });
    if (!finished) throw new HttpError(409, CANNOT_CONTINUE);
    return finished;
  }

  /**
   * Takes the candidate's reply to the interviewer's question number `asked`. It asks the next question, or grades the
   * whole conversation. The reply is saved only after the grader answered, so a failed call leaves the attempt as it was
   * and the same reply can be sent again.
   */
  async reply(attemptId: string, asked: number, answer: string, elapsedSeconds?: number): Promise<DrillTurnResponse> {
    if (answer.trim() === "") throw new HttpError(400, "Write an answer first.");
    if (!ATTEMPT_ID.test(attemptId)) throw new HttpError(404, "That attempt was not found.");
    const row = this.deps.store.snapshot().attempts.find((a) => a.id === attemptId);
    if (!row) throw new HttpError(404, "That attempt was not found.");
    const key = this.lockKey(row);
    if (this.locks.has(key)) throw new HttpError(409, "This answer is already being graded. Wait for the result.");
    this.locks.add(key);
    this.active.add(attemptId);
    try {
      return await this.replyNow(attemptId, asked, answer, elapsedSeconds);
    } finally {
      this.active.delete(attemptId);
      this.locks.delete(key);
    }
  }

  private async replyNow(attemptId: string, asked: number, answer: string, elapsedSeconds: number | undefined): Promise<DrillTurnResponse> {
    const clock = this.deps.now ?? (() => new Date());
    const problems = await this.playable();
    const state = await this.sync(problems);
    const row = state.attempts.find((a) => a.id === attemptId);
    if (!row) throw new HttpError(404, "That attempt was not found.");
    if (row.status !== "open" || row.legacy || !isDialogue(row.drill) || row.day !== localDay(clock())) throw new HttpError(409, CANNOT_CONTINUE);
    const body = await this.deps.store.readBody(attemptId);
    const conversation = this.conversationOf(body);
    if (!body || !conversation) throw new HttpError(409, CANNOT_CONTINUE);

    // The reply is graded on the content saved for the attempt. A drill that moved on since is refused, as a submit is.
    if (row.drillId) {
      const item = state.items.find((i) => i.id === row.drillId);
      if (!item || item.status !== "open") throw new HttpError(404, "That drill is no longer in the queue.");
      if (item.problemId !== row.problemId || item.variant !== row.variant) throw new HttpError(409, MOVED);
    }
    const problem = problems.get(row.problemId);
    if (!problem) throw new HttpError(404, "That problem is not available for drills yet. Play a round on it first.");
    if (row.variant && !variantEntries(problem).some((e) => e.id === row.variant)) throw new HttpError(409, CANNOT_CONTINUE);
    const content = buildDrill(problem, row.drill, { ...(body.topic ? { topic: body.topic } : {}), ...(row.variant ? { variant: row.variant } : {}) });
    if (!content) throw new HttpError(400, "This problem has no material for that drill.");
    // A topic that left the brief cannot be rebuilt, and asking about another one would be wrong.
    if (body.topic !== null && content.prompt.topic !== body.topic) throw new HttpError(409, CANNOT_CONTINUE);

    // The reply names the question it answers, so a second tab or a repeated request never answers one it did not see.
    if (asked !== conversation.asked) throw new HttpError(409, CONVERSATION_MOVED);

    const turns: DrillTurn[] = [...conversation.turns, { role: "candidate", text: answer }];
    const at = clock().toISOString();
    if (asked < MAX_FOLLOW_UPS) {
      const next = await this.ask(problem, content, turns, asked, attemptId, row.drill);
      if (next.another) {
        await this.deps.store.writeBody({
          ...body,
          turns: [...body.turns, { role: "candidate", at, text: answer }, { role: "grader", at: clock().toISOString(), text: next.question }],
        });
        await this.deps.store.update((draft) => {
          const live = draft.attempts.find((a) => a.id === attemptId);
          if (live) live.seconds = addSeconds(live.seconds, elapsedSeconds);
          return { save: live !== undefined, value: null };
        });
        return { kind: "question", attemptId, question: next.question, asked: asked + 1, of: MAX_FOLLOW_UPS };
      }
    }

    const candidateText = turns
      .filter((t) => t.role === "candidate")
      .map((t) => t.text)
      .join("\n");
    const graded = await this.grade(problem, content, candidateText, turns, attemptId, row.drill);
    await this.deps.store.writeBody({
      ...body,
      turns: [...body.turns, { role: "candidate", at, text: answer }],
      grades: [gradeRecord(graded, clock())],
    });
    const target: DrillTarget = { drill: row.drill, problemId: row.problemId, ...(row.drillId ? { drillId: row.drillId } : {}) };
    return this.finishAttempt({ attemptId, target, variant: row.variant, graded, turns, seconds: (held) => addSeconds(held, elapsedSeconds) });
  }

  /** Ends a conversation the candidate no longer wants, so the drill can start over. It changes no schedule. */
  async abandon(attemptId: string): Promise<void> {
    if (!ATTEMPT_ID.test(attemptId)) throw new HttpError(404, "That attempt was not found.");
    const found = this.deps.store.snapshot().attempts.find((a) => a.id === attemptId);
    if (!found) throw new HttpError(404, "That attempt was not found.");
    const key = this.lockKey(found);
    if (this.locks.has(key)) throw new HttpError(409, "This answer is being graded. Wait for it to finish.");
    this.locks.add(key);
    try {
      const outcome = await this.deps.store.update((draft) => {
        const row = draft.attempts.find((a) => a.id === attemptId);
        if (!row) return { save: false, value: "missing" as const };
        if (row.status !== "open" || row.legacy || !isDialogue(row.drill)) return { save: false, value: "refused" as const };
        draft.attempts = draft.attempts.filter((a) => a.id !== attemptId);
        return { save: true, value: "removed" as const };
      });
      if (outcome === "missing") throw new HttpError(404, "That attempt was not found.");
      if (outcome === "refused") throw new HttpError(409, "Only a conversation in progress can be ended.");
      await this.deps.store.removeBody(attemptId).catch(() => undefined);
    } finally {
      this.locks.delete(key);
    }
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
    if (row.status !== "done" || row.legacy || isDialogue(row.drill)) throw new HttpError(409, "This attempt cannot be revised.");
    if (row.revised) throw new HttpError(409, "This attempt was already revised.");
    if (row.outcome === "ready" || row.outcome === null) throw new HttpError(409, "This answer is already interview-ready, so there is nothing to revise.");
    if (row.day !== today) throw new HttpError(409, "A revision must come on the same day as the attempt.");
    return row;
  }

  private async reviseNow(attemptId: string, answer: string, elapsedSeconds?: number): Promise<DrillResult> {
    const clock = this.deps.now ?? (() => new Date());
    const problems = await this.playable();
    const state = await this.sync(problems);
    const saved = this.checkRevisable(
      state.attempts.find((a) => a.id === attemptId),
      localDay(clock()),
    );
    const body = await this.deps.store.readBody(attemptId);
    const firstGrade = body?.grades[0];
    const firstAnswer = body?.answers[0];
    if (!body || !firstGrade || !firstAnswer) throw new HttpError(409, "This attempt cannot be revised.");
    const problem = problems.get(body.problemId);
    if (!problem) throw new HttpError(404, "That problem is not available for drills yet. Play a round on it first.");
    // A changed constraint that left the brief cannot be rebuilt, and grading it on another key would be wrong.
    if (saved.variant && !variantEntries(problem).some((e) => e.id === saved.variant)) throw new HttpError(409, "This attempt cannot be revised.");
    const content = buildDrill(problem, body.drill, { ...(body.topic ? { topic: body.topic } : {}), ...(saved.variant ? { variant: saved.variant } : {}) });
    if (!content) throw new HttpError(400, "This problem has no material for that drill.");

    const opened = clock();
    const graded = await this.grade(problem, content, answer, undefined, attemptId, body.drill);
    const better = isBetterOutcome(graded.outcome, firstGrade.outcome);
    const finalOutcome = betterOutcome(firstGrade.outcome, graded.outcome);
    await this.deps.store.writeBody({
      ...body,
      answers: [firstAnswer, { at: opened.toISOString(), text: answer }],
      grades: [firstGrade, gradeRecord(graded, clock())],
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
        // A revised result never closes a drill, so `canVary` is not read on this path.
        const next = applyOutcome({ ...live.itemBefore, outcome: finalOutcome, revised: true, proof: proofKey(live.problemId, live.variant), canVary: true, today });
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
        turns: [],
        readyCount,
        closed,
        nextDueOn,
        next: this.nextDue(draft, problems, today, item?.id),
      };
      return { save: true, value: result };
    });
  }

  /** Removes the open row of an attempt that never got a grade, and its body file. A failed save is logged so the grader's error still reaches the caller. */
  private async dropOpen(attemptId: string): Promise<void> {
    try {
      const dropped = await this.deps.store.update((draft) => {
        const before = draft.attempts.length;
        draft.attempts = draft.attempts.filter((a) => !(a.id === attemptId && a.status === "open"));
        const removed = draft.attempts.length < before;
        return { save: removed, value: removed };
      });
      if (dropped) await this.deps.store.removeBody(attemptId).catch(() => undefined);
    } catch (err) {
      this.deps.log.warn(`Could not remove the open drill attempt ${attemptId}: ${describeError(err)}`);
    }
  }

  /** The item the graded attempt may count for, or null when it moved to another problem or changed constraint while grading. */
  private matchLive(draft: DrillState, target: DrillTarget, today: string, variant: string | null): DrillItem | null {
    try {
      const item = this.matchItem(draft, target, today);
      return item && item.variant === variant ? item : null;
    } catch {
      return null;
    }
  }

  /**
   * One model call of the `grader` role. Every call of an attempt, the questions and the grade alike, carries the same
   * attempt id and kind, so the cost shows per attempt and per drill kind.
   */
  private async callModel<T>(
    problem: Problem,
    content: DrillContent,
    attemptId: string,
    drill: DrillType,
    spec: { prompt: "drill-grader" | "drill-follow-up"; text: string; candidateText: string; schema: z.ZodType<T>; fake: FakeFacts },
  ): Promise<T> {
    const settings = this.deps.settings.get();
    const res = await this.deps.driver.runOnce({
      role: "grader",
      model: settings.models.grader,
      effort: settings.effort.grader,
      systemPrompt: async () =>
        this.deps.prompts.render(
          spec.prompt,
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
      fake: spec.fake,
      usage: { sessionId: null, problemId: problem.meta.id, track: problem.meta.track, mode: null, drillAttemptId: attemptId, drillKind: drill },
      turn: { text: spec.text, meta: { kind: "oneshot", candidateText: spec.candidateText } },
      output: { schema: spec.schema, jsonSchema: toApiSchema(spec.schema), fallbackJsonSchema: toCompatSchema(spec.schema) },
      maxTurns: 3,
    });
    if (!res.output) throw new DriverError("The grader returned nothing.");
    return res.output;
  }

  /** Grades one answer, or a whole conversation when `turns` is given. `answer` is then the candidate's turns joined. */
  private async grade(
    problem: Problem,
    content: DrillContent,
    answer: string,
    turns: readonly DrillTurn[] | undefined,
    attemptId: string,
    drill: DrillType,
  ): Promise<GradedAnswer> {
    const text = graderMessage(content.prompt, content.key, turns ?? answer);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const output = await this.callModel(problem, content, attemptId, drill, {
          prompt: "drill-grader",
          text,
          candidateText: answer,
          schema: GraderOutputSchema,
          fake: { problem, track: problem.meta.track, drill: { kind: drill, key: content.key, answer } },
        });
        return finishGrade(output, answer, { drill, key: content.key, shown: shownText(content), redact: (line) => this.deps.guard.redact(line) });
      } catch (err) {
        this.deps.log.warn(`Drill grader attempt ${attempt + 1} failed for ${problem.meta.id}: ${err instanceof DriverError ? err.detail : describeError(err)}`);
      }
    }
    throw new HttpError(502, "The grader did not answer. Your answer is still in the box. Try again.");
  }

  /**
   * The interviewer's next question for a dialogue drill. `asked` counts the questions in `turns`; with none, the first
   * question is always asked, and after that the model decides whether another is needed. The question is model output:
   * it is cleaned and checked before it can reach the page. A question that asks two things, tells the candidate what
   * their design is or brings in the key is asked again once with the reason; the second call is the last, so a flawed
   * question then keeps only its first part, or becomes the fixed one.
   */
  private async ask(
    problem: Problem,
    content: DrillContent,
    turns: readonly DrillTurn[],
    asked: number,
    attemptId: string,
    drill: DrillType,
  ): Promise<{ another: boolean; question: string }> {
    const candidateText = turns.filter((t) => t.role === "candidate").at(-1)?.text ?? "";
    const redact = (line: string) => this.deps.guard.redact(line);
    const known = [shownText(content), ...turns.filter((t) => t.role === "candidate").map((t) => t.text)].join("\n");
    const fake: FakeFacts = { problem, track: problem.meta.track, drillFollowUp: { kind: drill, key: content.key, turns: [...turns], asked } };
    let rejected: RejectedQuestion | undefined;
    // The second reply is cut down first; the first reply is the next best, and the fixed question comes last.
    const salvage = (raw: string) => {
      const kept = salvageQuestion(raw, content.key, known, redact);
      const earlier = rejected && kept === FALLBACK_QUESTION ? salvageQuestion(rejected.question, content.key, known, redact) : kept;
      this.deps.log.warn(`Drill interviewer question cut down for ${problem.meta.id}: ${earlier === FALLBACK_QUESTION ? "fixed question" : "first part"}`);
      return earlier;
    };
    // The fixed question is asked once per conversation; a second time would read as the interviewer repeating itself.
    const settle = (question: string) =>
      question === FALLBACK_QUESTION && turns.some((t) => t.role === "grader" && t.text === FALLBACK_QUESTION) ? { another: false, question: "" } : { another: true, question };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = followUpMessage(content.prompt, content.key, turns, asked, rejected);
        const raw =
          asked === 0
            ? (await this.callModel(problem, content, attemptId, drill, { prompt: "drill-follow-up", text, candidateText, schema: FirstQuestionSchema, fake })).question
            : await this.callModel(problem, content, attemptId, drill, { prompt: "drill-follow-up", text, candidateText, schema: NextQuestionSchema, fake }).then((out) =>
                out.another ? out.question : "",
              );
        const review = reviewQuestion(raw, content.key, known, redact);
        if (review === null) {
          if (asked === 0) throw new DriverError("The interviewer asked an empty question.");
          return { another: false, question: "" };
        }
        if (review.problem === null) return { another: true, question: review.question };
        if (attempt === 1) return settle(salvage(raw));
        this.deps.log.warn(`Drill interviewer question not used for ${problem.meta.id}: ${review.problem}`);
        rejected = { question: raw, problem: review.problem };
      } catch (err) {
        this.deps.log.warn(`Drill interviewer attempt ${attempt + 1} failed for ${problem.meta.id}: ${err instanceof DriverError ? err.detail : describeError(err)}`);
      }
    }
    if (rejected) return settle(salvage(rejected.question));
    throw new HttpError(502, "The interviewer did not answer. Your answer is still in the box. Try again.");
  }
}
