import { describe, expect, it } from "vitest";
import { MAX_LEDGER_ENTRIES, computePass, computeWeek, dayStartSeconds, mergeLedger, recentRows } from "./compute";
import { EASY, HARD, MEDIUM, at, solve } from "./support";

const from = dayStartSeconds("2026-11-02");

describe("mergeLedger", () => {
  it("keeps one entry for the same problem and time, so reading twice changes nothing", () => {
    const list = [solve("two-sum", at(2026, 11, 3)), solve("lru-cache", at(2026, 11, 4))];
    const once = mergeLedger([], list);
    expect(mergeLedger(once, list)).toEqual(once);
    expect(once).toHaveLength(2);
  });

  it("keeps a second solve of the same problem as its own entry", () => {
    const merged = mergeLedger([solve("two-sum", at(2026, 11, 3))], [solve("two-sum", at(2026, 11, 5))]);
    expect(merged.map((e) => e.timestamp)).toEqual([at(2026, 11, 5), at(2026, 11, 3)]);
  });

  it("keeps solves from before the count-from day, so moving the day later loses nothing", () => {
    const merged = mergeLedger([solve("old", at(2026, 11, 1, 23, 59))], [solve("older", at(2025, 3, 1)), solve("new", at(2026, 11, 2, 0, 0))]);
    expect(merged.map((e) => e.slug)).toEqual(["new", "old", "older"]);
  });

  it("keeps the newest entries when the cap is reached", () => {
    const many = Array.from({ length: MAX_LEDGER_ENTRIES + 10 }, (_, i) => solve(`p${i}`, 1_700_000_000 + i));
    const merged = mergeLedger([], many);
    expect(merged).toHaveLength(MAX_LEDGER_ENTRIES);
    expect(merged[0]?.slug).toBe(`p${MAX_LEDGER_ENTRIES + 9}`);
  });

  it("adds new solves to what is already saved", () => {
    const merged = mergeLedger([solve("a", at(2026, 11, 3))], [solve("b", at(2026, 11, 6))]);
    expect(merged.map((e) => e.slug)).toEqual(["b", "a"]);
  });
});

describe("computeWeek", () => {
  const cache = { a: MEDIUM, b: EASY, c: MEDIUM, d: HARD };
  // Sunday 8 November 2026 belongs to the week that began on Monday 2 November.
  const sunday = new Date(2026, 10, 8, 9, 0);

  it("starts the week at local Monday 00:00", () => {
    const entries = [solve("a", at(2026, 11, 1, 23, 59)), solve("b", at(2026, 11, 2, 0, 0)), solve("c", at(2026, 11, 8, 23, 59))];
    const week = computeWeek(entries, cache, sunday);
    expect(week.solved).toBe(2);
    expect(week.perDay).toEqual([1, 0, 0, 0, 0, 0, 1]);
  });

  it("moves to the new week after Sunday midnight", () => {
    const entries = [solve("a", at(2026, 11, 8, 23, 59)), solve("b", at(2026, 11, 9, 0, 1))];
    const monday = new Date(2026, 10, 9, 8, 0);
    expect(computeWeek(entries, cache, monday)).toEqual({ solved: 1, mediums: 0, perDay: [1, 0, 0, 0, 0, 0, 0], mediumsPerDay: [0, 0, 0, 0, 0, 0, 0] });
  });

  it("counts mediums from the saved problem details and skips unknown ones", () => {
    const entries = [solve("a", at(2026, 11, 3)), solve("b", at(2026, 11, 3)), solve("c", at(2026, 11, 4)), solve("d", at(2026, 11, 5)), solve("unknown", at(2026, 11, 5))];
    const week = computeWeek(entries, cache, sunday);
    expect(week).toEqual({ solved: 5, mediums: 2, perDay: [0, 2, 1, 2, 0, 0, 0], mediumsPerDay: [0, 1, 1, 0, 0, 0, 0] });
  });

  it("counts a problem solved twice in the week once", () => {
    const week = computeWeek([solve("a", at(2026, 11, 3)), solve("a", at(2026, 11, 6))], cache, sunday);
    expect(week).toEqual({ solved: 1, mediums: 1, perDay: [0, 1, 0, 0, 0, 0, 0], mediumsPerDay: [0, 1, 0, 0, 0, 0, 0] });
  });

  it("puts a medium on the day of its first solve, so a later resubmit does not move it", () => {
    const week = computeWeek([solve("a", at(2026, 11, 6)), solve("a", at(2026, 11, 3))], cache, sunday);
    expect(week.mediumsPerDay).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });

  it("keeps every medium of the week by day, past the ten rows the recent list shows", () => {
    const many: Record<string, typeof MEDIUM> = {};
    const entries = Array.from({ length: 12 }, (_, i) => {
      many[`m${i}`] = MEDIUM;
      return solve(`m${i}`, at(2026, 11, 3 + (i < 11 ? 0 : 2), 8, i));
    });
    const week = computeWeek(entries, many, sunday);
    expect(week.mediumsPerDay).toEqual([0, 11, 0, 1, 0, 0, 0]);
    expect(week.mediums).toBe(12);
  });
});

describe("computePass", () => {
  it("counts distinct problems by difficulty and by topic since the day", () => {
    const entries = [
      solve("a", at(2026, 11, 3)),
      solve("a", at(2026, 11, 4)),
      solve("b", at(2026, 11, 5)),
      solve("d", at(2026, 11, 6)),
      solve("early", at(2026, 10, 1)),
      solve("x", at(2026, 11, 7)),
    ];
    const { pass, topics } = computePass(entries, { a: MEDIUM, b: EASY, d: HARD, early: EASY }, from);
    expect(pass).toEqual({ solved: 4, easy: 1, medium: 1, hard: 1, unread: 1 });
    expect(topics).toEqual([
      { name: "Array", slug: "array", solved: 2 },
      { name: "Graph", slug: "graph", solved: 1 },
      { name: "Heap (Priority Queue)", slug: "heap-priority-queue", solved: 1 },
    ]);
  });
});

describe("a problem LeetCode does not know", () => {
  it("counts as not read and never as a difficulty, so the levels and unread add up", () => {
    const entries = [solve("a", at(2026, 11, 3)), solve("gone", at(2026, 11, 4)), solve("b", at(2026, 11, 5))];
    const { pass } = computePass(entries, { a: MEDIUM, b: EASY, gone: { missing: true } }, from);
    expect(pass.easy + pass.medium + pass.hard + pass.unread).toBe(pass.solved);
    expect(pass.unread).toBe(1);
    expect(recentRows(entries, { gone: { missing: true } }).find((r) => r.slug === "gone")?.difficulty).toBeNull();
  });
});

describe("recentRows", () => {
  it("lists the newest first, one row per problem, with a null difficulty when unknown", () => {
    const rows = recentRows([solve("a", at(2026, 11, 3)), solve("b", at(2026, 11, 5)), solve("a", at(2026, 11, 6))], { a: MEDIUM }, 10);
    expect(rows.map((r) => [r.slug, r.difficulty])).toEqual([
      ["a", "Medium"],
      ["b", null],
    ]);
  });

  it("stops at the limit", () => {
    const entries = Array.from({ length: 15 }, (_, i) => solve(`p${i}`, at(2026, 11, 3) + i));
    expect(recentRows(entries, {}, 10)).toHaveLength(10);
  });
});
