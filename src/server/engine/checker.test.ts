import { describe, expect, it } from "vitest";
import { stepCodeText } from "../../shared/stepCode";
import type { Session, TranscriptEntry } from "../../shared/types";
import { checkerMessage, evidenceKey, mergeCheck, stepChecklistText, stepReadingText, type CheckerEvidence, type CheckerOutput } from "./checker";
import { publicPins, publicSteps } from "./public";

const entry = (id: string, at: number, role: TranscriptEntry["role"], text: string): TranscriptEntry => ({
  id,
  at,
  wall: "2026-10-31T10:00:00.000Z",
  channel: "interview",
  role,
  text,
});

const evidence = (over: Partial<CheckerEvidence> = {}): CheckerEvidence => ({
  notesText: "",
  stepLabel: "Requirements",
  goal: "3-4 functional and 3-4 non-functional requirements",
  items: [
    { id: "requirements-1", label: "Create a short link" },
    { id: "requirements-2", label: "Redirect adds under 50 ms at p99" },
    { id: "requirements-3", label: "99.99% availability for redirects" },
  ],
  chat: [entry("a", 10_000, "interviewer", "What do you need from it?"), entry("b", 252_000, "candidate", "Users create short links. A redirect should add under 50 ms at p99.")],
  boardText: 'Text on the board:\n- "99.99% available" in frame "Requirements"',
  codeText: "",
  imageAttached: false,
  ...over,
});

const claim = (id: string, state: "covered" | "partial" | "missing", source: "chat" | "board" | "code" | "notes" | "none", quote: string, detail = "") => ({
  id,
  state,
  source,
  quote,
  detail,
});

describe("mergeCheck", () => {
  it("keeps a chat claim only when the quote is in his own line, and takes the time from that line", () => {
    const out: CheckerOutput = {
      items: [
        claim("requirements-1", "covered", "chat", "Users create short links"),
        claim("requirements-2", "covered", "chat", "What do you need from it"),
        claim("requirements-3", "covered", "board", "99.99% available"),
      ],
    };
    const check = mergeCheck(undefined, out, evidence(), 300_000);
    expect(check.items["requirements-1"]).toEqual({ state: "covered", source: "chat", at: 252_000, quote: "Users create short links", detail: "" });
    // The interviewer's words never cover an item.
    expect(check.items["requirements-2"]).toBeUndefined();
    expect(check.items["requirements-3"]).toMatchObject({ state: "covered", source: "board", at: null });
    expect(check).toMatchObject({ status: "done", checkedAt: 300_000, usedImage: false });
  });

  it("refuses invented quotes, unknown ids and a quoteless board claim made without the image", () => {
    const out: CheckerOutput = {
      items: [
        claim("requirements-1", "covered", "chat", "I covered this in detail earlier"),
        claim("requirements-9", "covered", "chat", "Users create short links"),
        claim("requirements-3", "covered", "board", ""),
      ],
    };
    expect(mergeCheck(undefined, out, evidence(), 1).items).toEqual({});
    const seen = mergeCheck(undefined, out, evidence({ imageAttached: true }), 1);
    expect(Object.keys(seen.items)).toEqual(["requirements-3"]);
    expect(seen.usedImage).toBe(true);
  });

  it("only raises coverage: a covered item stays covered and keeps where it was first said", () => {
    const first = mergeCheck(undefined, { items: [claim("requirements-1", "covered", "chat", "Users create short links")] }, evidence(), 1);
    const later = mergeCheck(
      first,
      { items: [claim("requirements-1", "missing", "none", ""), claim("requirements-2", "partial", "chat", "under 50 ms", "no percentile reason")] },
      evidence(),
      2,
    );
    expect(later.items["requirements-1"]?.at).toBe(252_000);
    expect(later.items["requirements-2"]).toMatchObject({ state: "partial", detail: "no percentile reason" });
    const upgraded = mergeCheck(later, { items: [claim("requirements-2", "covered", "chat", "A redirect should add under 50 ms at p99")] }, evidence(), 3);
    expect(upgraded.items["requirements-2"]).toMatchObject({ state: "covered", detail: "" });
  });

  it("re-reads from scratch when given no previous check, so a wrong tick it no longer finds goes away", () => {
    const wrong = mergeCheck(undefined, { items: [claim("requirements-1", "covered", "chat", "Users create short links")] }, evidence(), 1);
    const fresh = mergeCheck(undefined, { items: [claim("requirements-1", "missing", "none", "")] }, evidence(), 2);
    expect(wrong.items["requirements-1"]?.state).toBe("covered");
    expect(fresh).toEqual({ status: "done", checkedAt: 2, usedImage: false, items: {} });
  });

  it("shows the step's code with its file line numbers and matches code quotes against his text only", () => {
    const file = "// one entry gate\nclass Spot {\n  int floor;\n};\n";
    const ev = evidence({ codeText: stepCodeText(file, ["class Spot {", "int floor;"]) });
    expect(checkerMessage(ev)).toContain("<code>\n2 | class Spot {\n3 |   int floor;\n</code>");
    const out: CheckerOutput = {
      items: [
        claim("requirements-1", "covered", "code", "class Spot {"),
        claim("requirements-2", "covered", "code", "one entry gate"),
        claim("requirements-3", "covered", "code", "2 | class Spot {"),
      ],
    };
    const check = mergeCheck(undefined, out, ev, 1);
    expect(check.items["requirements-1"]?.source).toBe("code");
    // A line written in another step, and a quote that copies a line number, are not his code for this step.
    expect(check.items["requirements-2"]).toBeUndefined();
    expect(check.items["requirements-3"]).toBeUndefined();
  });

  it("reads his written answer as evidence, and refuses a written-answer quote he never wrote", () => {
    const e = evidence({ notesText: "Requirements:\n- 99.99% availability for redirects, creating can be lower" });
    expect(checkerMessage(e)).toContain("<written_answer>\nRequirements:\n- 99.99% availability for redirects");
    expect(checkerMessage(evidence())).not.toContain("<written_answer>");
    const out = mergeCheck(
      undefined,
      { items: [claim("requirements-3", "covered", "notes", "99.99% availability for redirects"), claim("requirements-1", "covered", "notes", "Create a short link")] },
      e,
      300_000,
    );
    expect(out.items["requirements-3"]).toMatchObject({ state: "covered", source: "notes", at: null });
    expect(out.items["requirements-1"]).toBeUndefined();
    expect(stepReadingText(e.items, out)).toContain("- requirements-3: 99.99% availability for redirects — covered, in the written answer");
    expect(evidenceKey(e)).not.toBe(evidenceKey(evidence()));
  });

  it("gives the guide each item with its state, where it was found and what a partial lacks", () => {
    const check = mergeCheck(
      undefined,
      {
        items: [claim("requirements-1", "covered", "chat", "Users create short links"), claim("requirements-2", "partial", "board", "99.99% available", "no target for redirects")],
      },
      evidence(),
      1,
    );
    expect(stepReadingText(evidence().items, check)).toBe(
      [
        "- requirements-1: Create a short link — covered, said at 4:12",
        "- requirements-2: Redirect adds under 50 ms at p99 — partial, on the board; lacks no target for redirects",
        "- requirements-3: 99.99% availability for redirects — missing",
      ].join("\n"),
    );
  });

  it("writes the checklist for the scribe with what was covered and where", () => {
    const check = mergeCheck(undefined, { items: [claim("requirements-1", "covered", "chat", "Users create short links")] }, evidence(), 1);
    const text = stepChecklistText([{ id: "requirements", label: "Requirements" }], { requirements: evidence().items }, { requirements: check });
    expect(text).toBe(
      '[Requirements]\n- covered: Create a short link (said "Users create short links")\n- missing: Redirect adds under 50 ms at p99\n- missing: 99.99% availability for redirects',
    );
  });

  it("ignores pure option-chip candidate entries in evidenceKey and chat quote verification, and marks them as events in checkerMessage", () => {
    const base = evidence({
      chat: [entry("a", 10_000, "interviewer", "Pick one option.")],
    });
    const optText = "Users create short links and redirects add under 50 ms at p99.";
    const withOptionClick = evidence({
      chat: [entry("a", 10_000, "interviewer", "Pick one option."), { ...entry("opt", 20_000, "candidate", optText), optionText: optText }],
    });

    expect(evidenceKey(withOptionClick)).toBe(evidenceKey(base));
    expect(checkerMessage(withOptionClick)).toContain("[00:20] (event) candidate picked option: Users create short links");
    expect(checkerMessage(withOptionClick)).not.toContain("[00:20] candidate:");

    const check = mergeCheck(
      undefined,
      {
        items: [claim("requirements-1", "covered", "chat", "Users create short links"), claim("requirements-2", "covered", "chat", "under 50 ms at p99")],
      },
      withOptionClick,
      30_000,
    );
    expect(check.items).toEqual({});
  });

  it("rejects quotes from optionText while accepting quotes from the candidate's own added words on an extended prefill", () => {
    const base = evidence({
      chat: [entry("a", 10_000, "interviewer", "Start from one of these drafts.")],
    });
    const withExtendedPrefill = evidence({
      chat: [
        entry("a", 10_000, "interviewer", "Start from one of these drafts."),
        {
          ...entry("ext", 20_000, "candidate", "Users create short links. A redirect should add under 50 ms at p99."),
          optionText: "Users create short links.",
        },
      ],
    });

    expect(evidenceKey(withExtendedPrefill)).not.toBe(evidenceKey(base));
    const msg = checkerMessage(withExtendedPrefill);
    expect(msg).toContain("[00:20] (event) candidate picked option: Users create short links.");
    expect(msg).toContain("[00:20] candidate: A redirect should add under 50 ms at p99.");

    const check = mergeCheck(
      undefined,
      {
        items: [claim("requirements-1", "covered", "chat", "Users create short links"), claim("requirements-2", "covered", "chat", "A redirect should add under 50 ms at p99")],
      },
      withExtendedPrefill,
      30_000,
    );
    expect(check.items["requirements-1"]).toBeUndefined();
    expect(check.items["requirements-2"]).toEqual({
      state: "covered",
      source: "chat",
      at: 20_000,
      quote: "A redirect should add under 50 ms at p99",
      detail: "",
    });
  });
});

describe("checklist for a step that was not read", () => {
  const phases = [{ id: "requirements", label: "Requirements" }];
  const items = evidence().items;
  const text = (status: "checking" | "done" | "failed", checkedAt: number | null) =>
    stepChecklistText(phases, { requirements: items }, { requirements: { status, checkedAt, usedImage: false, items: {} } });

  it("says a failed, running or unfinished check was not checked and lists nothing as missing", () => {
    for (const out of [text("failed", null), text("checking", null), text("failed", 5), text("done", null)]) {
      expect(out).toBe("[Requirements]\n- not checked");
      expect(out).not.toContain("missing");
    }
  });

  it("still lists missing items after a finished check", () => {
    expect(text("done", 5)).toContain("- missing: Create a short link");
  });
});

describe("what the browser sees of the checklist and the pins", () => {
  const base = (mode: Session["mode"], status: Session["status"]): Pick<Session, "mode" | "status" | "checklist" | "stepChecks" | "pins"> => ({
    mode,
    status,
    checklist: { requirements: [...evidence().items] },
    stepChecks: {
      requirements: {
        status: "done",
        checkedAt: 1,
        usedImage: false,
        items: {
          "requirements-1": { state: "covered", source: "chat", at: 252_000, quote: "Users create short links", detail: "" },
          "requirements-2": { state: "partial", source: "chat", at: 252_000, quote: "under 50 ms", detail: "no percentile reason" },
        },
      },
    },
    pins: [
      { id: "p1", elementId: "lb", phase: "design", note: "Say how it fails over.", tone: "note", by: "guide", at: 1 },
      { id: "p2", elementId: "db", phase: "design", note: "No replicas.", tone: "gap", by: "judge", at: 2 },
    ],
  });

  it("shows an interview round nothing of the checklist until the round ends", () => {
    for (const status of ["live", "paused", "ended"] as const) expect(publicSteps(base("interview", status))).toEqual({});
  });

  it("sends a live guided round no checklist, and every debrief the counts and labels", () => {
    expect(publicSteps(base("guided", "live"))).toEqual({});
    for (const s of [base("guided", "debriefed"), base("interview", "debriefed")]) {
      const step = publicSteps(s).requirements;
      expect(step).toMatchObject({ covered: 1, partial: 1, total: 3 });
      expect(step?.items.map((i) => i.state)).toEqual(["covered", "partial", "missing"]);
      expect(step?.items[1]?.detail).toBe("no percentile reason");
    }
  });

  it("shows pins only in a guided round, and all of them once the round is over", () => {
    expect(publicPins(base("interview", "live"))).toEqual([]);
    expect(publicPins(base("guided", "live")).map((p) => p.id)).toEqual(["p1"]);
    expect(publicPins(base("interview", "debriefed")).map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});
