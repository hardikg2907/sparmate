import { describe, expect, it } from "vitest";
import type { ProblemSummary, SessionHistoryItem } from "../../shared/types";
import { DEFAULT_WEEKLY_PLAN } from "../../shared/week";
import { buildItems, filterItems, matchesQuery, pausedHint, type PaletteItem } from "./palette";

function problem(id: string, title: string, extra: Partial<ProblemSummary> = {}): ProblemSummary {
  return { id, track: "hld", title, difficulty: "medium", tags: [], trackerMark: "[ ]", lastAttempt: null, summary: "", badge: null, custom: false, ...extra };
}

const paused: SessionHistoryItem = {
  id: "r1",
  problemId: "lld-elevator",
  title: "Elevator Controller",
  track: "lld",
  mode: "interview",
  createdAt: "2026-11-09T10:00:00.000Z",
  status: "paused",
  verdict: null,
  pause: { reason: "user", pausedAt: "2026-11-09T10:43:00.000Z", timeLeftMs: 77 * 60000 },
  notesSaved: false,
  clock: { startedAt: "2026-11-09T10:00:00.000Z", pausedMs: 0, pauseStartedAt: "2026-11-09T10:43:00.000Z", durationMs: 120 * 60000 },
};

describe("matchesQuery", () => {
  it("matches an empty query", () => {
    expect(matchesQuery("Rate Limiter", "  ")).toBe(true);
  });
  it("matches a substring without regard to case", () => {
    expect(matchesQuery("Rate Limiter", "LIMIT")).toBe(true);
    expect(matchesQuery("Rate Limiter", "e lim")).toBe(true);
  });
  it("matches when each query word starts a word of the text", () => {
    expect(matchesQuery("URL Shortener HLD", "sh url")).toBe(true);
    expect(matchesQuery("Parking Lot", "lot park")).toBe(true);
  });
  it("does not match words that only start in the middle of a word", () => {
    expect(matchesQuery("Rate Limiter", "x")).toBe(false);
    expect(matchesQuery("Rate Limiter", "ate imi")).toBe(false);
    expect(matchesQuery("Rate Limiter", "rate zzz")).toBe(false);
  });
});

describe("filterItems", () => {
  const item = (id: string, group: PaletteItem["group"], label: string): PaletteItem => ({ id, group, label, action: { kind: "go", href: "/" } });
  const items = [item("1", "pages", "Practice"), item("2", "problems", "Notification System"), item("3", "problems", "Rate Limiter"), item("4", "continue", "Elevator")];

  it("keeps the group order whatever the input order", () => {
    expect(filterItems(items, "").map((i) => i.id)).toEqual(["4", "2", "3", "1"]);
  });
  it("puts a label that starts with the query first inside its group", () => {
    expect(filterItems(items, "r").map((i) => i.id)).toEqual(["4", "3", "1"]);
    expect(filterItems([item("a", "problems", "Distributed Rate Limiter"), item("b", "problems", "Rate Limiter")], "rate").map((i) => i.id)).toEqual(["b", "a"]);
  });
  it("returns nothing when no row matches", () => {
    expect(filterItems(items, "zzz")).toEqual([]);
  });
});

describe("buildItems", () => {
  const now = new Date("2026-11-10T09:00:00");
  const problems = [problem("hld-rate", "Rate Limiter", { badge: "next" }), problem("lld-elevator", "Elevator Controller", { track: "lld", difficulty: "hard" })];

  it("lists an open round under Continue with its clock", () => {
    const items = buildItems({ now, plan: DEFAULT_WEEKLY_PLAN, problems, history: [paused] });
    const row = items.find((i) => i.group === "continue");
    expect(row).toMatchObject({ label: "Elevator Controller", hint: "Paused, 43 of 120 min", action: { kind: "go", href: "/session/r1" } });
  });
  it("lists every problem with its track and difficulty", () => {
    const rows = buildItems({ now, plan: DEFAULT_WEEKLY_PLAN, problems, history: [] }).filter((i) => i.group === "problems");
    expect(rows.map((r) => r.hint)).toEqual(["HLD Medium", "LLD Hard"]);
  });
  it("offers the recommended round under Start, and none when nothing is recommended", () => {
    const tuesday = new Date("2026-11-10T09:00:00");
    const items = buildItems({ now: tuesday, plan: ["hld", "hld", "hld", "hld", "hld", "hld", "hld"], problems, history: [] });
    expect(items.find((i) => i.group === "start")).toMatchObject({ action: { kind: "start", problemId: "hld-rate" } });
    expect(buildItems({ now, plan: ["rest", "rest", "rest", "rest", "rest", "rest", "rest"], problems, history: [] }).some((i) => i.group === "start")).toBe(false);
  });
  it("always has the pages and the settings sections", () => {
    const items = buildItems({ now, plan: DEFAULT_WEEKLY_PLAN, problems: [], history: [] });
    expect(items.filter((i) => i.group === "pages").length).toBeGreaterThanOrEqual(5);
    expect(items.some((i) => i.group === "settings" && i.action.kind === "go" && i.action.href === "/settings#models")).toBe(true);
  });
});

describe("pausedHint", () => {
  it("is null for a round with no clock", () => {
    const { clock: _clock, ...bare } = paused;
    expect(pausedHint(bare, 0)).toBeNull();
  });
});
