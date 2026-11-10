import { describe, expect, it } from "vitest";
import type { GapProgress, Scorecard } from "../../shared/types";
import { gapMarks } from "./gapMarks";
import { nextAction, type NextInput } from "./debriefNext";

const gap = (title: string): Scorecard["gaps"][number] => ({ title, severity: "high", whyItMatters: "why", whatGoodLooksLike: "good", teachMinutes: 10 });
const gaps = [gap("Hot keys"), gap("Retries"), gap("Backpressure")];
const rec = (state: GapProgress["state"]): GapProgress => ({ by: "coach", state, at: "2026-11-01T10:00:00.000Z" });
const settled = { "Hot keys": rec("taught"), Retries: rec("core_only"), Backpressure: rec("taught") };

function input(overrides: Partial<NextInput> & { progress?: Record<string, GapProgress> }): NextInput {
  const { progress = {}, ...rest } = overrides;
  return { gaps, marks: gapMarks(gaps, progress, []), notesSaved: false, mode: "guided", readiness: "ready", ...rest };
}

describe("nextAction", () => {
  it("sends the learner back to the coach while a gap is with the coach", () => {
    const next = nextAction(input({ progress: { "Hot keys": rec("started") } }));
    expect(next).toMatchObject({ kind: "answer_coach", label: "Answer the coach: Hot keys", button: "Go to chat" });
  });

  it("offers the first gap not started when none is with the coach", () => {
    const next = nextAction(input({ progress: { "Hot keys": rec("taught") } }));
    expect(next).toMatchObject({ kind: "start_gap", label: "Start: Retries", button: "Teach me this" });
  });

  it("asks for the study notes once no gap is left to start or finish", () => {
    expect(nextAction(input({ progress: settled })).kind).toBe("draft_notes");
    expect(nextAction(input({ gaps: [], marks: new Map() })).kind).toBe("draft_notes");
  });

  it("offers interview mode after notes are saved on a guided round that is ready", () => {
    expect(nextAction(input({ progress: settled, notesSaved: true, readiness: "ready" })).kind).toBe("try_interview");
  });

  it("offers a practice round on the top gap after notes are saved on a guided round that is not yet ready", () => {
    const next = nextAction(input({ progress: settled, notesSaved: true, readiness: "not_yet" }));
    expect(next).toMatchObject({ kind: "practise_gap", label: "Practise the top gap" });
    expect(next.kind === "practise_gap" && next.gap.title).toBe("Hot keys");
  });

  it("offers the most serious gap not practised yet, and home when every gap is practised", () => {
    const practised = (titles: string[]) => Object.fromEntries(titles.map((t) => [t, { sessionId: "20261111-1000-c2-url-shortener-abcd", at: "2026-11-11T10:00:00.000Z" }]));
    const one = nextAction(input({ marks: gapMarks(gaps, settled, [], practised(["Hot keys"])), notesSaved: true, readiness: "not_yet" }));
    expect(one.kind === "practise_gap" && one.gap.title).toBe("Retries");
    const all = nextAction(input({ marks: gapMarks(gaps, settled, [], practised(["Hot keys", "Retries", "Backpressure"])), notesSaved: true, readiness: "not_yet" }));
    expect(all.kind).toBe("home");
  });

  it("sends an interview round home after notes are saved, and still asks for notes first", () => {
    expect(nextAction(input({ progress: settled, mode: "interview", readiness: null })).kind).toBe("draft_notes");
    expect(nextAction(input({ progress: settled, notesSaved: true, mode: "interview", readiness: null })).kind).toBe("home");
  });

  it("sends a guided round saved before the readiness call home", () => {
    expect(nextAction(input({ progress: settled, notesSaved: true, readiness: null })).kind).toBe("home");
  });

  it("puts a gap ahead of the notes even when notes are saved", () => {
    expect(nextAction(input({ notesSaved: true })).kind).toBe("start_gap");
  });

  it("moves on to the notes when the only marks are legacy sent marks", () => {
    const marks = new Map<string, "sent">(gaps.map((g) => [g.title, "sent"]));
    expect(nextAction(input({ marks })).kind).toBe("draft_notes");
    expect(nextAction(input({ marks, notesSaved: true })).kind).toBe("try_interview");
  });

  it("sends a guided round that is not yet ready and has no gaps home once notes are saved", () => {
    expect(nextAction(input({ gaps: [], marks: new Map(), readiness: "not_yet" })).kind).toBe("draft_notes");
    expect(nextAction(input({ gaps: [], marks: new Map(), readiness: "not_yet", notesSaved: true })).kind).toBe("home");
  });
});
