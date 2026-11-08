import { z } from "zod";
import { DSA_FAILURES } from "../../shared/dsa";
import { readTextIfExists, writeFileAtomic } from "../engine/fsutil";
import type { Logger } from "../engine/log";
import { MAX_LEDGER_ENTRIES } from "./compute";

const count = z.number().int().min(0).max(1_000_000);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);

const AccountSnapshot = z.strictObject({
  username: z.string().min(1).max(40),
  fetchedAt: z.iso.datetime(),
  /** What LeetCode counts on the account, earlier years included. Kept for one quiet line, never as progress. */
  lifetime: z.strictObject({ all: count, easy: count, medium: count, hard: count }),
  /** Accepted solves since the count-from day, one per problem and time. */
  entries: z.array(z.strictObject({ title: z.string().min(1).max(200), slug, timestamp: z.number().int().min(0).max(99_999_999_999) })).max(MAX_LEDGER_ENTRIES),
});

export const SnapshotSchema = z.strictObject({
  version: z.literal(1),
  /** A problem's difficulty and topics never change, so they are kept for every problem that was ever read. */
  problems: z.record(
    slug,
    z.union([
      z.strictObject({
        difficulty: z.enum(["Easy", "Medium", "Hard"]),
        topics: z.array(z.strictObject({ name: z.string().min(1).max(100), slug })).max(60),
      }),
      z.strictObject({ missing: z.literal(true) }),
    ]),
  ),
  account: AccountSnapshot.nullable(),
  /** The newest read that failed, kept so a restart still knows why the numbers are old. */
  lastFailure: z
    .strictObject({ username: z.string().min(1).max(40), reason: z.enum(DSA_FAILURES), at: z.iso.datetime() })
    .nullable()
    .default(null),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;
export type AccountSnapshot = z.infer<typeof AccountSnapshot>;

export const MAX_CACHED_PROBLEMS = 20_000;

export const emptySnapshot = (): Snapshot => ({ version: 1, problems: {}, account: null, lastFailure: null });

/** A missing, unreadable or invalid file gives an empty snapshot, because the next read rebuilds it. */
export async function loadSnapshot(path: string, log: Logger): Promise<Snapshot> {
  try {
    const text = await readTextIfExists(path);
    if (text === null) return emptySnapshot();
    const parsed = SnapshotSchema.safeParse(JSON.parse(text));
    if (parsed.success && Object.keys(parsed.data.problems).length <= MAX_CACHED_PROBLEMS) return parsed.data;
    log.warn("leetcode.json does not match its format; ignoring it");
  } catch (err) {
    log.warn("Could not read leetcode.json; ignoring it", err);
  }
  return emptySnapshot();
}

export async function saveSnapshot(path: string, snapshot: Snapshot): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(snapshot)}\n`);
}
