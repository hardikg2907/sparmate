import { describe, expect, it } from "vitest";
import type { Session } from "../../shared/types";
import { MAX_GAP_CHARS, parseStepVerdict, recordStepVerdict } from "./step-verdict";

const PHASES = ["requirements", "capacity", "api"];
const parse = (args: unknown) => parseStepVerdict(args, PHASES);

describe("parseStepVerdict", () => {
  it("accepts a pass and drops any gap", () => {
    expect(parse({ phase: "api", verdict: "pass", gap: "ignored" })).toEqual({ ok: true, value: { phase: "api", verdict: "pass" } });
  });

  it("trims a not_yet gap and keeps it as plain text", () => {
    const out = parse({ phase: "capacity", verdict: "not_yet", gap: "  What is the\nread rate?\t " });
    expect(out).toEqual({ ok: true, value: { phase: "capacity", verdict: "not_yet", gap: "What is the read rate?" } });
  });

  it("keeps markup as text for the page to escape, never as HTML", () => {
    const out = parse({ phase: "capacity", verdict: "not_yet", gap: "<img src=x onerror=alert(1)>" });
    expect(out.ok && out.value.gap).toBe("<img src=x onerror=alert(1)>");
  });

  it("rejects unknown fields, an unknown step and a bad verdict", () => {
    expect(parse({ phase: "api", verdict: "pass", extra: 1 }).ok).toBe(false);
    expect(parse({ phase: "wrap_up", verdict: "pass" })).toMatchObject({ ok: false, error: expect.stringContaining("requirements, capacity, api") });
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
    expect(recordStepVerdict(s, { phase: "capacity", verdict: "not_yet", gap: "Which number?" }, 2)).toEqual({ ok: true });
  });
});
