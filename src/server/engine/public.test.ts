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
  entities: [
    { id: "entities-1", label: "Link" },
    { id: "entities-2", label: "ClickCount" },
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
  it("sends no checklist, no label and no count while the round runs", () => {
    for (const status of ["live", "paused", "ended"] as const) {
      const steps = publicSteps(input("guided", status));
      expect(steps).toEqual({});
      expect(JSON.stringify(steps)).not.toContain("50 ms");
    }
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

describe("the browser's copy of a guided session", () => {
  const guided = (extra: Partial<Session> = {}): Session =>
    ({
      ...input("guided", "live"),
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
      ...extra,
    }) as unknown as Session;

  it("sends the step verdicts and only the count of assists in a live round", () => {
    const view = toPublicSession(
      guided({ stepVerdicts: { requirements: { verdict: "not_yet", gap: "What is the latency target?", at: 1000 } }, assists: [{ at: 2000, phase: "entities" }] }),
      undefined,
    );
    expect(view.stepVerdicts).toEqual({ requirements: { verdict: "not_yet", gap: "What is the latency target?", at: 1000 } });
    expect(view.assistCount).toBe(1);
    expect("assists" in view).toBe(false);
    expect(view.steps).toEqual({});
  });

  it("keeps the checklist for the debrief", () => {
    const view = toPublicSession(guided({ status: "debriefed" }), undefined);
    expect(view.steps.requirements?.covered).toBe(1);
  });

  it("loads a guided session saved without the new fields", () => {
    const view = toPublicSession(guided(), undefined);
    expect(view.stepVerdicts).toBeUndefined();
    expect(view.assistCount).toBe(0);
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
