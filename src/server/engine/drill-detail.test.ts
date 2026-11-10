import { describe, expect, it } from "vitest";
import { attemptView } from "./drill-detail";
import { emptyState, type AttemptBody } from "./drill-store";

const grade = (strong: string) => ({ at: "2026-03-01T10:00:00.000Z", outcome: "needs_work" as const, scores: [], wentWell: [], improve: ["x"], yourLine: "y", strong });
const body = (strong: string): AttemptBody => ({
  version: 1,
  id: "0123456789abcdef",
  drill: "walk",
  problemId: "p",
  problemTitle: "P",
  task: "T",
  topic: null,
  answers: [{ at: "2026-03-01T10:00:00.000Z", text: "a" }],
  turns: [],
  grades: [grade(strong)],
});

describe("attemptView strong line", () => {
  it("shows a saved strong line once no open drill of the kind could ask it again", () => {
    expect(attemptView(body("Walk it in order."), emptyState(), "2026-03-02").grades[0]).toMatchObject({ strong: "Walk it in order." });
  });

  it("says no line was saved when the grader's line was dropped", () => {
    const view = attemptView(body(""), emptyState(), "2026-03-02").grades[0];
    expect(view?.noStrong).toBe(true);
    expect(view).not.toHaveProperty("strong");
  });

  it("says nothing while the attempt can still be revised", () => {
    const state = { ...emptyState(), attempts: [{ id: "0123456789abcdef", day: "2026-03-02", revised: false, outcome: "needs_work" }] } as unknown as ReturnType<typeof emptyState>;
    const view = attemptView(body(""), state, "2026-03-02").grades[0];
    expect(view).not.toHaveProperty("noStrong");
  });

  it("says nothing while the line is still held back", () => {
    const state = { ...emptyState(), items: [{ status: "open", drill: "walk" }] } as unknown as ReturnType<typeof emptyState>;
    const view = attemptView(body(""), state, "2026-03-02").grades[0];
    expect(view).not.toHaveProperty("noStrong");
    expect(view).not.toHaveProperty("strong");
  });
});
