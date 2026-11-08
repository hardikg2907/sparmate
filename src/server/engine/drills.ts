import {
  DRILL_INFO,
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

/** The id of a queued drill. It comes from the round and the gap, so the same gap is never queued twice. */
export function drillItemId(sessionId: string, gapTitle: string): string {
  return sha256Hex(`${sessionId}\n${gapTitle}`).slice(0, 16);
}

/**
 * Queues one drill for every scorecard gap that has one, the day after its debrief. Rounds already seen are skipped,
 * and so is a gap that already has an open drill on the same problem. Returns whether anything was added.
 */
export function queueGapDrills(draft: DrillState, history: readonly SessionHistoryItem[], problems: ReadonlyMap<string, Problem>): boolean {
  let added = false;
  const known = new Set(draft.items.map((i) => i.id));
  for (const round of history) {
    if (round.status !== "debriefed" || !round.gaps?.length) continue;
    const problem = problems.get(round.problemId);
    if (!problem) continue;
    const debriefDay = localDay(new Date(round.endedAt ?? round.createdAt));
    for (const gap of round.gaps) {
      const drill = drillForGap({ title: gap.title, goodLooksLike: gap.goodLooksLike, drill: gap.drill }, round.track);
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
        gapHint: gap.goodLooksLike.slice(0, 1200),
        drill,
        createdOn: firstDueDay(debriefDay),
        dueOn: firstDueDay(debriefDay),
        passes: 0,
        status: "open",
      });
      added = true;
    }
  }
  return added;
}

/** Problems a drill may use: any problem with a round, and every custom problem. Nothing the candidate has not met. */
export function playableProblems(all: readonly Problem[], history: readonly Pick<SessionHistoryItem, "problemId">[]): Problem[] {
  const played = new Set(history.map((h) => h.problemId));
  return all.filter((p) => p.custom || played.has(p.meta.id));
}

function asRow(item: DrillItem, problem: Problem, today: string): GymDrillRow {
  const content = buildDrill(problem, item.drill, { hint: `${item.gapTitle} ${item.gapHint}` });
  return {
    id: item.id,
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
    await this.deps.store.update((draft) => ({ save: queueGapDrills(draft, history, problems), value: null }));
    return this.deps.store.snapshot();
  }

  async summary(): Promise<GymSummary> {
    const problems = await this.playable();
    const state = await this.sync(problems);
    const today = this.today();
    const queue = state.items
      .filter((i) => i.status === "open" && problems.has(i.problemId))
      .sort(byDueDay)
      .map((i) => asRow(i, problems.get(i.problemId) as Problem, today));
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
    const item = this.matchItem(state, target);
    const rotation = state.attempts.filter((a) => a.problemId === problem.meta.id && a.drill === target.drill).length;
    const content = buildDrill(problem, target.drill, { hint: item ? `${item.gapTitle} ${item.gapHint}` : "", rotation });
    if (!content) throw new HttpError(400, "This problem has no material for that drill.");
    return { problem, item, content };
  }

  /** The queued drill an attempt counts for: the one named, or else the earliest open one of the same kind on the problem. */
  private matchItem(state: DrillState, target: DrillTarget): DrillItem | null {
    if (target.drillId) {
      const named = state.items.find((i) => i.id === target.drillId);
      if (!named || named.status !== "open" || named.problemId !== target.problemId || named.drill !== target.drill) {
        throw new HttpError(404, "That drill is no longer in the queue.");
      }
      return named;
    }
    return state.items.filter((i) => i.status === "open" && i.problemId === target.problemId && i.drill === target.drill).sort(byDueDay)[0] ?? null;
  }

  async prompt(target: DrillTarget): Promise<DrillPrompt> {
    const problems = await this.playable();
    const state = await this.sync(problems);
    const { content } = await this.resolve(target, state);
    return content.prompt;
  }

  async submit(target: DrillTarget, answer: string): Promise<DrillResult> {
    const problems = await this.playable();
    const state = await this.sync(problems);
    const { problem, content } = await this.resolve(target, state);
    const graded = await this.grade(problem, content, answer);
    const now = (this.deps.now ?? (() => new Date()))();
    const today = localDay(now);

    return this.deps.store.update((draft) => {
      // The queue may have changed while the grader worked, so the match is made again on the saved state.
      const item = this.matchLive(draft, target);
      let passesInRow: number | null = null;
      let closed = false;
      let nextDueOn: string | null = null;
      if (item) {
        const next = applyVerdict(item, graded.verdict, today);
        item.passes = next.passes;
        item.dueOn = next.dueOn;
        item.status = next.status;
        passesInRow = next.passes;
        closed = next.status === "closed";
        nextDueOn = closed ? null : next.dueOn;
      }
      const attempt: DrillAttempt = { at: now.toISOString(), day: today, drill: target.drill, problemId: target.problemId, drillId: item?.id ?? null, verdict: graded.verdict };
      draft.attempts.push(attempt);
      const other = draft.items.filter((i) => i.id !== item?.id && isDue(i, today) && problems.has(i.problemId)).sort(byDueDay)[0];
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

  private matchLive(draft: DrillState, target: DrillTarget): DrillItem | null {
    try {
      return this.matchItem(draft, target);
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
