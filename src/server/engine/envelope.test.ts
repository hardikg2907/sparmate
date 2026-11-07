import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "../../shared/types";
import {
  SilentFilter,
  candidateEnvelope,
  cleanReply,
  clockTurn,
  contextBlock,
  numberedCode,
  runSummary,
  stepEntries,
  stepSummariesText,
  transcriptLines,
  type RunView,
  type TimeView,
} from "./envelope";

const MIN = 60_000;
const time: TimeView = { roundMs: 12 * MIN + 34_000, durationMs: 45 * MIN, guided: false, phaseId: "api", plannedStartMs: 8 * MIN, plannedEndMs: 12 * MIN };

describe("candidate envelope", () => {
  it("matches the documented layout with a changed board, code, a run and events", () => {
    const run: RunView = {
      compile: { ok: true, diagnostics: [], stderr: "", durationMs: 900 },
      run: { exitCode: 0, signal: null, stdout: Array.from({ length: 18 }, (_, i) => `line ${i}`).join("\n"), stderr: "", timedOut: false, durationMs: 41 },
    };
    const text = candidateEnvelope(
      {
        time,
        board: { version: 14, graphText: "Nodes:\n- [Load balancer] (kind: load_balancer)", changed: true },
        code: { lines: 142, changed: true, check: { errors: 2, warnings: 1 } },
        lastRun: run,
        events: ['candidate moved to phase "design" at 12:10'],
      },
      "I'd put a cache in front.",
    );
    expect(text).toBe(
      [
        "<context>",
        "time: 12:34 of 45:00 · phase: api (planned 8:00–12:00)",
        "behind plan: 0:34 past the planned end of this phase",
        "board: changed since you last looked (version 14)",
        "<board>",
        "Nodes:\n- [Load balancer] (kind: load_balancer)",
        "</board>",
        "code: 142 lines, changed · last check: 2 errors, 1 warning",
        "last run: exit 0 in 41 ms, 18 lines of output",
        'events: candidate moved to phase "design" at 12:10',
        "</context>",
        "<candidate>",
        "I'd put a cache in front.",
        "</candidate>",
      ].join("\n"),
    );
  });

  it("omits the board block when unchanged and says empty for a fresh board", () => {
    expect(contextBlock({ time, board: { version: 14, graphText: "x", changed: false } })).toContain("board: unchanged (version 14)");
    expect(contextBlock({ time, board: { version: 14, graphText: "x", changed: false } })).not.toContain("<board>");
    expect(contextBlock({ time, board: { version: 0, graphText: "", changed: true } })).toContain("board: empty");
  });

  it("sends his step answers only when they changed, and says when he is behind plan", () => {
    const board = { version: 1, graphText: "a", changed: false };
    const notes = { version: 3, text: "[Requirements]\nFunctional: shorten", changed: true };
    expect(contextBlock({ time, board, notes })).toContain("<notes>\n[Requirements]\nFunctional: shorten\n</notes>");
    expect(contextBlock({ time, board, notes: { ...notes, changed: false } })).not.toContain("notes");
    expect(contextBlock({ time, board, notes: { version: 0, text: "", changed: true } })).not.toContain("notes");
    expect(contextBlock({ time, board, notes: { version: 4, text: "", changed: true } })).toContain("his written answers are now empty");
    expect(contextBlock({ time: { ...time, roundMs: 8 * MIN + 10_000 }, board })).not.toContain("behind plan");
    expect(contextBlock({ time: { ...time, guided: true, roundMs: 30 * MIN }, board })).not.toContain("behind plan");
  });

  it("has no time line for the coach and says guided rounds have no limit", () => {
    expect(contextBlock({ board: { version: 1, graphText: "a", changed: false } })).not.toContain("time:");
    expect(contextBlock({ time: { ...time, guided: true }, board: { version: 0, graphText: "", changed: false } })).toContain(
      "time: 12:34 (guided practice, no time limit) · phase: api",
    );
  });
});

describe("clock turn", () => {
  it("says when the candidate last spoke and asks for silence when there is nothing to say", () => {
    const text = clockTurn({ ...time, roundMs: 12 * MIN, phaseId: "requirements", plannedStartMs: 0, plannedEndMs: 5 * MIN }, 130_000, "phase_end", "hld");
    expect(text.split("\n")[1]).toBe("time: 12:00 of 45:00 · phase: requirements (planned 0:00–5:00) · candidate's last message: 2:10 ago");
    expect(text).toContain("Otherwise reply with exactly <silent/>.");
    expect(text.startsWith("<clock>\n")).toBe(true);
    expect(text.endsWith("\n</clock>")).toBe(true);
  });

  it("names the right brief section for the extension", () => {
    expect(clockTurn(time, null, "extension", "hld")).toContain("Curveballs");
    expect(clockTurn(time, null, "extension", "lld")).toContain("Extensions");
    expect(clockTurn(time, null, "extension", "lld")).toContain("candidate's last message: none yet");
  });
});

describe("silent rule", () => {
  function stream(chunks: string[]) {
    const shown: string[] = [];
    const f = new SilentFilter((t) => shown.push(t));
    for (const c of chunks) f.push(c);
    const stored = f.finish();
    return { shown: shown.join(""), stored };
  }

  it("never streams a reply that is exactly <silent/>, even split across chunks", () => {
    expect(stream(["<si", "lent", "/>"])).toEqual({ shown: "", stored: "" });
    expect(stream(["  <silent/>\n"])).toEqual({ shown: "", stored: "" });
  });

  it("strips <silent/> inside a longer reply", () => {
    const r = stream(["Okay. <sil", "ent/> Go on."]);
    expect(r.stored).toBe("Okay.  Go on.");
    expect(r.shown).toBe("Okay.  Go on.");
  });

  it("streams normal text and keeps a lone < that turns out to be text", () => {
    expect(stream(["a < b", " and c"])).toEqual({ shown: "a < b and c", stored: "a < b and c" });
    expect(stream(["x <s"])).toEqual({ shown: "x <s", stored: "x <s" });
  });

  it("cleans replies", () => {
    expect(cleanReply(" <silent /> ")).toBe("");
    expect(cleanReply("Hi<silent/>")).toBe("Hi");
  });
});

describe("transcript and code text", () => {
  it("formats the judge transcript with events", () => {
    const entries: TranscriptEntry[] = [
      { id: "1", at: 0, wall: "", channel: "interview", role: "interviewer", text: "Let's start." },
      { id: "2", at: 65_000, wall: "", channel: "interview", role: "candidate", text: "Requirements first." },
      { id: "3", at: 70_000, wall: "", channel: "interview", role: "system", text: "clock: phase end", kind: "clock", hidden: true },
      { id: "4", at: 80_000, wall: "", channel: "coach", role: "coach", text: "not here" },
    ];
    expect(transcriptLines(entries, "interview")).toBe(
      "[00:00] interviewer: Let's start.\n[01:05] candidate: Requirements first.\n[01:10] (event) clock: phase end",
    );
  });

  it("keeps only the interview chat from every visit to a step", () => {
    const e = (id: string, at: number, extra: Partial<TranscriptEntry> = {}): TranscriptEntry => ({ id, at, wall: "", channel: "interview", role: "candidate", text: id, ...extra });
    const entries = [e("a", 10), e("b", 120), e("c", 130, { hidden: true, role: "system" }), e("d", 140, { channel: "coach" }), e("e", 250), e("f", 260, { kind: "phase", role: "system" })];
    const history = [
      { phase: "requirements", at: 0 },
      { phase: "capacity", at: 100 },
      { phase: "requirements", at: 200 },
    ];
    expect(stepEntries(entries, history, "requirements", 300).map((x) => x.id)).toEqual(["a", "e"]);
    expect(stepEntries(entries, history, "capacity", 300).map((x) => x.id)).toEqual(["b"]);
  });

  it("lists only finished notepads, in step order", () => {
    const phases = [
      { id: "requirements", label: "Requirements" },
      { id: "capacity", label: "Capacity" },
    ];
    const text = stepSummariesText(phases, {
      capacity: { status: "done", proposed: ["40 writes/s"], agreed: [] },
      requirements: { status: "pending", proposed: ["old"], agreed: [] },
    });
    expect(text).toBe("[Capacity]\nHe proposed:\n- 40 writes/s");
  });

  it("numbers code lines", () => {
    expect(numberedCode("a\nb\n")).toBe("1 | a\n2 | b");
  });

  it("summarizes compile failures and timeouts", () => {
    expect(
      runSummary({ compile: { ok: false, diagnostics: [{ line: 1, column: 1, severity: "error", message: "x" }], stderr: "", durationMs: 1 }, run: null }),
    ).toBe("compile failed with 1 error");
    expect(
      runSummary({
        compile: { ok: true, diagnostics: [], stderr: "", durationMs: 1 },
        run: { exitCode: null, signal: "SIGKILL", stdout: "", stderr: "", timedOut: true, durationMs: 5000 },
      }),
    ).toBe("timed out after 5000 ms, 0 lines of output");
  });
});
