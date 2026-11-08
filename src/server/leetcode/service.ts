import { emptyDsa, type DsaResponse } from "../../shared/dsa";
import type { Settings } from "../../shared/types";
import { localDay } from "../../shared/week";
import type { Logger } from "../engine/log";
import { LeetcodeError, type LeetcodeClient } from "./client";
import { computePass, computeWeek, dayStartSeconds, mergeLedger, recentRows, type ProblemInfo } from "./compute";
import { emptySnapshot, loadSnapshot, saveSnapshot, type AccountSnapshot, type Snapshot } from "./snapshot";

const MINUTE = 60_000;
/** Problem lookups in one read, so a long gap between visits cannot turn into a burst of requests. */
const MAX_LOOKUPS = 20;
const LOOKUP_PARALLEL = 4;
/** One read is two requests and a handful of lookups, so a stuck endpoint must not hold the page for long. */
const READ_DEADLINE_MS = 30_000;

type Outcome = "ok" | "failed" | "not_found";

export interface ServiceOptions {
  client: LeetcodeClient;
  settings: { get(): Settings };
  filePath: string;
  log: Logger;
  now?: () => number;
  /** The shortest wait between two reads of the same profile, however the read was asked for. */
  minIntervalMs?: number;
  /** After a failed read a page load waits this long, so a broken endpoint is not hit on every visit. */
  failedAutoWaitMs?: number;
  /** After a failed read an explicit "read again" waits this long. */
  failedForcedWaitMs?: number;
}

export class LeetcodeService {
  private snapshot: Snapshot | null = null;
  private attempt: { username: string; at: number; outcome: Outcome } | null = null;
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private readonly minInterval: number;
  private readonly failedAuto: number;
  private readonly failedForced: number;

  constructor(private readonly options: ServiceOptions) {
    this.now = options.now ?? Date.now;
    this.minInterval = options.minIntervalMs ?? 15 * MINUTE;
    this.failedAuto = options.failedAutoWaitMs ?? 2 * MINUTE;
    this.failedForced = options.failedForcedWaitMs ?? 15_000;
  }

  /** The page's data. Reads LeetCode first when the last read is old enough. `force` is a "read again" from the person. */
  async get(opts: { force?: boolean } = {}): Promise<DsaResponse> {
    const settings = this.options.settings.get();
    const username = settings.leetcodeUsername ?? null;
    const goal = settings.dsaWeeklyGoal;
    if (username === null) return emptyDsa(null, "no_username", goal);
    const countFrom = settings.dsaCountFrom ?? localDay(new Date(this.now()));
    const snapshot = await this.load();
    if (this.due(username, snapshot, opts.force === true)) await this.refresh(username, countFrom);
    return this.build(username, countFrom, goal);
  }

  private async load(): Promise<Snapshot> {
    this.snapshot ??= await loadSnapshot(this.options.filePath, this.options.log);
    return this.snapshot;
  }

  private lastRead(username: string, snapshot: Snapshot): { at: number; outcome: Outcome } | null {
    if (this.attempt?.username === username) return this.attempt;
    // Nothing was tried since the server started, so the saved read says how fresh the numbers are.
    const account = snapshot.account?.username === username ? snapshot.account : null;
    return account ? { at: Date.parse(account.fetchedAt), outcome: "ok" } : null;
  }

  private due(username: string, snapshot: Snapshot, force: boolean): boolean {
    const last = this.lastRead(username, snapshot);
    if (!last) return true;
    const wait = last.outcome === "failed" ? (force ? this.failedForced : this.failedAuto) : this.minInterval;
    return this.now() - last.at >= wait;
  }

  private refresh(username: string, countFrom: string): Promise<void> {
    const running = this.inflight.get(username);
    if (running) return running;
    const job = this.read(username, countFrom).finally(() => this.inflight.delete(username));
    this.inflight.set(username, job);
    return job;
  }

  private async read(username: string, countFrom: string): Promise<void> {
    const { client, log } = this.options;
    const snapshot = await this.load();
    const signal = AbortSignal.timeout(READ_DEADLINE_MS);
    try {
      const profile = await client.profile(username, signal);
      if (!profile.found) {
        this.attempt = { username, at: this.now(), outcome: "not_found" };
        return;
      }
      const recent = await client.recent(username, signal);
      const before = snapshot.account?.username === username ? snapshot.account.entries : [];
      const entries = mergeLedger(before, recent, dayStartSeconds(countFrom));
      const problems = { ...snapshot.problems };
      const missing = [...new Set(entries.map((e) => e.slug))].filter((slug) => problems[slug] === undefined).slice(0, MAX_LOOKUPS);
      await lookUp(missing, LOOKUP_PARALLEL, async (slug) => {
        try {
          const info = await client.problem(slug, signal);
          if (info) problems[slug] = info;
        } catch (err) {
          // One problem that cannot be read is left out of the topic counts until a later read.
          if (!(err instanceof LeetcodeError)) throw err;
        }
      });
      const account: AccountSnapshot = { username, fetchedAt: new Date(this.now()).toISOString(), lifetime: profile.profile.totals, entries };
      this.snapshot = { version: 1, problems, account };
      this.attempt = { username, at: this.now(), outcome: "ok" };
      await saveSnapshot(this.options.filePath, this.snapshot).catch((err) => log.warn("Could not save leetcode.json", err));
    } catch (err) {
      log.warn("Could not read the LeetCode profile", err);
      this.attempt = { username, at: this.now(), outcome: "failed" };
    }
  }

  private build(username: string, countFrom: string, goal: number): DsaResponse {
    const snapshot = this.snapshot ?? emptySnapshot();
    const account = snapshot.account?.username === username ? snapshot.account : null;
    const outcome = this.attempt?.username === username ? this.attempt.outcome : "ok";
    if (outcome === "not_found") return emptyDsa(username, "not_found", goal, countFrom);
    if (!account) return emptyDsa(username, "error", goal, countFrom);
    const fromSec = dayStartSeconds(countFrom);
    const entries = account.entries.filter((e) => e.timestamp >= fromSec);
    const problems = snapshot.problems as Readonly<Record<string, ProblemInfo>>;
    const { pass, topics } = computePass(entries, problems, fromSec);
    return {
      username,
      status: outcome === "failed" ? "stale" : "ok",
      fetchedAt: account.fetchedAt,
      countFrom,
      pass,
      topics,
      // The week is worked out from the saved list at request time, so a read from Sunday shows the new week on Monday.
      week: computeWeek(entries, problems, new Date(this.now())),
      recent: recentRows(entries, problems),
      lifetimeSolved: account.lifetime.all,
      weeklyGoal: goal,
    };
  }
}

async function lookUp<T>(items: readonly T[], parallel: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker));
}
