import { describe, expect, it } from "vitest";
import type { Session } from "../../shared/types";
import { HLD_PHASES, LLD_PHASES } from "../../shared/phases";
import type { StepCheck } from "../../shared/types";
import { MAX_GAP_CHARS, parseStepVerdict, passCheck, passNeed, passRefusalText, recordStepVerdict, stepStatusLine } from "./step-verdict";

const PHASES = ["requirements", "entities", "api"];
const parse = (args: unknown) => parseStepVerdict(args, PHASES);

describe("parseStepVerdict", () => {
  it("accepts a pass and drops any gap", () => {
    expect(parse({ phase: "api", verdict: "pass", gap: "ignored" })).toEqual({ ok: true, value: { phase: "api", verdict: "pass" } });
  });

  it("trims a not_yet gap and keeps it as plain text", () => {
    const out = parse({ phase: "entities", verdict: "not_yet", gap: "  What is the\nread rate?\t " });
    expect(out).toEqual({ ok: true, value: { phase: "entities", verdict: "not_yet", gap: "What is the read rate?" } });
  });

  it("keeps markup as text for the page to escape, never as HTML", () => {
    const out = parse({ phase: "entities", verdict: "not_yet", gap: "<img src=x onerror=alert(1)>" });
    expect(out.ok && out.value.gap).toBe("<img src=x onerror=alert(1)>");
  });

  it("rejects unknown fields, an unknown step and a bad verdict", () => {
    expect(parse({ phase: "api", verdict: "pass", extra: 1 }).ok).toBe(false);
    expect(parse({ phase: "deep_dives", verdict: "pass" })).toMatchObject({ ok: false, error: expect.stringContaining("requirements, entities, api") });
    expect(parse({ phase: "api", verdict: "nearly" }).ok).toBe(false);
    expect(parse({ verdict: "pass" }).ok).toBe(false);
  });

  it("needs a gap of 1 to 200 characters for not_yet", () => {
    expect(parse({ phase: "api", verdict: "not_yet" }).ok).toBe(false);
    expect(parse({ phase: "api", verdict: "not_yet", gap: "   " }).ok).toBe(false);
    expect(parse({ phase: "api", verdict: "not_yet", gap: "x".repeat(MAX_GAP_CHARS) }).ok).toBe(true);
    expect(parse({ phase: "api", verdict: "not_yet", gap: "x".repeat(MAX_GAP_CHARS + 1) }).ok).toBe(false);
  });
});

describe("recordStepVerdict", () => {
  const held = (): Pick<Session, "stepVerdicts"> => ({});

  it("stores the call with the round time", () => {
    const s = held();
    expect(recordStepVerdict(s, { phase: "api", verdict: "not_yet", gap: "Which entities?" }, 4_000)).toEqual({ ok: true });
    expect(s.stepVerdicts).toEqual({ api: { verdict: "not_yet", gap: "Which entities?", at: 4_000 } });
  });

  it("lets a pass replace a not_yet and drops the old gap", () => {
    const s = held();
    recordStepVerdict(s, { phase: "api", verdict: "not_yet", gap: "Which entities?" }, 1);
    recordStepVerdict(s, { phase: "api", verdict: "pass" }, 2);
    expect(s.stepVerdicts?.api).toEqual({ verdict: "pass", at: 2 });
  });

  it("keeps a pass: a later not_yet is refused with a message the guide can act on", () => {
    const s = held();
    recordStepVerdict(s, { phase: "api", verdict: "pass" }, 1);
    const out = recordStepVerdict(s, { phase: "api", verdict: "not_yet", gap: "One more thing" }, 2);
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining("already passed") });
    expect(out.ok === false && out.error).toContain("Do not raise it again");
    expect(s.stepVerdicts?.api).toEqual({ verdict: "pass", at: 1 });
  });

  it("keeps each step's call apart", () => {
    const s = held();
    recordStepVerdict(s, { phase: "api", verdict: "pass" }, 1);
    expect(recordStepVerdict(s, { phase: "entities", verdict: "not_yet", gap: "Which number?" }, 2)).toEqual({ ok: true });
  });
});

describe("passCheck", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => ({ id, label: `Item ${id}` }));
  const reading = (states: Record<string, "covered" | "partial">): StepCheck => ({
    status: "done",
    checkedAt: 1_000,
    usedImage: false,
    items: Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state, source: "chat" as const, at: 1, quote: "q", detail: "" }])),
  });

  it("needs half the items covered, rounded up, and at least one", () => {
    expect([1, 2, 3, 4, 5, 7, 10].map((n) => passNeed({}, n))).toEqual([1, 1, 2, 2, 3, 4, 5]);
    expect(passNeed({}, 0)).toBe(0);
    expect(passNeed({ passNeeds: "one" }, 5)).toBe(1);
    expect(passNeed({ passNeeds: "all" }, 2)).toBe(2);
    expect(
      passNeed(
        LLD_PHASES.find((p) => p.id === "extend")!,
        2,
      ),
    ).toBe(2);
  });

  it("refuses a pass when too few items are covered, and does not count a partial item", () => {
    const out = passCheck({}, items, reading({ a: "covered", b: "partial", c: "partial", d: "partial" }));
    expect(out).toEqual({ ok: false, covered: 1, total: 5, need: 3, open: ["Item b", "Item c", "Item d", "Item e"] });
    expect(passCheck({}, items, reading({ a: "covered", b: "covered", c: "covered" }))).toEqual({ ok: true });
  });

  it("refuses a pass when the reading covers nothing", () => {
    expect(passCheck({}, items, reading({}))).toMatchObject({ ok: false, covered: 0 });
    expect(passCheck({ passNeeds: "one" }, items, reading({}))).toMatchObject({ ok: false, need: 1 });
  });

  it("leaves the call to the guide when the step has no checklist or no finished reading", () => {
    expect(passCheck({}, [], reading({}))).toEqual({ ok: true });
    expect(passCheck({}, items, undefined)).toEqual({ ok: true });
    expect(passCheck({}, items, { status: "failed", checkedAt: null, usedImage: false, items: {} })).toEqual({ ok: true });
  });

  it("tells the guide to name one open item and never to mention the reading", () => {
    const out = passCheck({}, items, reading({ a: "covered" }));
    if (out.ok) throw new Error("expected a refusal");
    const text = passRefusalText("API", out);
    expect(text).toContain("API cannot pass yet");
    expect(text).toContain("Items not covered yet: Item b; Item c; Item d; Item e.");
    expect(text).toContain("name the most important one");
    expect(text).toContain("do not mention this reading to him");
  });
});

describe("stepStatusLine", () => {
  it("lists the passed and the open steps in rail order", () => {
    expect(stepStatusLine(HLD_PHASES, undefined)).toBe("passed: none yet · not passed yet: Requirements, Core entities, API, High-level design, Deep dives");
    const verdicts = { api: { verdict: "pass" as const, at: 2 }, requirements: { verdict: "not_yet" as const, gap: "x", at: 1 }, entities: { verdict: "pass" as const, at: 3 } };
    expect(stepStatusLine(HLD_PHASES, verdicts)).toBe("passed: Core entities, API · not passed yet: Requirements, High-level design, Deep dives");
    const all = Object.fromEntries(HLD_PHASES.map((p) => [p.id, { verdict: "pass" as const, at: 1 }]));
    expect(stepStatusLine(HLD_PHASES, all)).toBe("every step has passed");
  });
});
