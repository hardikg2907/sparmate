import { describe, expect, it } from "vitest";
import { teachMessage } from "../../shared/gaps";
import type { GapProgress } from "../../shared/types";
import { currentGap, gapBadge, gapCounts, gapMarks, gapState, gapsComplete, progressText } from "./gapMarks";

const gaps = [{ title: "Hot keys" }, { title: "Retries" }, { title: "Backpressure" }];
const rec = (by: GapProgress["by"], state: GapProgress["state"]): GapProgress => ({ by, state, at: "2026-11-01T10:00:00.000Z" });

describe("gapMarks", () => {
  it("reads records alone when the round has any", () => {
    const marks = gapMarks(gaps, { Retries: rec("coach", "started") }, [teachMessage(gaps[0]!)]);
    expect([...marks.keys()]).toEqual(["Retries"]);
  });

  it("falls back to the messages in the coach chat when the round has no records", () => {
    const marks = gapMarks(gaps, {}, [`  ${teachMessage(gaps[1]!)}  `, "Teach me this gap: Unknown gap", "hello"]);
    expect([...marks.entries()]).toEqual([["Retries", "sent"]]);
  });

  it("ignores records for titles the scorecard does not list", () => {
    const marks = gapMarks(gaps, { Elsewhere: rec("coach", "taught") }, [teachMessage(gaps[0]!)]);
    expect([...marks.entries()]).toEqual([["Hot keys", "sent"]]);
  });

  it("does not treat inherited object keys as records", () => {
    expect(gapMarks([{ title: "toString" }], {}, []).size).toBe(0);
  });
});

const at = (iso: string, state: GapProgress["state"] = "started", by: GapProgress["by"] = "coach"): GapProgress => ({ by, state, at: iso });

describe("gapState", () => {
  it("derives each state from the stored data", () => {
    expect(gapState(undefined)).toBe("not_started");
    expect(gapState(rec("coach", "started"))).toBe("with_coach");
    expect(gapState(rec("candidate", "started"))).toBe("with_coach");
    expect(gapState("sent")).toBe("with_coach");
    expect(gapState(rec("coach", "taught"))).toBe("done");
    expect(gapState(rec("candidate", "taught"))).toBe("done");
    expect(gapState(rec("coach", "core_only"))).toBe("later");
  });
});

describe("gapBadge", () => {
  it("shows nothing for a gap that has not started", () => {
    expect(gapBadge("not_started")).toBeNull();
  });

  it("names the other states, with a tick on none but done", () => {
    expect(gapBadge("with_coach")).toEqual({ label: "With the coach", tone: "accent" });
    expect(gapBadge("done")).toEqual({ label: "Done", tone: "good" });
    expect(gapBadge("later")).toEqual({ label: "Core idea done, rest later", tone: "warn" });
  });
});

describe("currentGap", () => {
  it("is the first gap not started when nothing is with the coach", () => {
    const marks = gapMarks(gaps, { "Hot keys": rec("coach", "taught") }, []);
    expect(currentGap(gaps, marks)?.title).toBe("Retries");
  });

  it("never skips a gap the coach opened by itself", () => {
    const marks = gapMarks(gaps, { "Hot keys": rec("coach", "started") }, []);
    expect(currentGap(gaps, marks)?.title).toBe("Hot keys");
  });

  it("prefers the with-coach gap with the newest record", () => {
    const marks = gapMarks(
      gaps,
      { "Hot keys": at("2026-11-01T10:00:00.000Z"), Backpressure: at("2026-11-01T10:05:00.000Z"), Retries: at("2026-11-01T10:01:00.000Z", "taught") },
      [],
    );
    expect(currentGap(gaps, marks)?.title).toBe("Backpressure");
  });

  it("takes the first in severity order when the records carry no time", () => {
    const marks = new Map<string, "sent">([
      ["Retries", "sent"],
      ["Backpressure", "sent"],
    ]);
    expect(currentGap(gaps, marks)?.title).toBe("Retries");
  });

  it("falls back to the first gap not started when a later gap is done or for later", () => {
    const marks = gapMarks(gaps, { "Hot keys": rec("coach", "core_only"), Retries: rec("coach", "taught") }, []);
    expect(currentGap(gaps, marks)?.title).toBe("Backpressure");
  });

  it("is none when every gap is done or for later", () => {
    const marks = gapMarks(gaps, { "Hot keys": rec("coach", "taught"), Retries: rec("coach", "core_only"), Backpressure: rec("coach", "taught") }, []);
    expect(currentGap(gaps, marks)).toBeUndefined();
    expect(currentGap([], new Map())).toBeUndefined();
  });
});

describe("gapsComplete and gapCounts", () => {
  it("does not count a started gap as complete", () => {
    const marks = gapMarks(gaps, { "Hot keys": rec("coach", "taught"), Retries: rec("coach", "taught"), Backpressure: rec("coach", "started") }, []);
    expect(gapsComplete(gaps, marks)).toBe(false);
    expect(gapCounts(gaps, marks)).toEqual({ total: 3, done: 2, withCoach: 1 });
  });

  it("counts done and for-later gaps as complete", () => {
    const marks = gapMarks(gaps, { "Hot keys": rec("coach", "taught"), Retries: rec("coach", "core_only"), Backpressure: rec("candidate", "taught") }, []);
    expect(gapsComplete(gaps, marks)).toBe(true);
  });

  it("is complete when the round has no gaps", () => {
    expect(gapsComplete([], new Map())).toBe(true);
  });
});

describe("progressText", () => {
  it("words the progress line", () => {
    expect(progressText({ total: 6, done: 2, withCoach: 1 })).toBe("Gaps: 2 of 6 done · 1 with the coach");
    expect(progressText({ total: 6, done: 6, withCoach: 0 })).toBe("Gaps: 6 of 6 done");
  });
});
