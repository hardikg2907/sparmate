import { z } from "zod";
import { DRILL_ID, DaySchema, DrillTypeSchema } from "../../shared/drills";
import { readTextIfExists, writeFileAtomic } from "./fsutil";
import type { Logger } from "./log";

const MAX_ITEMS = 500;
const MAX_ATTEMPTS = 1000;

const ItemSchema = z.strictObject({
  id: z.string().regex(DRILL_ID),
  sessionId: z.string().min(1).max(200),
  problemId: z.string().min(1).max(100),
  gapTitle: z.string().min(1).max(600),
  gapHint: z.string().max(1200),
  drill: DrillTypeSchema,
  createdOn: DaySchema,
  dueOn: DaySchema,
  passes: z.number().int().min(0).max(3),
  status: z.enum(["open", "closed"]),
});

const AttemptSchema = z.strictObject({
  at: z.string().max(40),
  day: DaySchema,
  drill: DrillTypeSchema,
  problemId: z.string().min(1).max(100),
  drillId: z.string().regex(DRILL_ID).nullable(),
  verdict: z.enum(["pass", "not_yet"]),
});

export const DrillStateSchema = z.strictObject({
  version: z.literal(1),
  items: z.array(ItemSchema).max(MAX_ITEMS),
  attempts: z.array(AttemptSchema).max(MAX_ATTEMPTS),
});
export type DrillState = z.infer<typeof DrillStateSchema>;

export function emptyState(): DrillState {
  return { version: 1, items: [], attempts: [] };
}

/**
 * The drill schedule in one JSON file in the data folder. A file that is missing or does not match the schema
 * starts the schedule empty and never stops the app; a bad file is kept beside the new one so nothing is lost.
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
      const parsed = DrillStateSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        this.state = parsed.data;
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
