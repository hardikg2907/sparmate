import { randomUUID } from "node:crypto";
import type { PhaseDef } from "../../shared/phases";
import type { BookkeepingOp, Scorecard } from "../../shared/types";
import {
  DriverError,
  type Conversation,
  type ConversationSetup,
  type Driver,
  type FakeFacts,
  type OneShotResult,
  type OneShotSetup,
  type RoleSetup,
  type ToolOutput,
  type TurnHandlers,
  type TurnReply,
  type TurnStats,
  type UserTurn,
} from "./driver";

const HLD_DIMENSIONS = ["navigation", "design", "depth", "scale_reliability", "communication", "drive_time"];
const LLD_DIMENSIONS = ["requirements", "working_code", "design", "extensibility", "edge_cases", "concurrency", "code_quality", "communication_time"];
export const FAKE_INVENTED_QUOTE = "I would shard everything by user id from day one";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callTool(setup: RoleSetup, name: string, args: Record<string, unknown>): Promise<ToolOutput | null> {
  const t = setup.tools.find((x) => x.name === name);
  return t ? t.run(args) : null;
}

/** Streams a reply in a few chunks over about 300 ms, the way a model would. */
async function streamOut(text: string, handlers: TurnHandlers, chunkDelayMs: number): Promise<void> {
  const parts = 4;
  const size = Math.max(1, Math.ceil(text.length / parts));
  for (let i = 0; i < text.length; i += size) {
    handlers.onTextDelta(text.slice(i, i + size));
    if (chunkDelayMs > 0) await sleep(chunkDelayMs);
  }
}

function findPhase(phases: readonly PhaseDef[], wanted: string): PhaseDef | undefined {
  const w = wanted.trim().toLowerCase().replace(/[.!?]+$/, "");
  return phases.find((p) => w.startsWith(p.label.toLowerCase()) || w.startsWith(p.id.replace(/_/g, " ")) || w.startsWith(p.id));
}

/** The first numbered item of a brief section, reduced to one short line an interviewer could say. */
export function firstItem(section: string | undefined): string {
  const line = (section ?? "").split("\n").find((l) => /^\s*1\.\s/.test(l)) ?? "";
  const quoted = /"([^"]{10,})"/.exec(line);
  if (quoted?.[1]) return quoted[1];
  const plain = line.replace(/^\s*1\.\s*/, "").replace(/\*\*[^*]*\*\*\s*/, "").trim();
  return plain.split(/(?<=\.)\s/).slice(0, 2).join(" ") || "Let's add one new requirement.";
}

function currentPhase(facts: FakeFacts): PhaseDef | undefined {
  const id = facts.session?.().phase;
  return facts.phases?.find((p) => p.id === id);
}

class FakeConversation implements Conversation {
  private sessionId: string | null;
  private closed = false;
  private turnIndex = 0;

  constructor(
    private readonly setup: ConversationSetup,
    private readonly chunkDelayMs: number,
  ) {
    this.sessionId = setup.resumeSessionId;
  }

  sdkSessionId(): string | null {
    return this.sessionId;
  }

  async send(turn: UserTurn, handlers: TurnHandlers): Promise<TurnReply> {
    if (this.closed) throw new DriverError("The conversation was closed.");
    const started = Date.now();
    this.sessionId ??= `fake-${randomUUID()}`;
    const text = this.setup.role === "coach" ? await this.coachReply(turn) : await this.interviewerReply(turn);
    await streamOut(text, handlers, this.chunkDelayMs);
    if (this.closed) throw new DriverError("The conversation was closed.");
    const isFirstTurn = this.turnIndex === 0;
    this.turnIndex++;
    const inputTokens = isFirstTurn ? 1200 : 350;
    const outputTokens = Math.max(50, Math.min(600, Math.round(text.length / 4)));
    const cacheReadTokens = isFirstTurn ? 0 : 1500 + this.turnIndex * 200;
    const cacheCreationTokens = isFirstTurn ? 1500 : 250;
    const costUsd = isFirstTurn ? 0.006 : 0.002;
    return {
      text,
      stats: {
        durationMs: Date.now() - started,
        costUsd,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        model: this.setup.model,
      },
    };
  }

  close(): void {
    this.closed = true;
  }

  private async interviewerReply(turn: UserTurn): Promise<string> {
    const facts = this.setup.fake;
    const problem = facts.problem;
    const phases = facts.phases ?? [];
    switch (turn.meta.kind) {
      case "start":
        return problem?.sections["Opening prompt"] ?? "Let's begin. Where would you like to start?";
      case "replay":
        return "Okay, let's carry on from where we were.";
      case "clock": {
        const cp = turn.meta.checkpoint;
        if (cp === "extension") {
          const section = facts.track === "lld" ? problem?.sections.Extensions : problem?.sections.Curveballs;
          return `Let's add something. ${firstItem(section)}`;
        }
        if (cp === "time_up") return "We're out of time, so let's stop here. Thank you.";
        return "<silent/>";
      }
      case "request": {
        const label = currentPhase(facts)?.label ?? "this step";
        if (turn.meta.request === "hint") {
          const session = facts.session?.();
          const level = Math.min(3, (session?.hints.length ?? 0) + 1);
          await callTool(this.setup, "note_hint", { level, topic: `${label}: the main constraint` });
          return `Hint ${level}: think about which number in ${label.toLowerCase()} changes the design the most.`;
        }
        if (turn.meta.request === "feedback") await this.pinOnCheck();
        return `On ${label.toLowerCase()}: the requirements you named hold up. What is missing is a number for the read load. The single most important fix is to state the latency target.`;
      }
      case "candidate":
      default: {
        const said = turn.meta.candidateText ?? "";
        const move = /let'?s move to (.+)/i.exec(said);
        if (move?.[1]) {
          const phase = findPhase(phases, move[1]);
          if (phase) {
            await callTool(this.setup, "set_phase", { phase: phase.id });
            return `Okay, go ahead with ${phase.label.toLowerCase()}.`;
          }
        }
        if (/look at (the|my) (board|whiteboard|diagram)/i.test(said)) {
          const out = await callTool(this.setup, "view_whiteboard", {});
          const sawImage = out?.content.some((c) => c.type === "image") ?? false;
          return sawImage ? "I can see your board. Walk me through one request." : "I have the text form of your board. Walk me through one request.";
        }
        if (/what do my notes say/i.test(said)) {
          const block = /<notes>\n([\s\S]*?)\n<\/notes>/.exec(turn.text);
          return block ? `I read your notes: ${block[1]?.split("\n").join(" / ")}` : "There is no notes block this turn.";
        }
        if (/read my code/i.test(said)) {
          await callTool(this.setup, "read_code", {});
          return "I've read it. What does main() show so far?";
        }
        if (/run (it|my code)/i.test(said)) {
          await callTool(this.setup, "run_code", {});
          return "I ran it. Tell me what the output proves.";
        }
        if (/end (the )?interview/i.test(said)) {
          await callTool(this.setup, "end_interview", { reason: "The candidate asked to stop." });
          return "Okay, let's stop here.";
        }
        const label = currentPhase(facts)?.label ?? "this step";
        return `Okay. What would you do next in ${label.toLowerCase()}?`;
      }
    }
  }

  /**
   * A real guide sometimes names an element that does not exist, so the fake tries a made-up id first and only
   * then pins the first labelled box, which keeps the server's id check exercised on every step check.
   */
  private async pinOnCheck(): Promise<void> {
    await callTool(this.setup, "pin_note", { elementId: "no-such-element", note: "This id is not on the board." });
    const target = this.setup.fake.pinTargets?.().find((t) => t.kind === "box" && t.label !== "");
    if (target) await callTool(this.setup, "pin_note", { elementId: target.id, note: `Say what ${target.label} does when it fails.` });
  }

  private async coachReply(turn: UserTurn): Promise<string> {
    const card = this.setup.fake.scorecard;
    const top = card?.gaps[0]?.title ?? "the biggest gap";
    if (turn.meta.request === "coach_open") {
      if (card?.gaps[0]) await callTool(this.setup, "set_gap", { title: card.gaps[0].title, state: "started" });
      return `${card?.verdict.summary ?? "The round is scored."} Most of the signal sits in the gaps below.\n\nLet's start with ${top.toLowerCase()}. What do you think the interviewer wanted to hear there?`;
    }
    return `Good question. The short version is that every number should end in a decision about the design.\n\nTry it on ${top.toLowerCase()}: say the number, then say what it forces you to build.`;
  }
}

function fakeScorecard(facts: FakeFacts): Scorecard {
  const ids = facts.dimensionIds ?? (facts.track === "lld" ? LLD_DIMENSIONS : HLD_DIMENSIONS);
  const lines = (facts.candidateLines ?? []).map((l) => l.trim()).filter((l) => l.length > 0);
  const realQuote = (i: number): string | null => {
    const line = lines[i % Math.max(1, lines.length)];
    if (!line) return null;
    return line.split(/\s+/).slice(0, 8).join(" ");
  };
  return {
    verdict: {
      sde2: "lean_no_hire",
      senior: "no_hire",
      confidence: "medium",
      summary: "The round covered the opening steps with clear requirements. The design stopped before the deep dives. The numbers did not yet drive the choices.",
    },
    dimensions: ids.map((id, i) => {
      const quote = realQuote(i);
      const evidence: Scorecard["dimensions"][number]["evidence"] = quote ? [{ quote, source: "candidate", at: "", polarity: "plus" }] : [];
      if (i === 0) evidence.push({ quote: FAKE_INVENTED_QUOTE, source: "candidate", at: "", polarity: "minus" });
      return {
        id,
        name: id.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
        score: i % 2 === 0 ? 2 : 3,
        evidence,
        whatA4LooksLike: "A 4 here names the hard part early and backs each choice with a number.",
      };
    }),
    steps: [
      {
        phase: facts.phases?.[0]?.id ?? (facts.track === "lld" ? "clarify" : "requirements"),
        took: [
          {
            point: "Clarified key functional scope upfront.",
            dimensionId: ids[0] ?? (facts.track === "lld" ? "requirements" : "navigation"),
            evidence: {
              quote: realQuote(0) ?? "Requirements were discussed.",
              source: "candidate",
              at: "",
              polarity: "plus",
            },
          },
        ],
        missing: ["Did not state availability numbers or error budget."],
      },
    ],
    strengths: ["Asked about scale before drawing anything."],
    gaps: [
      {
        title: "Capacity math that changes the design",
        severity: "high",
        whyItMatters: "Numbers that do not change a decision waste the time they take.",
        whatGoodLooksLike: "Each number ends with the decision it forces, such as a cache in front of the database.",
        teachMinutes: 10,
      },
      {
        title: "Deep dive on the hardest requirement",
        severity: "medium",
        whyItMatters: "Most of the level signal comes from the follow-ups after the first design.",
        whatGoodLooksLike: "Pick the hardest requirement and go one level deeper without being asked.",
        teachMinutes: 10,
      },
    ],
    timeline: [{ at: "00:00", note: "Round started." }],
    practiceTask: "Redo the capacity step in five minutes and end each number with the decision it forces.",
    trackerMark: "[~]",
    trackerMarkReason: "A practice round with gaps at the SDE-2 bar.",
    lldScenarios: facts.track === "lld" ? (facts.tester?.scenarios ?? []) : [],
  };
}

const STOP_WORDS = new Set(["about", "every", "their", "there", "which", "would", "after", "before", "with", "through", "under", "where", "while", "given", "within", "without", "never", "demo", "entity", "walk", "box"]);

function keywords(label: string): string[] {
  return [...new Set(label.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [])].filter((w) => !STOP_WORDS.has(w));
}

function hitsIn(text: string, words: readonly string[]): number {
  const have = new Set(text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? []);
  return words.filter((w) => have.has(w)).length;
}

/** The label inside brackets or quotes on a frame-text line, which is what the board quote must copy. */
function boardQuote(line: string): string | null {
  const m = /\[([^\]]+)\]|"([^"]+)"/.exec(line);
  return m?.[1] ?? m?.[2] ?? null;
}

/**
 * The checker as a careful but fallible model would answer. It reads whole words only: an item is covered when
 * one of his lines, a frame label or a code line carries at least half of the item's words, and partial when it
 * carries fewer. It always claims one more item with a quote he never said, so the server's quote check must
 * refuse that claim.
 */
function fakeCheck(facts: FakeFacts): { items: { id: string; state: "covered" | "partial" | "missing"; source: "chat" | "board" | "code" | "none"; quote: string; detail: string }[] } {
  const lines = (facts.candidateLines ?? []).map((l) => l.trim()).filter((l) => l !== "");
  const labels = (facts.frameText ?? "").split("\n").flatMap((l) => {
    const q = boardQuote(l);
    return q ? [q] : [];
  });
  const code = (facts.codeText ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "");
  let invented = false;
  const items = (facts.checkItems ?? []).map((item) => {
    const words = keywords(item.label);
    const need = Math.max(1, Math.ceil(words.length / 2));
    const sources: ["chat" | "board" | "code", readonly string[]][] = [["chat", lines], ["board", labels], ["code", code]];
    let best: { source: "chat" | "board" | "code"; quote: string; hits: number } | null = null;
    for (const [source, texts] of sources) {
      for (const text of texts) {
        const hits = hitsIn(text, words);
        if (hits > 0 && (best === null || hits > best.hits)) best = { source, quote: text.slice(0, 200), hits };
      }
    }
    if (best) {
      const state = best.hits >= need ? ("covered" as const) : ("partial" as const);
      return { id: item.id, state, source: best.source, quote: best.quote, detail: state === "partial" ? "only part of it is stated" : "" };
    }
    if (!invented && (facts.checkItems?.length ?? 0) >= 3) {
      invented = true;
      return { id: item.id, state: "covered" as const, source: "chat" as const, quote: "I covered this in detail earlier", detail: "" };
    }
    return { id: item.id, state: "missing" as const, source: "none" as const, quote: "", detail: "" };
  });
  return { items };
}

function trackerCode(section: string | undefined, track: string | undefined): string {
  return /###\s+([A-C]\d+)\./.exec(section ?? "")?.[1] ?? (track === "lld" ? "B3" : "C2");
}

function fakeScribeOps(facts: FakeFacts): BookkeepingOp[] {
  const p = facts.problem;
  if (!p) throw new DriverError("The scribe needs the problem.");
  const date = facts.date ?? "2026-01-01";
  const mark = facts.scorecard?.trackerMark ?? "[~]";
  const code = trackerCode(p.meta.tracker?.section, p.meta.track);
  const ops: BookkeepingOp[] = [];
  if (p.meta.tracker) {
    ops.push({ kind: "tracker_update_bullet", section: p.meta.tracker.section, bullet: p.meta.tracker.bullet, mark, appendSuffix: `${p.meta.notesFile} · ${date}` });
  }
  ops.push({
    kind: "tracker_append_session_log_row",
    date,
    topics: `**${code} ${p.meta.title}**, a ${facts.mode ?? "interview"} round in Interview Room`,
    outcome: `\`${mark}\`. ${facts.scorecard?.verdict.summary ?? "Scored."}`,
    notesFile: p.meta.notesFile,
  });
  ops.push({
    kind: "review_append_entry",
    markdown: [
      `## ${code} — ${p.meta.title} · taught ${date}`,
      `1. Explain to a junior: what made ${p.meta.title.toLowerCase()} hard, in two sentences?`,
      `2. Finish it: "I'd pick this design over the simpler one when ___, because I'm trading ___ for ___."`,
      "3. Transfer: the same problem at ten times the load. What breaks first?",
      "",
      "Result: not yet asked.",
    ].join("\n"),
  });
  const body = [
    `The round practised ${p.meta.title} in ${facts.mode ?? "interview"} mode.`,
    "",
    `Top gap: ${facts.scorecard?.gaps[0]?.title ?? "none recorded"}.`,
  ].join("\n");
  if (facts.notesFileExists) {
    ops.push({ kind: "notes_append", path: p.meta.notesFile, content: `## Practice round · ${date}\n\n${body}\n` });
  } else {
    ops.push({
      kind: "notes_create",
      path: p.meta.notesFile,
      content: `# ${code} — ${p.meta.title}\n\n**Date:** ${date} · **Tracker:** ${code} · **Status:** ${mark}\n\n## Practice round\n\n${body}\n`,
    });
  }
  return ops;
}

async function fakeOneShot(setup: OneShotSetup<unknown>): Promise<unknown> {
  const facts = setup.fake;
  switch (setup.role) {
    case "tester": {
      await callTool(setup, "read_code", {});
      const run = await callTool(setup, "run_harness", {
        harness: '#include <cstdio>\nint main() {\n  std::puts("scenario 1: ok");\n  return 0;\n}\n',
      });
      const runText = run?.content.map((c) => (c.type === "text" ? c.text : "")).join("\n") ?? "";
      const compiled = /compile: ok/.test(runText);
      return {
        compiled,
        scenarios: [
          { name: "Scenario 1: the first happy path", pass: compiled, detail: compiled ? "The harness ran and printed the expected line." : "The code did not compile." },
          { name: "Scenario 2: a rejected request", pass: false, detail: "No way to express a rejection through the candidate's API." },
        ],
        notes: "Fake tester: one harness run, two canned scenarios.",
      };
    }
    case "judge": {
      const targets = (facts.pinTargets?.() ?? []).filter((t) => t.label !== "");
      const [held, gap] = targets;
      if (held) await callTool(setup, "pin_element", { elementId: held.id, note: `${held.label} is placed where the request needs it.`, verdict: "held" });
      if (gap) await callTool(setup, "pin_element", { elementId: gap.id, note: `${gap.label} has no plan for failure.`, verdict: "gap" });
      return fakeScorecard(facts);
    }
    case "checker":
      return fakeCheck(facts);
    case "scribe":
      return { ops: fakeScribeOps(facts) };
    case "brief-writer": {
      const example = facts.exampleProblem;
      if (!example) throw new DriverError("No example problem to copy.");
      const words = (setup.turn.meta.candidateText ?? "Practice problem").replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).slice(0, 5).join(" ");
      setup.onToolUse?.("WebSearch", { query: words });
      setup.onToolUse?.("WebFetch", { url: "https://example.com/system-design" });
      return {
        meta: { title: `Custom: ${words}`.slice(0, 120), difficulty: example.meta.difficulty, tags: [...example.meta.tags] },
        body: example.body,
        sources: [
          { title: "Example Architecture Reference", url: "https://example.com/system-design" },
        ],
        confidence: "Verified against standard industry reference architectures.",
      };
    }
    case "brief-checker": {
      const example = facts.exampleProblem;
      const body = facts.problem?.body ?? example?.body ?? "";
      setup.onToolUse?.("WebFetch", { url: "https://example.com/system-design" });
      return {
        body,
        corrections: [
          {
            section: "Capacity math",
            claim: "Peak throughput is 10,000 QPS",
            fix: "Peak throughput is 12,000 QPS based on real metrics",
            source: "https://example.com/system-design",
          },
        ],
        unconfirmed: [],
      };
    }
    default:
      throw new DriverError(`The ${setup.role} role has no one-shot form.`);
  }
}

function fakeOneShotStats(setup: OneShotSetup<unknown>, durationMs: number): TurnStats {
  switch (setup.role) {
    case "judge":
      return { durationMs, costUsd: 0.02, inputTokens: 3500, outputTokens: 1200, cacheReadTokens: 2000, cacheCreationTokens: 1000, model: setup.model };
    case "tester":
      return { durationMs, costUsd: 0.01, inputTokens: 2000, outputTokens: 500, cacheReadTokens: 1500, cacheCreationTokens: 500, model: setup.model };
    case "scribe":
      return { durationMs, costUsd: 0.015, inputTokens: 2500, outputTokens: 800, cacheReadTokens: 2000, cacheCreationTokens: 500, model: setup.model };
    case "checker":
      return { durationMs, costUsd: 0.004, inputTokens: 1400, outputTokens: 220, cacheReadTokens: 900, cacheCreationTokens: 200, model: setup.model };
    case "brief-writer":
      return { durationMs, costUsd: 0.02, inputTokens: 3000, outputTokens: 1500, cacheReadTokens: 1500, cacheCreationTokens: 1500, model: setup.model };
    default:
      return { durationMs, costUsd: 0.005, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 500, cacheCreationTokens: 500, model: setup.model };
  }
}

export function createFakeDriver(options: { chunkDelayMs?: number } = {}): Driver & { closeAll(): void } {
  const chunkDelayMs = options.chunkDelayMs ?? 75;
  return {
    kind: "fake",
    startConversation: (setup: ConversationSetup) => new FakeConversation(setup, chunkDelayMs),
    async runOnce<T>(setup: OneShotSetup<T>): Promise<OneShotResult<T>> {
      if (setup.signal?.aborted) throw new DriverError("The model process was aborted.");
      const started = Date.now();
      const raw = await fakeOneShot(setup as OneShotSetup<unknown>);
      if (setup.signal?.aborted) throw new DriverError("The model process was aborted.");
      await sleep(Math.min(chunkDelayMs, 50));
      if (setup.signal?.aborted) throw new DriverError("The model process was aborted.");
      const stats = fakeOneShotStats(setup as OneShotSetup<unknown>, Date.now() - started);
      if (!setup.output) return { text: JSON.stringify(raw), output: null, stats };
      const parsed = setup.output.schema.safeParse(raw);
      if (!parsed.success) throw new DriverError("The fake model produced invalid data.", parsed.error.message);
      return { text: JSON.stringify(parsed.data), output: parsed.data, stats };
    },
    closeAll() {},
  };
}
