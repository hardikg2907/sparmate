import type { DsaSolve, DsaTopic, LeetcodeDifficulty } from "../../shared/dsa";
import { parseDayLocal, planIndex, weekStart } from "../../shared/week";

export interface LedgerEntry {
  title: string;
  slug: string;
  /** Unix seconds, as LeetCode reports it. */
  timestamp: number;
}

export interface ProblemInfo {
  difficulty: LeetcodeDifficulty;
  topics: { name: string; slug: string }[];
}

export type ProblemCache = Readonly<Record<string, ProblemInfo>>;

export const MAX_LEDGER_ENTRIES = 20_000;

/** Unix seconds of local midnight at the start of `day`. */
export function dayStartSeconds(day: string): number {
  return Math.floor(parseDayLocal(day).getTime() / 1000);
}

/**
 * Adds new accepted solves to the ledger. A solve is identified by its problem and its time, so merging the same
 * list twice changes nothing, and solving one problem again later makes a second entry. Solves before `fromSec`
 * are dropped. LeetCode returns only the newest 20, so more than 20 solves between two reads can be missed.
 */
export function mergeLedger(existing: readonly LedgerEntry[], incoming: readonly LedgerEntry[], fromSec: number): LedgerEntry[] {
  const merged = new Map<string, LedgerEntry>();
  for (const entry of [...existing, ...incoming]) {
    if (entry.timestamp < fromSec) continue;
    merged.set(`${entry.slug}@${entry.timestamp}`, entry);
  }
  return [...merged.values()].sort((a, b) => b.timestamp - a.timestamp || a.slug.localeCompare(b.slug)).slice(0, MAX_LEDGER_ENTRIES);
}

/**
 * Problems solved since local Monday 00:00. A problem solved twice in the week counts once, on the day of its first
 * solve, because a re-run is not new practice.
 */
export function computeWeek(entries: readonly LedgerEntry[], cache: ProblemCache, now: Date): { solved: number; mediums: number; perDay: number[] } {
  const start = weekStart(now);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  const first = new Map<string, number>();
  for (const entry of entries) {
    const at = new Date(entry.timestamp * 1000);
    if (at < start || at >= end) continue;
    const seen = first.get(entry.slug);
    if (seen === undefined || entry.timestamp < seen) first.set(entry.slug, entry.timestamp);
  }
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  let mediums = 0;
  for (const [slug, timestamp] of first) {
    const day = planIndex(new Date(timestamp * 1000));
    perDay[day] = (perDay[day] ?? 0) + 1;
    if (cache[slug]?.difficulty === "Medium") mediums += 1;
  }
  return { solved: first.size, mediums, perDay };
}

/** Distinct problems in the ledger, counted by difficulty and by topic. */
export function computePass(
  entries: readonly LedgerEntry[],
  cache: ProblemCache,
  fromSec: number,
): { pass: { solved: number; easy: number; medium: number; hard: number }; topics: DsaTopic[] } {
  const slugs = new Set(entries.filter((e) => e.timestamp >= fromSec).map((e) => e.slug));
  const pass = { solved: slugs.size, easy: 0, medium: 0, hard: 0 };
  const topics = new Map<string, DsaTopic>();
  for (const slug of slugs) {
    const info = cache[slug];
    if (!info) continue;
    if (info.difficulty === "Easy") pass.easy += 1;
    else if (info.difficulty === "Medium") pass.medium += 1;
    else pass.hard += 1;
    for (const topic of info.topics) {
      const row = topics.get(topic.slug) ?? { name: topic.name, slug: topic.slug, solved: 0 };
      row.solved += 1;
      topics.set(topic.slug, row);
    }
  }
  return { pass, topics: [...topics.values()].sort((a, b) => b.solved - a.solved || a.name.localeCompare(b.name)) };
}

/** The newest solves first, one row per problem, with the difficulty when it is known. */
export function recentRows(entries: readonly LedgerEntry[], cache: ProblemCache, limit = 10): DsaSolve[] {
  const seen = new Set<string>();
  const rows: DsaSolve[] = [];
  for (const entry of [...entries].sort((a, b) => b.timestamp - a.timestamp)) {
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    rows.push({ title: entry.title, slug: entry.slug, difficulty: cache[entry.slug]?.difficulty ?? null, solvedAt: new Date(entry.timestamp * 1000).toISOString() });
    if (rows.length === limit) break;
  }
  return rows;
}
