import type { Track } from "../../shared/phases";
import type { Problem } from "../../shared/problem";
import type { ProblemSummary, TrackerMark } from "../../shared/types";
import { localDate } from "./fsutil";
import type { SessionSummary } from "./store";

export interface TrackerBullet {
  lineIndex: number;
  mark: TrackerMark;
  suffix: string | null;
}

export interface TrackerView {
  /** The matching tracker bullet per problem id; missing or null when the problem is not in the tracker. */
  bullets: ReadonlyMap<string, TrackerBullet | null>;
  /** The track named by the last Session Log row ("B3" means LLD, "C2" means HLD), if any. */
  lastLogTrack: Track | null;
}

const REDO_AFTER_DAYS = 7;

export function daysBetween(from: string, to: string): number {
  const parse = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, day ?? 1);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** A calendar day plus some days, as YYYY-MM-DD. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return next.toISOString().slice(0, 10);
}

export function newestDate(text: string | null): string | null {
  if (!text) return null;
  const dates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  return dates.length === 0 ? null : (dates.sort().at(-1) ?? null);
}

/** Reads the track from a Session Log row: the first of B3 or C2 in the topic cell, else anywhere in the row. */
export function trackFromLogRow(row: string): Track | null {
  const cells = row.split("|");
  const find = (text: string): Track | null => {
    const m = /\b(B3|C2)\b/.exec(text);
    if (!m) return null;
    return m[1] === "B3" ? "lld" : "hld";
  };
  return find(cells[2] ?? "") ?? find(row);
}

/** The last data row of a Markdown table excerpt (header and separator rows skipped). */
export function lastTableRow(table: string | null): string | null {
  if (!table) return null;
  const rows = table
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && !/^\|[\s:|-]+\|?$/.test(l));
  return rows.length >= 2 ? (rows.at(-1) ?? null) : null;
}

const TRACK_ORDER: Record<Track, number> = { hld: 0, lld: 1 };

/** The first sentence of the opening prompt: what the candidate hears first, never the hidden sections. */
export function openingSummary(opening: string): string {
  const text = opening.replace(/`/g, "").replace(/\s+/g, " ").trim();
  const end = /[.?!](?=\s|$)/.exec(text);
  const sentence = end ? text.slice(0, end.index + 1) : text;
  return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}…` : sentence;
}

export function buildProblemSummaries(problems: readonly Problem[], tracker: TrackerView, history: readonly SessionSummary[], today: string = localDate()): ProblemSummary[] {
  const latestByProblem = new Map<string, SessionSummary>();
  for (const s of history) {
    // A round that practises one gap is not an attempt at the problem: it must not move the redo clock or the mode.
    if (s.focus) continue;
    const prev = latestByProblem.get(s.problemId);
    if (!prev || s.createdAt > prev.createdAt) latestByProblem.set(s.problemId, s);
  }

  const rows = problems.map((p) => {
    const bullet = p.meta.tracker ? (tracker.bullets.get(p.meta.id) ?? null) : null;
    const latest = latestByProblem.get(p.meta.id) ?? null;
    const lastAttempt = latest
      ? { sessionId: latest.id, date: localDate(new Date(latest.createdAt)), mode: latest.mode, verdict: latest.verdict, readiness: latest.readiness ?? null }
      : null;
    let badge: ProblemSummary["badge"] = null;
    let redoDueOn: string | null = null;
    if (bullet?.mark === "[~]") {
      const since = lastAttempt?.date ?? newestDate(bullet.suffix);
      if (since) {
        redoDueOn = addDays(since, REDO_AFTER_DAYS);
        if (daysBetween(since, today) >= REDO_AFTER_DAYS) badge = "redo";
      }
    }
    const summary: ProblemSummary = {
      id: p.meta.id,
      track: p.meta.track,
      title: p.meta.title,
      difficulty: p.meta.difficulty,
      tags: [...p.meta.tags],
      trackerMark: bullet?.mark ?? null,
      summary: openingSummary(p.sections["Opening prompt"] ?? ""),
      lastAttempt,
      redoDueOn,
      badge,
      custom: p.custom,
    };
    return { summary, lineIndex: bullet?.lineIndex ?? Number.MAX_SAFE_INTEGER };
  });

  const newest = history.filter((h) => !h.focus).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const lastTrack = newest?.track ?? tracker.lastLogTrack;
  const fresh = rows.filter((r) => r.summary.trackerMark === "[ ]" && !r.summary.custom).sort((a, b) => a.lineIndex - b.lineIndex);
  const wanted: Track | null = lastTrack === null ? null : lastTrack === "hld" ? "lld" : "hld";
  const next = (wanted ? fresh.find((r) => r.summary.track === wanted) : undefined) ?? fresh[0];
  if (next) next.summary.badge = "next";

  return rows
    .sort(
      (a, b) =>
        Number(a.summary.custom) - Number(b.summary.custom) ||
        TRACK_ORDER[a.summary.track] - TRACK_ORDER[b.summary.track] ||
        a.lineIndex - b.lineIndex ||
        a.summary.title.localeCompare(b.summary.title),
    )
    .map((r) => r.summary);
}
