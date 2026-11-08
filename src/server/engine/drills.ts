import {
  DRILL_INFO,
  addDays,
  applyVerdict,
  byDueDay,
  drillForGap,
  drillsForTrack,
  firstDueDay,
  isDue,
  localDay,
  weekDrillStats,
  type DrillAttempt,
  type DrillItem,
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
import { GraderOutputSchema, finishGrade, graderMessage } from "./drill-grader";
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

/** Rounds older than this many days at the moment they are first seen queue no drills. */
export const BACKFILL_DAYS = 14;

/** A round counts as played once it has ended, because until then its hidden facts are still in use. */
const OVER: ReadonlySet<SessionHistoryItem["status"]> = new Set(["ended", "debriefing", "debriefed", "failed"]);

/** The id of a queued drill. It comes from the round and the gap, so the same gap is never queued twice. */
export function drillItemId(sessionId: string, gapTitle: string): string {
  return sha256Hex(`${sessionId}\n${gapTitle}`).slice(0, 16);
}

/**
 * Queues one drill for every scorecard gap that has one, the day after its debrief. Rounds already seen are skipped,
 * and so is a gap that already has an open drill on the same problem. Returns whether anything was added.
 */
export function queueGapDrills(draft: DrillState, history: readonly SessionHistoryItem[], problems: ReadonlyMap<string, Problem>, today: string): boolean {
  let added = false;
  const oldest = addDays(today, -BACKFILL_DAYS);
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
  const content = buildDrill(problem, item.drill, { hint: `${item.gapTitle} ${item.gapHint}`, rotation });
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
    await this.deps.store.update((draft) => ({ save: queueGapDrills(draft, history, problems, today), value: null }));
    return this.deps.store.snapshot();
  }

  async summary(): Promise<GymSummary> {
    const problems = await this.playable();
    const state = await this.sync(problems);
    const today = this.today();
    const queue = state.items
      .filter((i) => i.status === "open" && problems.has(i.problemId))
      .sort(byDueDay)
      .map((i) => asRow(i, problems.get(i.problemId) as Problem, today, state.attempts.filter((a) => a.problemId === i.problemId && a.drill === i.drill).length));
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
    const rotation = state.attempts.filter((a) => a.problemId === problem.meta.id && a.drill === target.drill).length;
    const content = buildDrill(problem, target.drill, { hint: item ? `${item.gapTitle} ${item.gapHint}` : "", rotation });
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

  async submit(target: DrillTarget, answer: string): Promise<DrillResult> {
    if (answer.trim() === "") throw new HttpError(400, "Write an answer first.");
    const key = target.drillId ?? `${target.drill}:${target.problemId}`;
    if (this.grading.has(key)) throw new HttpError(409, "This drill is already being graded. Wait for the result.");
    this.grading.add(key);
    try {
      return await this.submitNow(target, answer);
    } finally {
      this.grading.delete(key);
    }
  }

  private async submitNow(target: DrillTarget, answer: string): Promise<DrillResult> {
    const problems = await this.playable();
    const state = await this.sync(problems);
    const { problem, content } = await this.resolve(target, state);
    const graded = await this.grade(problem, content, answer);
    const now = (this.deps.now ?? (() => new Date()))();
    const today = localDay(now);

    return this.deps.store.update((draft) => {
      // The queue may have changed while the grader worked, so the match is made again on the saved state.
      const item = this.matchLive(draft, target, today);
      let passesInRow: number | null = null;
      let closed = false;
      let nextDueOn: string | null = null;
      // An attempt before the drill's day is practice: it is logged and changes nothing.
      const counts = item !== null && isDue(item, today);
      if (item && counts) {
        const next = applyVerdict(item, graded.verdict, today);
        item.passes = next.passes;
        item.dueOn = next.dueOn;
        item.status = next.status;
        passesInRow = next.passes;
        closed = next.status === "closed";
        nextDueOn = closed ? null : next.dueOn;
      }
      const attempt: DrillAttempt = {
        at: now.toISOString(),
        day: today,
        drill: target.drill,
        problemId: target.problemId,
        drillId: counts ? (item?.id ?? null) : null,
        verdict: graded.verdict,
      };
      draft.attempts.push(attempt);
      const other = draft.items.filter((i) => i.id !== (counts ? item?.id : undefined) && isDue(i, today) && problems.has(i.problemId)).sort(byDueDay)[0];
      const result: DrillResult = {
        ...graded,
        passesInRow,
        closed,
        nextDueOn,
        next: other ? { drill: other.drill, problemId: other.problemId, drillId: other.id } : null,
      };
      return { save: true, value: result };
    });
  }

  private matchLive(draft: DrillState, target: DrillTarget, today: string): DrillItem | null {
    try {
      return this.matchItem(draft, target, today);
    } catch {
      return null;
    }
  }

  private async grade(problem: Problem, content: DrillContent, answer: string) {
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
          fake: { problem, track: problem.meta.track, drill: { key: content.key, answer } },
          usage: { sessionId: null, problemId: problem.meta.id, track: problem.meta.track, mode: null },
          turn: { text, meta: { kind: "oneshot", candidateText: answer } },
          output: { schema: GraderOutputSchema, jsonSchema: toApiSchema(GraderOutputSchema), fallbackJsonSchema: toCompatSchema(GraderOutputSchema) },
          maxTurns: 3,
        });
        if (!res.output) throw new DriverError("The grader returned nothing.");
        const done = finishGrade(res.output, answer);
        return { ...done, fix: this.deps.guard.redact(done.fix), passSounds: this.deps.guard.redact(done.passSounds) };
      } catch (err) {
        this.deps.log.warn(`Drill grader attempt ${attempt + 1} failed for ${problem.meta.id}: ${err instanceof DriverError ? err.detail : describeError(err)}`);
      }
    }
    throw new HttpError(502, "The grader did not answer. Your answer is still in the box. Try again.");
  }
}
