import { describe, expect, it } from "vitest";
import type { Problem } from "../../shared/problem";
import { buildProblemSummaries, daysBetween, lastTableRow, newestDate, trackFromLogRow, type TrackerBullet } from "./recommend";
import type { SessionSummary } from "./store";

function problem(id: string, track: "hld" | "lld", custom = false): Problem {
  return {
    meta: {
      id,
      track,
      title: id,
      difficulty: "easy",
      tags: [],
      tracker: custom ? null : { section: track === "hld" ? "### C2. Classic HLD Problems" : "### B3. Applied", bullet: id },
      notesFile: `notes/${id}.md`,
      ...(track === "lld" ? { lldFolder: id } : {}),
    },
    sections: {},
    body: "",
    file: `/x/${id}.md`,
    custom,
  };
}

function session(problemId: string, track: "hld" | "lld", createdAt: string): SessionSummary {
  return { id: `x-${problemId}`, problemId, title: problemId, track, mode: "interview", createdAt, status: "debriefed", verdict: "hire", pause: null, notesSaved: false };
}

const problems = [problem("c2-url", "hld"), problem("c2-chat", "hld"), problem("b3-lot", "lld"), problem("b3-elevator", "lld"), problem("custom-x", "hld", true)];

function bullets(entries: [string, TrackerBullet][]) {
  return new Map(entries);
}

describe("last attempt", () => {
  it("carries the readiness call of a guided attempt, and null when there is none", () => {
    const attempt = (readiness?: "ready" | "not_yet" | null): SessionSummary => ({
      ...session("c2-url", "hld", "2026-10-28T10:00:00.000Z"),
      mode: "guided",
      ...(readiness === undefined ? {} : { readiness }),
    });
    const last = (h: SessionSummary) => buildProblemSummaries(problems, { bullets: new Map(), lastLogTrack: null }, [h], "2026-10-29").find((p) => p.id === "c2-url")?.lastAttempt;
    expect(last(attempt("ready"))).toMatchObject({ mode: "guided", readiness: "ready" });
    expect(last(attempt())?.readiness).toBeNull();
  });
});

describe("recommendation", () => {
  const marks = bullets([
    ["b3-lot", { lineIndex: 230, mark: "[~]", suffix: "→ notes/b3-parking-lot.md · 2026-10-25" }],
    ["b3-elevator", { lineIndex: 233, mark: "[ ]", suffix: null }],
    ["c2-url", { lineIndex: 251, mark: "[ ]", suffix: null }],
    ["c2-chat", { lineIndex: 254, mark: "[ ]", suffix: null }],
  ]);

  it("recommends the first new HLD problem after an LLD session in the log", () => {
    const out = buildProblemSummaries(problems, { bullets: marks, lastLogTrack: "lld" }, [], "2026-10-29");
    expect(out.filter((p) => p.badge === "next").map((p) => p.id)).toEqual(["c2-url"]);
    expect(out.find((p) => p.id === "b3-lot")?.badge).toBeNull();
  });

  it("prefers app history over the log for the last track", () => {
    const out = buildProblemSummaries(problems, { bullets: marks, lastLogTrack: "lld" }, [session("c2-url", "hld", "2026-10-28T10:00:00.000Z")], "2026-10-29");
    expect(out.filter((p) => p.badge === "next").map((p) => p.id)).toEqual(["b3-elevator"]);
    expect(out.find((p) => p.id === "c2-url")?.lastAttempt?.verdict).toBe("hire");
  });

  it("marks a [~] problem for redo after 7 days from the tracker date when there is no app attempt", () => {
    const out = buildProblemSummaries(problems, { bullets: marks, lastLogTrack: "lld" }, [], "2026-11-01");
    expect(out.find((p) => p.id === "b3-lot")?.badge).toBe("redo");
    expect(buildProblemSummaries(problems, { bullets: marks, lastLogTrack: null }, [], "2026-10-31").find((p) => p.id === "b3-lot")?.badge).toBeNull();
  });

  it("uses the latest app attempt date over the tracker date for redo", () => {
    const recent = [session("b3-lot", "lld", "2026-10-30T10:00:00.000Z")];
    expect(buildProblemSummaries(problems, { bullets: marks, lastLogTrack: null }, recent, "2026-11-02").find((p) => p.id === "b3-lot")?.badge).toBeNull();
  });

  it("falls back to the other track when the wanted one has no new problem, and gives exactly one next", () => {
    const allLldDone = bullets([...marks].map(([k, v]) => [k, k.startsWith("b3") ? { ...v, mark: "[x]" as const } : v]));
    const out = buildProblemSummaries(problems, { bullets: allLldDone, lastLogTrack: "hld" }, [], "2026-10-29");
    expect(out.filter((p) => p.badge === "next").map((p) => p.id)).toEqual(["c2-url"]);
  });

  it("leaves custom problems without a mark or badge and lists them last", () => {
    const out = buildProblemSummaries(problems, { bullets: marks, lastLogTrack: "lld" }, [], "2026-10-29");
    expect(out.at(-1)).toMatchObject({ id: "custom-x", trackerMark: null, badge: null, custom: true });
    expect(out.map((p) => p.id).slice(0, 2)).toEqual(["c2-url", "c2-chat"]);
  });
});

describe("tracker helpers", () => {
  it("reads the track from a Session Log row", () => {
    expect(trackFromLogRow("| 2026-10-25 | **B3 Parking Lot** — first timed round | `[~]` | notes/b3-parking-lot.md |")).toBe("lld");
    expect(trackFromLogRow("| 2026-10-24 | **C2 Rate Limiter**, part 2 | x | y |")).toBe("hld");
    expect(trackFromLogRow("| 2026-10-04 | **A4** — pooling | x | y |")).toBeNull();
  });

  it("finds the last data row of a table excerpt", () => {
    const table = "| Date | Topic(s) | Outcome | Notes file |\n|---|---|---|---|\n| a | B3 | x | y |\n| b | C2 | x | y |";
    expect(lastTableRow(table)).toBe("| b | C2 | x | y |");
    expect(lastTableRow("| Date | Topic(s) |\n|---|---|")).toBeNull();
  });

  it("finds the newest date in a suffix and counts days", () => {
    expect(newestDate("→ notes/a.md · 2026-10-19 · notes/b.md · 2026-10-25")).toBe("2026-10-25");
    expect(daysBetween("2026-10-25", "2026-11-01")).toBe(7);
  });
});

describe("openingSummary", () => {
  it("keeps the first sentence of the opening prompt and nothing else", async () => {
    const { openingSummary } = await import("./recommend");
    expect(openingSummary("Design a parking lot. Build it as a running program.\n\nSecond paragraph.")).toBe("Design a parking lot.");
    expect(openingSummary("Let's design `bit.ly`? Where to start.")).toBe("Let's design bit.ly?");
    expect(openingSummary("")).toBe("");
    expect(openingSummary("x".repeat(300)).length).toBeLessThanOrEqual(160);
  });
});
