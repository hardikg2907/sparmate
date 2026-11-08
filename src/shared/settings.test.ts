import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SettingsSchema } from "./types";
import { DEFAULT_WEEKLY_PLAN, planIndex, weekStart } from "./week";

const { weeklyPlan: _plan, dsaWeeklyGoal: _goal, ...OLD_FILE } = DEFAULT_SETTINGS;

describe("settings schema", () => {
  it("loads a file saved before the weekly plan existed and fills the defaults", () => {
    const parsed = SettingsSchema.parse(OLD_FILE);
    expect(parsed.weeklyPlan).toEqual(["dsa", "hld", "dsa", "hld", "dsa", "lld", "redo"]);
    expect(parsed.dsaWeeklyGoal).toBe(3);
    expect(parsed.leetcodeUsername).toBeUndefined();
  });

  it("does not share the default plan between parses", () => {
    const a = SettingsSchema.parse(OLD_FILE);
    a.weeklyPlan[0] = "rest";
    expect(SettingsSchema.parse(OLD_FILE).weeklyPlan[0]).toBe("dsa");
    expect(DEFAULT_WEEKLY_PLAN[0]).toBe("dsa");
  });

  it("accepts a full, valid file", () => {
    const next = { ...DEFAULT_SETTINGS, weeklyPlan: ["rest", "rest", "hld", "lld", "dsa", "redo", "rest"], leetcodeUsername: "some_user-1", dsaWeeklyGoal: 30 };
    expect(SettingsSchema.parse(next)).toEqual(next);
  });

  it.each([
    ["a plan with six days", { weeklyPlan: ["dsa", "hld", "dsa", "hld", "dsa", "lld"] }],
    ["a plan with eight days", { weeklyPlan: [...DEFAULT_WEEKLY_PLAN, "rest"] }],
    ["an unknown day kind", { weeklyPlan: ["dsa", "hld", "dsa", "hld", "dsa", "lld", "gym"] }],
    ["an empty username", { leetcodeUsername: "" }],
    ["a username with a space", { leetcodeUsername: "bad name" }],
    ["a username with a slash", { leetcodeUsername: "a/b" }],
    ["a username of 41 characters", { leetcodeUsername: "a".repeat(41) }],
    ["a goal of 0", { dsaWeeklyGoal: 0 }],
    ["a goal of 31", { dsaWeeklyGoal: 31 }],
    ["a fractional goal", { dsaWeeklyGoal: 2.5 }],
    ["an unknown key", { extra: true }],
  ])("rejects %s", (_name, patch) => {
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...patch }).success).toBe(false);
  });
});

describe("week helpers", () => {
  it("counts Monday as day 0 and Sunday as day 6", () => {
    expect(planIndex(new Date(2026, 10, 9))).toBe(0);
    expect(planIndex(new Date(2026, 10, 15))).toBe(6);
  });

  it("finds the Monday of the week", () => {
    const start = weekStart(new Date(2026, 10, 15, 22, 5));
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 10, 9, 0]);
  });
});
