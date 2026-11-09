import { describe, expect, it } from "vitest";
import type { SessionHistoryItem } from "../../shared/types";
import { focusTrend } from "./focusTrend";

function round(n: number, depth: number | null, mode: "interview" | "guided" = "interview"): SessionHistoryItem {
  return {
    id: `r${n}`,
    problemId: "p",
    title: "p",
    track: "hld",
    mode,
    createdAt: `2026-11-0${n}T10:00:00.000Z`,
    status: "debriefed",
    verdict: null,
    pause: null,
    notesSaved: false,
    scores: depth === null ? [{ id: "other", name: "Other", score: 2 }] : [{ id: "depth", name: "Depth", score: depth }],
  };
}

describe("focusTrend", () => {
  it("lists the newest scores oldest first and keeps at most five", () => {
    const history = [1, 2, 3, 4, 5, 6].map((n) => round(n, n % 4 || 1));
    expect(focusTrend(history, "depth")).toEqual([2, 3, 1, 1, 2]);
  });

  it("skips a round that did not score the skill", () => {
    expect(focusTrend([round(1, 2), round(2, null), round(3, 3)], "depth")).toEqual([2, 3]);
  });

  it("follows the same mode as the focus skill, so interview rounds win over guided", () => {
    expect(focusTrend([round(1, 4, "guided"), round(2, 2)], "depth")).toEqual([2]);
  });

  it("is empty without scored rounds", () => {
    expect(focusTrend([], "depth")).toEqual([]);
  });
});
