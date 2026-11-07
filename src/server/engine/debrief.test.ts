import { describe, expect, it } from "vitest";
import { phasePlan } from "../../shared/phases";
import type { Problem } from "../../shared/problem";
import type { Session } from "../../shared/types";
import { checkStepQuotes } from "../../shared/quotes";
import { enforceRules, failedQuoteNote, failedRatio, judgeMessage, lintCard, phaseTiming, stepSources, type JudgedCard } from "./debrief";

const MIN = 60_000;

function card(over: Partial<JudgedCard> = {}): JudgedCard {
  return {
    verdict: { sde2: "hire", senior: "lean_no_hire", confidence: "medium", summary: "Clear round — good pace — fine." },
    dimensions: [
      {
        id: "design",
        name: "Design",
        score: 3,
        evidence: [
          { quote: "a cache", source: "candidate", at: "01:00", polarity: "plus" },
          { quote: "made up", source: "candidate", at: "", polarity: "minus" },
        ],
        whatA4LooksLike: "x",
      },
    ],
    steps: [
      {
        phase: "design",
        took: [
          {
            point: "Used a cache in front of storage.",
            dimensionId: "design",
            evidence: { quote: "a cache", source: "candidate", at: "01:00", polarity: "plus" },
          },
        ],
        missing: ["Cache invalidation policy was not addressed."],
      },
    ],
    strengths: ["Good."],
    gaps: [{ title: "g", severity: "high", whyItMatters: "w", whatGoodLooksLike: "x → y", teachMinutes: 5 }],
    timeline: [],
    practiceTask: "p",
    trackerMark: "[x]",
    trackerMarkReason: "Strong.",
    lldScenarios: [{ name: "invented", pass: true, detail: "" }],
    ...over,
  };
}

describe("phaseTiming", () => {
  it("adds up time per phase, counting revisits", () => {
    const plan = phasePlan("hld", 45);
    const timing = phaseTiming(
      {
        phaseHistory: [
          { phase: "requirements", at: 0, by: "candidate" },
          { phase: "capacity", at: 6 * MIN, by: "candidate" },
          { phase: "requirements", at: 9 * MIN, by: "candidate" },
          { phase: "api", at: 10 * MIN, by: "interviewer" },
        ],
      },
      plan,
      15 * MIN,
    );
    expect(timing.find((t) => t.phase === "requirements")?.actualMinutes).toBe(7);
    expect(timing.find((t) => t.phase === "capacity")?.actualMinutes).toBe(3);
    expect(timing.find((t) => t.phase === "api")?.actualMinutes).toBe(5);
    expect(timing.find((t) => t.phase === "design")).toMatchObject({ plannedMinutes: 10, actualMinutes: 0 });
  });

  it("assumes the first phase from zero when the history starts later", () => {
    const timing = phaseTiming({ phaseHistory: [{ phase: "api", at: 2 * MIN, by: "candidate" }] }, phasePlan("hld", 45), 3 * MIN);
    expect(timing[0]?.actualMinutes).toBe(2);
    expect(timing[2]?.actualMinutes).toBe(1);
  });
});

describe("rules and checks", () => {
  it("caps guided rounds at [~] and replaces LLD scenarios with the tester's", () => {
    const tester = { compiled: true, scenarios: [{ name: "real", pass: false, detail: "d" }], notes: "" };
    const out = enforceRules(card(), { mode: "guided", track: "lld", tester });
    expect(out.trackerMark).toBe("[~]");
    expect(out.lldScenarios).toEqual([{ name: "real", pass: false, detail: "d" }]);
  });

  it("caps an LLD round whose code did not compile, and clears HLD scenarios", () => {
    expect(enforceRules(card(), { mode: "interview", track: "lld", tester: { compiled: false, scenarios: [], notes: "" } }).trackerMark).toBe("[~]");
    const hld = enforceRules(card({ gaps: [] }), { mode: "interview", track: "hld", tester: null });
    expect(hld.trackerMark).toBe("[x]");
    expect(hld.lldScenarios).toEqual([]);
  });

  it("computes the failed share and lists the failed quotes for the retry", () => {
    const checks = [
      { dimensionId: "design", index: 0, verified: true },
      { dimensionId: "design", index: 1, verified: false },
    ];
    expect(failedRatio(checks)).toBe(0.5);
    expect(failedRatio([])).toBe(0);
    expect(failedQuoteNote(card(), checks)).toContain('- "made up" (dimension design)');
  });

  it("checks step quotes: real quotes verify, invented quotes fail and count in the ratio", () => {
    const sources = {
      candidate: "I will cache the hot keys.",
      board: "",
      code: "",
    };
    const testCard = card({
      steps: [
        {
          phase: "design",
          took: [
            {
              point: "Added cache.",
              dimensionId: "design",
              evidence: { quote: "cache the hot keys", source: "candidate", at: "01:00", polarity: "plus" },
            },
            {
              point: "Invented point.",
              dimensionId: "design",
              evidence: { quote: "completely invented text", source: "candidate", at: "02:00", polarity: "minus" },
            },
          ],
          missing: [],
        },
      ],
    });
    const stepChecks = checkStepQuotes(testCard, sources);
    expect(stepChecks).toEqual([
      { phase: "design", index: 0, verified: true },
      { phase: "design", index: 1, verified: false },
    ]);
    const dimChecks = [{ dimensionId: "design", index: 0, verified: true }];
    expect(failedRatio(dimChecks, stepChecks)).toBe(1 / 3);
    const note = failedQuoteNote(testCard, dimChecks, stepChecks);
    expect(note).toContain('- "completely invented text" (step design)');
  });

  it("drops step entries whose phase is not in the track and sorts steps into phase order", () => {
    const input = card({
      steps: [
        { phase: "unknown_phase", took: [], missing: [] },
        { phase: "api", took: [], missing: [] },
        { phase: "requirements", took: [], missing: [] },
      ],
    });
    const out = enforceRules(input, { mode: "interview", track: "hld", tester: null });
    expect(out.steps?.map((s) => s.phase)).toEqual(["requirements", "api"]);
  });

  it("keeps only the first entry when the judge repeats a step", () => {
    const input = card({
      steps: [
        { phase: "api", took: [], missing: ["first"] },
        { phase: "api", took: [], missing: ["second"] },
      ],
    });
    expect(enforceRules(input, { mode: "interview", track: "hld", tester: null }).steps).toEqual([{ phase: "api", took: [], missing: ["first"] }]);
  });

  it("lints the prose fields with their names including steps", () => {
    const issues = lintCard(card(), (t) => (t.includes("—") || t.includes("→") ? ["symbol"] : []));
    expect(issues.map((i) => i.field)).toEqual(["verdict.summary", "gaps[0].whatGoodLooksLike"]);

    const withStepIssues = card({
      steps: [
        {
          phase: "design",
          took: [
            {
              point: "Point with — symbol.",
              dimensionId: "design",
              evidence: { quote: "q", source: "candidate", at: "", polarity: "plus" },
            },
          ],
          missing: ["Missing with → symbol."],
        },
      ],
    });
    const stepIssues = lintCard(withStepIssues, (t) => (t.includes("—") || t.includes("→") ? ["symbol"] : []));
    expect(stepIssues).toContainEqual({ field: "steps[0].took[0].point", issue: "symbol" });
    expect(stepIssues).toContainEqual({ field: "steps[0].missing[0]", issue: "symbol" });
  });
});

describe("judgeMessage", () => {
  it("includes the transcript, timing, hints, extension, board and LLD parts", () => {
    const session = {
      track: "lld",
      mode: "interview",
      durationMs: 90 * MIN,
      transcript: [{ id: "1", at: 61_000, wall: "", channel: "interview", role: "candidate", text: "Spot is a class." }],
      hints: [{ at: 120_000, level: 2, topic: "locking" }],
      stepNotes: { clarify: "Out of scope: payments." },
      extension: { at: 75 * MIN, text: "Add EV charging." },
    } as unknown as Session;
    const problem = { meta: { title: "Parking Lot" } } as unknown as Problem;
    const text = judgeMessage(
      {
        session,
        problem,
        timing: [{ phase: "clarify", label: "Clarify", plannedMinutes: 5, actualMinutes: 7 }],
        finalGraphText: "Nodes:",
        finalCode: "int main() {}\n",
        tester: null,
        hasImage: false,
      },
      "fix quotes",
    );
    expect(text).toContain("[01:01] candidate: Spot is a class.");
    expect(text).toContain("<notes>\n[Clarify]\nOut of scope: payments.\n</notes>");
    expect(text).toContain("- Clarify: planned 5 min, actual 7 min");
    expect(text).toContain("- [02:00] H2: locking");
    expect(text).toContain("[75:00] Add EV charging.");
    expect(text).toContain("1 | int main() {}");
    expect(text).toContain("The scenario tester could not run.");
    expect(text).toContain("<note>\nfix quotes\n</note>");
  });

  it("includes the step windows for visited steps including multiple visits", () => {
    const session = {
      track: "hld",
      mode: "interview",
      durationMs: 45 * MIN,
      phaseHistory: [
        { phase: "requirements", at: 0 },
        { phase: "capacity", at: 5 * MIN },
        { phase: "requirements", at: 10 * MIN },
      ],
      transcript: [],
      hints: [],
      stepNotes: {},
      extension: null,
      endedAt: null,
    } as unknown as Session;
    const problem = { meta: { title: "URL Shortener" } } as unknown as Problem;
    const text = judgeMessage({
      session,
      problem,
      timing: [],
      finalGraphText: "",
      finalCode: null,
      tester: null,
      hasImage: false,
    });
    expect(text).toContain("<step_windows>\n- requirements: 00:00–05:00, 10:00–45:00\n- capacity: 05:00–10:00\n</step_windows>");
  });
});

const HLD_IDS = ["navigation", "design", "depth", "scale_reliability", "communication", "drive_time"];
const LLD_IDS = ["requirements", "working_code", "design", "extensibility", "edge_cases", "concurrency", "code_quality", "communication_time"];

function scored(ids: string[], scores: Record<string, number>, fallback = 3): JudgedCard["dimensions"] {
  return ids.map((id) => ({ id, name: id, score: scores[id] ?? fallback, evidence: [], whatA4LooksLike: "x" }));
}

const goodTester = { compiled: true, scenarios: [{ name: "a", pass: true, detail: "" }], notes: "" };

describe("tracker mark rules", () => {
  const run = (over: Partial<JudgedCard>, ctx: Partial<Parameters<typeof enforceRules>[1]> = {}) =>
    enforceRules(card({ gaps: [], dimensions: scored(HLD_IDS, {}), trackerMark: "[x]", ...over }), { mode: "interview", track: "hld", tester: null, ...ctx });

  it("keeps [x] when every rule holds", () => {
    expect(run({}).trackerMark).toBe("[x]");
  });

  it("drops [x] when any dimension is below 3", () => {
    const out = run({ dimensions: scored(HLD_IDS, { depth: 2 }) });
    expect(out.trackerMark).toBe("[~]");
    expect(out.trackerMarkReason).toContain("below 3");
  });

  it("drops [x] when a high or medium gap stands, and keeps it for a low gap", () => {
    const gap = (severity: "high" | "medium" | "low") => [{ title: "g", severity, whyItMatters: "w", whatGoodLooksLike: "x", teachMinutes: 5 }];
    expect(run({ gaps: gap("high") }).trackerMark).toBe("[~]");
    expect(run({ gaps: gap("medium") }).trackerMark).toBe("[~]");
    expect(run({ gaps: gap("low") }).trackerMark).toBe("[x]");
  });

  it("drops an LLD [x] when the tester did not run, or a scenario failed, or none ran", () => {
    const lld = (tester: Parameters<typeof enforceRules>[1]["tester"]) =>
      enforceRules(card({ gaps: [], dimensions: scored(LLD_IDS, {}), trackerMark: "[x]" }), { mode: "interview", track: "lld", tester }).trackerMark;
    expect(lld(goodTester)).toBe("[x]");
    expect(lld(null)).toBe("[~]");
    expect(lld({ ...goodTester, scenarios: [{ name: "a", pass: false, detail: "" }] })).toBe("[~]");
    expect(lld({ ...goodTester, scenarios: [] })).toBe("[~]");
  });

  it("never raises a [~] to [x]", () => {
    expect(run({ trackerMark: "[~]" }).trackerMark).toBe("[~]");
  });
});

describe("verdict and confidence rules", () => {
  const verdictOf = (ids: string[], scores: Record<string, number>, track: "hld" | "lld" = "hld") =>
    enforceRules(card({ dimensions: scored(ids, scores), verdict: { sde2: "strong_hire", senior: "strong_hire", confidence: "low", summary: "s" } }), {
      mode: "interview",
      track,
      tester: track === "lld" ? goodTester : null,
    }).verdict;

  it("sets the HLD verdicts from the scores", () => {
    expect(verdictOf(HLD_IDS, { depth: 4, design: 4 })).toMatchObject({ sde2: "strong_hire", senior: "lean_no_hire" });
    expect(verdictOf(HLD_IDS, { depth: 4, design: 4, navigation: 4, scale_reliability: 4, communication: 4, drive_time: 4 })).toMatchObject({
      sde2: "strong_hire",
      senior: "strong_hire",
    });
    expect(verdictOf(HLD_IDS, { depth: 4, scale_reliability: 4, design: 4 })).toMatchObject({ sde2: "strong_hire", senior: "hire" });
    expect(verdictOf(HLD_IDS, { navigation: 1 })).toMatchObject({ sde2: "no_hire", senior: "no_hire" });
    expect(verdictOf(HLD_IDS, { depth: 2, communication: 2, drive_time: 2, scale_reliability: 2 })).toMatchObject({ sde2: "no_hire" });
    expect(verdictOf(HLD_IDS, { depth: 2, communication: 2, drive_time: 2 })).toMatchObject({ sde2: "lean_no_hire" });
    expect(verdictOf(HLD_IDS, { depth: 2, communication: 2 })).toMatchObject({ sde2: "hire", senior: "no_hire" });
    expect(verdictOf(HLD_IDS, { depth: 1 })).toMatchObject({ sde2: "lean_no_hire" });
  });

  it("sets the LLD verdicts from the scores, with concurrency left out", () => {
    const ids = LLD_IDS.filter((id) => id !== "concurrency");
    expect(verdictOf(ids, { design: 4, extensibility: 4 }, "lld")).toMatchObject({ sde2: "strong_hire", senior: "lean_no_hire" });
    expect(verdictOf(ids, { working_code: 2 }, "lld")).toMatchObject({ sde2: "lean_no_hire", senior: "no_hire" });
    expect(verdictOf(ids, { working_code: 1 }, "lld")).toMatchObject({ sde2: "no_hire" });
    expect(verdictOf(ids, { edge_cases: 1, code_quality: 1 }, "lld")).toMatchObject({ sde2: "no_hire" });
    expect(verdictOf(ids, { edge_cases: 2, code_quality: 2 }, "lld")).toMatchObject({ sde2: "hire" });
    expect(verdictOf(ids, { edge_cases: 1 }, "lld")).toMatchObject({ sde2: "lean_no_hire" });
  });

  it("leaves the verdict alone when a required dimension is missing", () => {
    const out = enforceRules(card({ verdict: { sde2: "hire", senior: "hire", confidence: "high", summary: "s" } }), { mode: "interview", track: "hld", tester: null });
    expect(out.verdict).toMatchObject({ sde2: "hire", senior: "hire" });
  });

  it("keeps the summary and caps a guided round at medium confidence", () => {
    const base = { dimensions: scored(HLD_IDS, {}), verdict: { sde2: "hire" as const, senior: "hire" as const, confidence: "high" as const, summary: "kept" } };
    const guided = enforceRules(card(base), { mode: "guided", track: "hld", tester: null }).verdict;
    expect(guided.confidence).toBe("medium");
    expect(guided.summary).toBe("kept");
    expect(enforceRules(card({ ...base, verdict: { ...base.verdict, confidence: "low" } }), { mode: "guided", track: "hld", tester: null }).verdict.confidence).toBe("low");
    expect(enforceRules(card(base), { mode: "interview", track: "hld", tester: null }).verdict.confidence).toBe("high");
  });
});

describe("stepSources", () => {
  const entry = (id: string, at: number, text: string, role: "candidate" | "interviewer" = "candidate") => ({ id, at, wall: "", channel: "interview" as const, role, text });
  const session = {
    track: "hld",
    durationMs: 45 * MIN,
    startedAt: new Date(0).toISOString(),
    endedAt: null,
    pausedMs: 0,
    pauseStartedAt: null,
    phaseHistory: [
      { phase: "requirements", at: 0, by: "candidate" },
      { phase: "api", at: 5 * MIN, by: "candidate" },
      { phase: "requirements", at: 8 * MIN, by: "candidate" },
      { phase: "design", at: 10 * MIN, by: "candidate" },
    ],
    transcript: [
      entry("1", MIN, "latency under 50 ms"),
      entry("2", 6 * MIN, "POST /links"),
      entry("3", 9 * MIN, "also 99.9 percent uptime"),
      entry("4", 11 * MIN, "I add a cache"),
    ],
    stepNotes: { api: "returns 201" },
    stepCode: {},
    board: { version: 1, graphText: "", updatedAt: null },
  } as unknown as Session;

  it("gives each step only its own chat across its visits, plus its written answer", () => {
    const by = stepSources(session, null, { endMs: 20 * MIN });
    expect(by.requirements?.candidate).toContain("latency under 50 ms");
    expect(by.requirements?.candidate).toContain("99.9 percent uptime");
    expect(by.requirements?.candidate).not.toContain("POST /links");
    expect(by.api?.candidate).toContain("POST /links");
    expect(by.api?.candidate).toContain("returns 201");
    expect(by.api?.candidate).not.toContain("cache");
  });

  it("uses a step's own board text when given, and the whole board otherwise", () => {
    const withBoard = { ...session, board: { version: 1, graphText: "whole board", updatedAt: null } } as Session;
    expect(stepSources(withBoard, null, { endMs: 20 * MIN, stepBoard: { api: "api frame" } }).api?.board).toBe("api frame");
    expect(stepSources(withBoard, null, { endMs: 20 * MIN }).api?.board).toBe("whole board");
  });

  it("checks a step quote against its own step only", () => {
    const by = stepSources(session, null, { endMs: 20 * MIN });
    const stepCard = { steps: [{ phase: "api", took: [{ evidence: { quote: "latency under 50 ms", source: "candidate" as const } }] }] };
    expect(checkStepQuotes(stepCard, (phase) => by[phase] ?? { candidate: "", board: "", code: "" })).toEqual([{ phase: "api", index: 0, verified: false }]);
  });
});
