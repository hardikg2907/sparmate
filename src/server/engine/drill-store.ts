import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  ATTEMPT_ID,
  DRILL_ID,
  DRILL_OUTCOMES,
  MAX_ANSWER_CHARS,
  MAX_ELAPSED_SECONDS,
  MAX_READY_ON,
  MAX_VARIANT_ID,
  VARIANT_ID,
  DaySchema,
  DrillTypeSchema,
  PROBLEM_ID,
} from "../../shared/drills";
import { readTextIfExists, sha256Hex, writeFileAtomic } from "./fsutil";
import type { Logger } from "./log";

const MAX_ITEMS = 2000;
const MAX_ATTEMPTS = 20000;
const MAX_V1_ITEMS = 500;
const MAX_V1_ATTEMPTS = 1000;

const OutcomeSchema = z.enum(DRILL_OUTCOMES);
const ScoreSchema = z.strictObject({ id: z.string().min(1).max(60), score: z.number().int().min(1).max(4) });
const ProblemIdSchema = z.string().min(1).max(100);
/** A problem id, or a problem id and a variant id joined by "#". */
const ProofKeySchema = z
  .string()
  .min(1)
  .max(100 + 1 + MAX_VARIANT_ID);
const VariantIdSchema = z.string().regex(VARIANT_ID).max(MAX_VARIANT_ID);

const ItemSchema = z.strictObject({
  id: z.string().regex(DRILL_ID),
  sessionId: z.string().min(1).max(200),
  problemId: ProblemIdSchema,
  originProblemId: ProblemIdSchema,
  variant: VariantIdSchema.nullable(),
  readyOn: z.array(ProofKeySchema).max(MAX_READY_ON),
  gapTitle: z.string().min(1).max(600),
  gapHint: z.string().max(1200),
  drill: DrillTypeSchema,
  createdOn: DaySchema,
  dueOn: DaySchema,
  passes: z.number().int().min(0).max(3),
  status: z.enum(["open", "closed"]),
});

const AttemptSchema = z.strictObject({
  id: z.string().regex(ATTEMPT_ID),
  at: z.string().max(40),
  day: DaySchema,
  drill: DrillTypeSchema,
  problemId: ProblemIdSchema,
  variant: VariantIdSchema.nullable(),
  drillId: z.string().regex(DRILL_ID).nullable(),
  status: z.enum(["open", "done"]),
  outcome: OutcomeSchema.nullable(),
  firstOutcome: OutcomeSchema.nullable(),
  revised: z.boolean(),
  scores: z.array(ScoreSchema).max(12),
  seconds: z.number().int().min(0).max(MAX_ELAPSED_SECONDS).nullable(),
  legacy: z.boolean(),
  itemBefore: z.strictObject({ passes: z.number().int().min(0).max(3), readyOn: z.array(ProofKeySchema).max(MAX_READY_ON) }).optional(),
});

export const DrillStateSchema = z.strictObject({
  version: z.literal(2),
  /** The day the schedule was first built from the rounds that already existed. */
  backfilledOn: DaySchema.optional(),
  items: z.array(ItemSchema).max(MAX_ITEMS),
  attempts: z.array(AttemptSchema).max(MAX_ATTEMPTS),
});
export type DrillState = z.infer<typeof DrillStateSchema>;

const DrillStateV1Schema = z.strictObject({
  version: z.literal(1),
  backfilledOn: DaySchema.optional(),
  items: z
    .array(
      z.strictObject({
        id: z.string().regex(DRILL_ID),
        sessionId: z.string().min(1).max(200),
        problemId: ProblemIdSchema,
        gapTitle: z.string().min(1).max(600),
        gapHint: z.string().max(1200),
        drill: DrillTypeSchema,
        createdOn: DaySchema,
        dueOn: DaySchema,
        passes: z.number().int().min(0).max(3),
        status: z.enum(["open", "closed"]),
      }),
    )
    .max(MAX_V1_ITEMS),
  attempts: z
    .array(
      z.strictObject({
        at: z.string().max(40),
        day: DaySchema,
        drill: DrillTypeSchema,
        problemId: ProblemIdSchema,
        drillId: z.string().regex(DRILL_ID).nullable(),
        verdict: z.enum(["pass", "not_yet"]),
      }),
    )
    .max(MAX_V1_ATTEMPTS),
});
export type DrillStateV1 = z.infer<typeof DrillStateV1Schema>;

const GRADE_LINES = z.array(z.string().max(600)).max(8);

/** Everything one attempt saves: what was asked, what the candidate wrote and how it was graded. */
export const AttemptBodySchema = z.strictObject({
  version: z.literal(1),
  id: z.string().regex(ATTEMPT_ID),
  drill: DrillTypeSchema,
  problemId: z.string().regex(PROBLEM_ID),
  problemTitle: z.string().max(300),
  task: z.string().max(2000),
  topic: z.string().max(300).nullable(),
  /** The changed-constraint question a variant asked. */
  changed: z.string().max(2000).optional(),
  answers: z.array(z.strictObject({ at: z.string().max(40), text: z.string().max(MAX_ANSWER_CHARS) })).max(2),
  turns: z.array(z.strictObject({ role: z.enum(["grader", "candidate"]), at: z.string().max(40), text: z.string().max(MAX_ANSWER_CHARS) })).max(8),
  grades: z
    .array(
      z.strictObject({
        at: z.string().max(40),
        outcome: OutcomeSchema,
        scores: z.array(ScoreSchema).max(12),
        wentWell: GRADE_LINES,
        improve: GRADE_LINES,
        yourLine: z.string().max(600),
        strong: z.string().max(600),
      }),
    )
    .max(2),
});
export type AttemptBody = z.infer<typeof AttemptBodySchema>;

export function emptyState(): DrillState {
  return { version: 2, items: [], attempts: [] };
}

/** Stable, so converting the same file twice gives the same rows. */
function legacyAttemptId(at: string, drill: string, problemId: string, index: number): string {
  return sha256Hex(`${at}\n${drill}\n${problemId}\n${index}`).slice(0, 16);
}

/** Turns a first-format file into the current one. Nothing is dropped. */
export function migrateV1(v1: DrillStateV1): DrillState {
  return {
    version: 2,
    ...(v1.backfilledOn ? { backfilledOn: v1.backfilledOn } : {}),
    items: v1.items.map((i) => ({
      ...i,
      originProblemId: i.problemId,
      variant: null,
      readyOn: i.passes > 0 ? [i.problemId] : [],
    })),
    attempts: v1.attempts.map((a, index) => ({
      id: legacyAttemptId(a.at, a.drill, a.problemId, index),
      at: a.at,
      day: a.day,
      drill: a.drill,
      problemId: a.problemId,
      variant: null,
      drillId: a.drillId,
      status: "done" as const,
      outcome: a.verdict === "pass" ? ("ready" as const) : ("needs_work" as const),
      firstOutcome: null,
      revised: false,
      scores: [],
      seconds: null,
      legacy: true,
    })),
  };
}

/**
 * The drill schedule in one JSON file in the data folder, plus one body file per attempt beside it. A file that is
 * missing or matches neither format starts the schedule empty and never stops the app; a bad file is kept beside the
 * new one so nothing is lost. A first-format file is converted once and its original text is kept.
 */
export class DrillStore {
  private state: DrillState = emptyState();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly log: Logger,
  ) {}

  async load(): Promise<void> {
    let raw: string | null;
    try {
      raw = await readTextIfExists(this.path);
    } catch (err) {
      this.log.warn("Could not read drills.json; starting with no drills", err);
      return;
    }
    if (raw === null) return;
    try {
      const json: unknown = JSON.parse(raw);
      const parsed = DrillStateSchema.safeParse(json);
      if (parsed.success) {
        this.state = parsed.data;
        return;
      }
      const old = DrillStateV1Schema.safeParse(json);
      if (old.success) {
        this.state = migrateV1(old.data);
        await this.saveConverted(raw);
        return;
      }
      this.log.warn("drills.json does not match the drill format; starting with no drills");
    } catch (err) {
      this.log.warn("drills.json is not valid JSON; starting with no drills", err);
    }
    try {
      await writeFileAtomic(`${this.path}.bad`, raw);
    } catch (err) {
      this.log.warn("Could not keep a copy of the bad drills.json", err);
    }
  }

  /** Keeps the original text once, then writes the converted file. A failed write leaves the converted state in memory only. */
  private async saveConverted(original: string): Promise<void> {
    try {
      const backup = join(dirname(this.path), "drills.v1.json");
      if ((await readTextIfExists(backup)) === null) await writeFileAtomic(backup, original);
      await writeFileAtomic(this.path, `${JSON.stringify(DrillStateSchema.parse(this.state), null, 2)}\n`);
    } catch (err) {
      this.log.warn("Could not save the converted drills.json; the drills stay in memory for now", err);
    }
  }

  private bodyPath(id: string): string | null {
    return ATTEMPT_ID.test(id) ? join(dirname(this.path), "drill-attempts", `${id}.json`) : null;
  }

  /** Saves the full record of one attempt. Throws when the id or the body is not valid. */
  async writeBody(body: AttemptBody): Promise<void> {
    const valid = AttemptBodySchema.parse(body);
    const file = this.bodyPath(valid.id);
    if (!file) throw new Error("Invalid attempt id.");
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFileAtomic(file, `${JSON.stringify(valid, null, 2)}\n`);
  }

  /** The saved record of an attempt, or null when it is missing, has a bad id or does not match the format. */
  async readBody(id: string): Promise<AttemptBody | null> {
    const file = this.bodyPath(id);
    if (!file) return null;
    try {
      const raw = await readTextIfExists(file);
      if (raw === null) return null;
      const parsed = AttemptBodySchema.safeParse(JSON.parse(raw));
      if (parsed.success && parsed.data.id === id) return parsed.data;
      this.log.warn(`Attempt file ${id}.json does not match the attempt format`);
    } catch (err) {
      this.log.warn(`Could not read attempt file ${id}.json`, err);
    }
    return null;
  }

  /** A copy, so a caller can never change the schedule without going through `update`. */
  snapshot(): DrillState {
    return structuredClone(this.state);
  }

  /**
   * Runs `change` on a copy of the state, one change at a time, and saves the result when `change` returns true.
   * A failed save leaves the in-memory state as it was.
   */
  update<T>(change: (draft: DrillState) => { save: boolean; value: T }): Promise<T> {
    const run = this.chain.then(async () => {
      const draft = structuredClone(this.state);
      const { save, value } = change(draft);
      if (!save) return value;
      draft.items = draft.items.slice(-MAX_ITEMS);
      draft.attempts = draft.attempts.slice(-MAX_ATTEMPTS);
      await writeFileAtomic(this.path, `${JSON.stringify(DrillStateSchema.parse(draft), null, 2)}\n`);
      this.state = draft;
      return value;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}
