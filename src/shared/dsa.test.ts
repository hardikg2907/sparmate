import { describe, expect, it } from "vitest";
import { COMMON_TOPICS, topicFocus, withDefaultCountFrom, type DsaTopic } from "./dsa";
import { DEFAULT_SETTINGS, SettingsSchema } from "./types";
import { isPastOrToday, localDay } from "./week";

const everyTopic = (solved: (slug: string, i: number) => number): DsaTopic[] => COMMON_TOPICS.map((t, i) => ({ name: t.name, slug: t.slug, solved: solved(t.slug, i) }));

describe("topicFocus", () => {
  it("lists every common topic with no solve, counting a missing topic as zero", () => {
    const focus = topicFocus([
      { name: "Array", slug: "array", solved: 5 },
      { name: "Sorting", slug: "sorting", solved: 9 },
    ]);
    expect(focus.untouched).toBe(true);
    expect(focus.topics).toHaveLength(COMMON_TOPICS.length - 1);
    expect(focus.topics.every((t) => t.solved === 0)).toBe(true);
    expect(focus.topics.map((t) => t.slug)).not.toContain("array");
    expect(focus.topics.map((t) => t.slug)).not.toContain("sorting");
  });

  it("lists all of them when nothing was solved", () => {
    expect(topicFocus([]).topics).toHaveLength(COMMON_TOPICS.length);
  });

  it("gives the three with the fewest once every common topic has a solve", () => {
    const focus = topicFocus(everyTopic((slug, i) => (slug === "trie" ? 1 : slug === "greedy" ? 2 : slug === "stack" ? 3 : 10 + i)));
    expect(focus.untouched).toBe(false);
    expect(focus.topics.map((t) => [t.name, t.solved])).toEqual([
      ["Trie", 1],
      ["Greedy", 2],
      ["Stack", 3],
    ]);
  });

  it("breaks a tie by the order of the common list", () => {
    const focus = topicFocus(everyTopic(() => 4));
    expect(focus.topics.map((t) => t.name)).toEqual(["Array", "String", "Hash Table"]);
  });
});

describe("count-from day", () => {
  const now = new Date(2026, 10, 8, 15, 0);

  it("accepts today and earlier real days", () => {
    expect(isPastOrToday("2026-11-08", now)).toBe(true);
    expect(isPastOrToday("2025-02-28", now)).toBe(true);
    expect(isPastOrToday("2024-02-29", now)).toBe(true);
  });

  it.each(["2026-11-09", "2027-01-01", "2026-02-30", "2025-02-29", "2026-13-01", "2026-1-5", "yesterday", ""])("rejects %s", (day) => {
    expect(isPastOrToday(day, now)).toBe(false);
  });

  it("formats a local day", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("is checked by the settings schema", () => {
    const today = localDay(new Date());
    expect(SettingsSchema.parse({ ...DEFAULT_SETTINGS, dsaCountFrom: today }).dsaCountFrom).toBe(today);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, dsaCountFrom: "2999-01-01" }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, dsaCountFrom: "2026-02-31" }).success).toBe(false);
    expect(SettingsSchema.parse(DEFAULT_SETTINGS).dsaCountFrom).toBeUndefined();
  });
});

describe("withDefaultCountFrom", () => {
  it("sets today when a username is saved without a day", () => {
    expect(withDefaultCountFrom({ ...DEFAULT_SETTINGS, leetcodeUsername: "example_user" }, "2026-11-08").dsaCountFrom).toBe("2026-11-08");
  });

  it("keeps a day that is already set", () => {
    const settings = { ...DEFAULT_SETTINGS, leetcodeUsername: "example_user", dsaCountFrom: "2026-01-02" };
    expect(withDefaultCountFrom(settings, "2026-11-08")).toBe(settings);
  });

  it("leaves settings without a username alone", () => {
    expect(withDefaultCountFrom(DEFAULT_SETTINGS, "2026-11-08")).toBe(DEFAULT_SETTINGS);
  });
});
