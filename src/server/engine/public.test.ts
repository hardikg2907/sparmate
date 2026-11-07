import { describe, expect, it } from "vitest";
import type { Session } from "../../shared/types";
import { publicSteps, toPublicSession } from "./public";

type Input = Pick<Session, "mode" | "status" | "checklist" | "stepChecks">;

const checklist: Session["checklist"] = {
  requirements: [
    { id: "requirements-1", label: "Create a short link", ask: "What can a user do when creating a link?" },
    { id: "requirements-2", label: "Redirect adds under 50 ms at p99", ask: "How fast must a redirect be?" },
    { id: "requirements-3", label: "Links expire" },
    { id: "requirements-4", label: "Delete a link", ask: "What if a link is no longer wanted?" },
  ],
  capacity: [
    { id: "capacity-1", label: "Writes" },
    { id: "capacity-2", label: "Reads" },
  ],
};

const checked: Session["stepChecks"] = {
  requirements: {
    status: "done",
    checkedAt: 90_000,
    usedImage: false,
    items: {
      "requirements-1": { state: "covered", source: "chat", at: 20_000, quote: "q", detail: "" },
      "requirements-2": { state: "partial", source: "chat", at: 30_000, quote: "q", detail: "no percentile" },
      "requirements-3": { state: "missing", source: "chat", at: null, quote: "", detail: "" },
    },
  },
};

const input = (mode: Session["mode"], status: Session["status"], stepChecks: Session["stepChecks"] = checked): Input => ({ mode, status, checklist, stepChecks });

describe("publicSteps in a guided round", () => {
  it("sends no label and no count of covered items for a step with no finished check", () => {
    const steps = publicSteps(input("guided", "live", {}));
    expect(steps.requirements).toEqual({ status: "idle", checkedAt: null, usedImage: false, items: [], covered: 0, partial: 0, total: 4 });
    expect(steps.capacity?.total).toBe(2);
    expect(JSON.stringify(steps)).not.toContain("50 ms");
    expect(JSON.stringify(steps)).not.toContain("redirect be");
  });

  it("holds the labels back while a first check is still running", () => {
    const running: Session["stepChecks"] = { requirements: { status: "checking", checkedAt: null, usedImage: false, items: {} } };
    const step = publicSteps(input("guided", "live", running)).requirements;
    expect(step).toMatchObject({ status: "checking", items: [], total: 4 });
  });

  it("keeps covered labels and swaps in the question for partial and missing items", () => {
    const step = publicSteps(input("guided", "paused")).requirements;
    expect(step?.items.map((i) => [i.label, i.question, i.state])).toEqual([
      ["Create a short link", false, "covered"],
      ["How fast must a redirect be?", true, "partial"],
      ["Links expire", false, "missing"],
      ["What if a link is no longer wanted?", true, "missing"],
    ]);
    expect(step).toMatchObject({ covered: 1, partial: 1, total: 4 });
    expect(step?.items[1]?.detail).toBe("no percentile");
  });

  it("shows the requirement itself in a step the check left idle once it has a check time", () => {
    const step = publicSteps(input("guided", "live", { capacity: { status: "done", checkedAt: 5, usedImage: false, items: {} } })).capacity;
    expect(step?.items.map((i) => [i.label, i.question])).toEqual([
      ["Writes", false],
      ["Reads", false],
    ]);
  });

  it("shows an unchecked step's items again once the round is over", () => {
    for (const status of ["debriefing", "debriefed", "failed"] as const) {
      const steps = publicSteps(input("guided", status, {}));
      expect(steps.requirements?.items.map((i) => i.label)).toEqual(["Create a short link", "Redirect adds under 50 ms at p99", "Links expire", "Delete a link"]);
      expect(steps.requirements?.items.every((i) => !i.question)).toBe(true);
    }
  });
});

describe("publicSteps outside a guided round", () => {
  it("sends an interview round nothing until it ends", () => {
    for (const status of ["live", "paused", "ended"] as const) expect(publicSteps(input("interview", status))).toEqual({});
  });

  it("sends an interview debrief every label as a statement", () => {
    const step = publicSteps(input("interview", "debriefed")).requirements;
    expect(step?.items.map((i) => i.label)).toEqual(["Create a short link", "Redirect adds under 50 ms at p99", "Links expire", "Delete a link"]);
    expect(step?.items.every((i) => !i.question)).toBe(true);
  });
});

describe("the browser's copy of a session", () => {
  it("leaves out the hidden notes held for the interviewer", () => {
    const session = {
      ...input("interview", "paused"),
      pendingEvents: ["the candidate paused the clock at 02:00"],
      transcript: [],
      hints: [],
      board: { version: 0, graphText: "", updatedAt: null },
      track: "hld",
      durationMs: 45 * 60_000,
      startedAt: "",
      pausedMs: 0,
      pauseStartedAt: null,
      sdk: {},
      pins: [],
    } as unknown as Session;
    expect("pendingEvents" in toPublicSession(session, undefined)).toBe(false);
  });
});
