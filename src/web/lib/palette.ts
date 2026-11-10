import type { Mode } from "../../shared/phases";
import type { ProblemSummary, SessionHistoryItem } from "../../shared/types";
import { clockUsedMs, isOpenRound, selectToday } from "../../shared/today";
import type { DayKind } from "../../shared/week";
import { MODE_LABEL, TRACK_LABEL, formatDate } from "./format";

export type PaletteGroup = "continue" | "start" | "rounds" | "problems" | "pages" | "settings";

export const GROUP_ORDER: readonly PaletteGroup[] = ["continue", "start", "rounds", "problems", "pages", "settings"];
export const GROUP_LABEL: Record<PaletteGroup, string> = { continue: "Continue", start: "Start", rounds: "Rounds", problems: "Problems", pages: "Pages", settings: "Settings" };

/** What Enter does: go to an address, or start a round on a problem. */
export type PaletteAction = { kind: "go"; href: string } | { kind: "start"; problemId: string; mode: Mode };

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Quiet text at the right of the row. */
  hint?: string;
  /** Words that find the row but are not shown. */
  keywords?: string;
  action: PaletteAction;
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * A row matches when the query is a substring of its text, or when every word of the query starts a word of the
 * text. The second rule lets "url sh" find "URL Shortener" and "lld pa" find "Parking Lot" in the LLD track.
 */
export function matchesQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = text.toLowerCase();
  if (haystack.includes(needle)) return true;
  const have = words(haystack);
  return words(needle).every((part) => have.some((word) => word.startsWith(part)));
}

/** With no query, a group that can grow long shows only its newest rows. Typing searches all of them. */
const QUIET_LIMIT: Partial<Record<PaletteGroup, number>> = { rounds: 5 };

/** Rows that match, in group order. Inside a group, a label that starts with the query comes first. */
export function filterItems(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const needle = query.trim().toLowerCase();
  const kept = items.filter((item) => matchesQuery(`${item.label} ${item.hint ?? ""} ${item.keywords ?? ""}`, needle));
  const rank = (item: PaletteItem) => (needle !== "" && item.label.toLowerCase().startsWith(needle) ? 0 : 1);
  return GROUP_ORDER.flatMap((group) => {
    const rows = kept
      .filter((item) => item.group === group)
      .map((item, index) => ({ item, index }))
      .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
      .map((entry) => entry.item);
    const limit = QUIET_LIMIT[group];
    return needle === "" && limit !== undefined ? rows.slice(0, limit) : rows;
  });
}

const PAGES: { href: string; label: string; keywords?: string }[] = [
  { href: "/", label: "Today" },
  { href: "/practice", label: "Practice", keywords: "rounds library" },
  { href: "/practice/drills", label: "Drills", keywords: "practice gym" },
  { href: "/practice/new", label: "Practise any question", keywords: "custom own" },
  { href: "/progress", label: "Progress" },
  { href: "/progress#skills", label: "Skills", keywords: "progress scores" },
  { href: "/progress#dsa", label: "DSA", keywords: "progress leetcode" },
  { href: "/progress#history", label: "History", keywords: "progress rounds" },
  { href: "/usage", label: "Usage", keywords: "cost tokens" },
];

const SETTINGS_SECTIONS: { id: string; label: string }[] = [
  { id: "plan", label: "Weekly plan" },
  { id: "dsa", label: "DSA and LeetCode" },
  { id: "rounds", label: "Rounds" },
  { id: "models", label: "Models" },
  { id: "voice", label: "Voice and theme" },
  { id: "folder", label: "Study folder" },
];

/** The clock text of a paused round, for example "Paused, 43 of 120 min". Null when the round has no clock reading. */
export function pausedHint(item: SessionHistoryItem, nowMs: number): string | null {
  const used = clockUsedMs(item, nowMs);
  const total = item.clock?.durationMs;
  if (item.pause === null || used === null || !total) return null;
  return `Paused, ${Math.floor(used / 60000)} of ${Math.round(total / 60000)} min`;
}

export interface PaletteInput {
  now: Date;
  plan: readonly DayKind[];
  problems: readonly ProblemSummary[];
  history: readonly SessionHistoryItem[];
}

export function buildItems({ now, plan, problems, history }: PaletteInput): PaletteItem[] {
  const items: PaletteItem[] = [];
  const nowMs = now.getTime();
  for (const round of history.filter(isOpenRound)) {
    items.push({
      id: `continue:${round.id}`,
      group: "continue",
      label: round.title,
      hint: pausedHint(round, nowMs) ?? "Round open",
      keywords: `${MODE_LABEL[round.mode]} ${TRACK_LABEL[round.track]}`,
      action: { kind: "go", href: `/session/${round.id}` },
    });
  }
  const finished = history.filter((round) => !isOpenRound(round)).sort((a, b) => Date.parse(b.endedAt ?? b.createdAt) - Date.parse(a.endedAt ?? a.createdAt));
  for (const round of finished) {
    items.push({
      id: `round:${round.id}`,
      group: "rounds",
      label: round.title,
      hint: `${round.focus ? "Gap round" : MODE_LABEL[round.mode]}, ${formatDate(round.endedAt ?? round.createdAt)}`,
      keywords: `${TRACK_LABEL[round.track]} debrief`,
      action: { kind: "go", href: `/session/${round.id}` },
    });
  }
  const pick = selectToday({ now, plan, problems, history });
  if (pick.hero.kind === "problem") {
    const { problem, mode, reason } = pick.hero;
    items.push({
      id: `start:${problem.id}`,
      group: "start",
      label: `Start ${problem.title}`,
      hint: `Today, ${reason === "redo" ? "redo due" : "new"}, ${MODE_LABEL[mode].toLowerCase()}`,
      keywords: "recommended round today",
      action: { kind: "start", problemId: problem.id, mode },
    });
  }
  for (const problem of problems) {
    items.push({
      id: `problem:${problem.id}`,
      group: "problems",
      label: problem.title,
      hint: `${TRACK_LABEL[problem.track]} ${problem.difficulty[0]?.toUpperCase()}${problem.difficulty.slice(1)}`,
      keywords: problem.difficulty,
      action: { kind: "go", href: `/practice#${problem.id}` },
    });
  }
  for (const page of PAGES) {
    items.push({ id: `page:${page.href}`, group: "pages", label: page.label, hint: "Page", keywords: page.keywords, action: { kind: "go", href: page.href } });
  }
  for (const section of SETTINGS_SECTIONS) {
    items.push({ id: `settings:${section.id}`, group: "settings", label: section.label, hint: "Settings", action: { kind: "go", href: `/settings#${section.id}` } });
  }
  return items;
}
