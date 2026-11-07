import { describe, expect, it } from "vitest";
import { teachMessage } from "../../shared/gaps";
import type { GapProgress } from "../../shared/types";
import { gapBadge, gapMarks, startHere, teachLabel, workedText } from "./gapMarks";

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

describe("gapBadge and teachLabel", () => {
  it("shows nothing and offers Teach me this when there is no record", () => {
    expect(gapBadge(undefined)).toBeNull();
    expect(teachLabel(undefined)).toBe("Teach me this");
  });

  it("names each state", () => {
    expect(gapBadge(rec("candidate", "started"))?.label).toBe("Sent to the coach");
    expect(gapBadge(rec("coach", "started"))?.label).toBe("Started by the coach");
    expect(gapBadge(rec("coach", "taught"))?.label).toBe("Taught");
    expect(gapBadge(rec("candidate", "taught"))?.label).toBe("Taught");
    expect(gapBadge(rec("coach", "core_only"))?.label).toBe("Core idea only, topic session later");
    expect(gapBadge("sent")?.label).toBe("Sent to the coach");
  });

  it("offers Ask again once there is any mark", () => {
    expect(teachLabel(rec("coach", "started"))).toBe("Ask again");
    expect(teachLabel("sent")).toBe("Ask again");
  });
});

describe("startHere", () => {
  it("picks the first gap with no record, in the order given", () => {
    const marks = gapMarks(gaps, { "Hot keys": rec("coach", "taught"), Backpressure: rec("candidate", "started") }, []);
    expect(startHere(gaps, marks)?.title).toBe("Retries");
  });

  it("picks nothing once every gap has a record", () => {
    const marks = gapMarks(gaps, { "Hot keys": rec("coach", "taught"), Retries: rec("coach", "started"), Backpressure: rec("coach", "core_only") }, []);
    expect(startHere(gaps, marks)).toBeUndefined();
  });
});

describe("workedText", () => {
  it("words the step bar detail", () => {
    expect(workedText(2, 5)).toBe("2 of 5 worked with the coach");
  });
});
