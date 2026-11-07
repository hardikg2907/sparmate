// Real-model smoke check of the Claude driver, run outside the server:
//
//   npx tsx scripts/e2e/ws-real-smoke.mjs            three interviewer turns, one judge call, one scribe call
//   npx tsx scripts/e2e/ws-real-smoke.mjs --resume   also resumes the interviewer's SDK session for one more turn
//
// It uses the Claude Code login on this machine (no API key) and short inline prompts, so it does not depend on
// the prompt files. Turns run at effort "low" to keep the cost small. It prints timings and the cost per call, and
// whether the structured-output JSON Schemas were accepted in their strict form.
import { mkdtemp, readdir, rm, rmdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { deleteSession } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { createClaudeDriver } from "../../src/server/engine/claude-driver.ts";
import { defineTool, textOutput } from "../../src/server/engine/driver.ts";
import { SilentFilter, candidateEnvelope, startTurn } from "../../src/server/engine/envelope.ts";
import { memoryLogger } from "../../src/server/engine/log.ts";
import { toApiSchema, toCompatSchema } from "../../src/server/engine/schemas.ts";
import { ScorecardSchema, ScribeOutputSchema } from "../../src/shared/types.ts";

const MODEL = "claude-opus-5-5";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const GRAPH = "Nodes:\n- [Load balancer] (kind: load_balancer)\n- [Redirect service] (kind: service)\n- [Redis] (kind: cache)\nEdges:\n- [Load balancer] -> [Redirect service]\n- [Redirect service] -> [Redis] \"GET code\"";
const PRIVACY = "Never mention the user's email address, employer, or any company, product or service names from automatic context. Use plain technology names such as Postgres, Redis and Kafka.";

const INTERVIEWER_PROMPT = `You are a system design interviewer in a short practice round about a URL shortener.
${PRIVACY}
Messages arrive as a <context> block with a <candidate>, <start> or <clock> part. Answer only what the candidate said, in one or two short sentences, with no praise and no hints.
On <start>, say exactly: Let's design a URL shortener. Where would you like to start?
When the candidate asks you to look at the whiteboard, call the view_whiteboard tool first, then say in one sentence what you see on it.`;

const JUDGE_PROMPT = `You are a strict judge of a practice system design round. Score only from the evidence given.
${PRIVACY}
Use these dimension ids: navigation, design, depth, scale_reliability, communication, drive_time. Quote the candidate word for word. Keep every text field short.`;

const SCRIBE_PROMPT = `You write study bookkeeping operations for a personal study tracker.
${PRIVACY}
Return only the operations asked for, with short plain text.`;

const MIN = 60_000;
const ctx = (roundMs, boardChanged) => ({
  time: { roundMs, durationMs: 45 * MIN, guided: false, phaseId: "requirements", plannedStartMs: 0, plannedEndMs: 5 * MIN },
  board: boardChanged ? { version: 1, graphText: GRAPH, changed: true } : { version: 0, graphText: "", changed: true },
});

const log = memoryLogger();
const cwd = await mkdtemp(join(tmpdir(), "ir-agent-cwd-"));
const driver = createClaudeDriver({ cwd, log, clientApp: "interview-room/smoke" });
const report = { model: MODEL, turns: [], judge: null, scribe: null, resume: null };
let toolCalls = 0;
let sdkId = null;

function interviewerSetup(resumeSessionId) {
  return {
    role: "interviewer",
    model: MODEL,
    effort: "low",
    systemPrompt: async () => INTERVIEWER_PROMPT,
    tools: [
      defineTool("view_whiteboard", "See the candidate's whiteboard: an image plus its exact text form.", {}, async () => {
        toolCalls += 1;
        return { content: [{ type: "image", data: PNG, mimeType: "image/png" }, { type: "text", text: GRAPH }] };
      }),
      defineTool("set_phase", "Move the phase rail.", { phase: z.string().min(1).max(40) }, async () => textOutput("ok")),
    ],
    fake: {},
    resumeSessionId,
  };
}

async function turn(conv, label, text, meta) {
  const started = Date.now();
  let firstDelta = null;
  let shown = "";
  const filter = new SilentFilter((t) => {
    firstDelta ??= Date.now() - started;
    shown += t;
  });
  const callsBefore = toolCalls;
  const reply = await conv.send({ text, meta }, { onTextDelta: (d) => filter.push(d) });
  const stored = filter.finish();
  const row = {
    turn: label,
    totalMs: Date.now() - started,
    firstTextMs: firstDelta,
    costUsd: reply.stats.costUsd,
    toolCalls: toolCalls - callsBefore,
    streamedMatchesStored: shown.trim() === stored,
    reply: stored.slice(0, 160),
  };
  report.turns.push(row);
  process.stdout.write(`${label}: ${row.totalMs} ms (first text ${row.firstTextMs} ms), $${row.costUsd?.toFixed(4)}, tools ${row.toolCalls}\n  ${row.reply}\n`);
  return row;
}

async function oneShot(name, setup) {
  const before = log.lines.length;
  const started = Date.now();
  try {
    const res = await driver.runOnce(setup);
    const refused = log.lines.slice(before).some((l) => l.includes("Structured output schema refused"));
    const row = { ms: Date.now() - started, costUsd: res.stats.costUsd, schema: refused ? "compat form after the strict one was refused" : "strict form accepted", zodValid: res.output !== null };
    process.stdout.write(`${name}: ${row.ms} ms, $${row.costUsd?.toFixed(4)}, ${row.schema}, zod ${row.zodValid ? "valid" : "invalid"}\n`);
    return { row, output: res.output };
  } catch (err) {
    const row = { ms: Date.now() - started, error: err.message, detail: err.detail };
    process.stdout.write(`${name}: FAILED after ${row.ms} ms: ${err.message}\n  ${String(err.detail).slice(0, 400)}\n`);
    return { row, output: null };
  }
}

try {
  const conv = driver.startConversation(interviewerSetup(null));
  await turn(conv, "turn 1 (start)", startTurn(ctx(0, false)), { kind: "start" });
  await turn(conv, "turn 2 (candidate)", candidateEnvelope(ctx(65_000, false), "I'd start with requirements: create short links and redirect them, about 100 million new links a month."), { kind: "candidate" });
  const t3 = await turn(conv, "turn 3 (whiteboard)", candidateEnvelope(ctx(190_000, true), "I've drawn the first boxes. Can you look at my whiteboard?"), { kind: "candidate" });
  sdkId = conv.sdkSessionId();
  conv.close();
  report.viewWhiteboardCalled = t3.toolCalls > 0;
  report.sdkSessionId = sdkId ? "captured" : "missing";

  if (process.argv.includes("--resume") && sdkId) {
    const resumed = driver.startConversation(interviewerSetup(sdkId));
    const r = await turn(resumed, "turn 4 (resumed)", candidateEnvelope(ctx(250_000, false), "Remind me in a few words: what number did I give for new links per month?"), { kind: "candidate" });
    resumed.close();
    report.resume = { remembered: /100\s*million|100M|100,000,000/i.test(r.reply), reply: r.reply };
  }

  const transcript = [
    "[00:00] interviewer: Let's design a URL shortener. Where would you like to start?",
    "[01:05] candidate: I'd start with requirements: create short links and redirect them, about 100 million new links a month.",
    "[03:10] candidate: I've drawn the first boxes. Can you look at my whiteboard?",
  ].join("\n");
  const judge = await oneShot("judge", {
    role: "judge",
    model: MODEL,
    effort: "low",
    systemPrompt: async () => JUDGE_PROMPT,
    tools: [],
    fake: {},
    turn: { text: `<transcript>\n${transcript}\n</transcript>\n<board_final>\n${GRAPH}\n</board_final>\nThe final board is attached as an image. Return the scorecard.`, images: [{ data: PNG, mimeType: "image/png" }], meta: { kind: "oneshot" } },
    output: { schema: ScorecardSchema, jsonSchema: toApiSchema(ScorecardSchema), fallbackJsonSchema: toCompatSchema(ScorecardSchema) },
    maxTurns: 6,
  });
  report.judge = { ...judge.row, dimensions: judge.output?.dimensions.length ?? 0 };

  const scribe = await oneShot("scribe", {
    role: "scribe",
    model: MODEL,
    effort: "low",
    systemPrompt: async () => SCRIBE_PROMPT,
    tools: [],
    fake: {},
    turn: {
      text: "Return exactly two ops: a tracker_update_bullet for section '### C2. Classic HLD Problems', bullet 'URL Shortener', mark '[~]', appendSuffix 'notes/c2-url-shortener.md · 2026-10-29'; and a notes_create for path 'notes/c2-url-shortener.md' with a short Markdown note of at least three lines about a practice round.",
      meta: { kind: "oneshot" },
    },
    output: { schema: ScribeOutputSchema, jsonSchema: toApiSchema(ScribeOutputSchema), fallbackJsonSchema: toCompatSchema(ScribeOutputSchema) },
    maxTurns: 6,
  });
  report.scribe = { ...scribe.row, ops: scribe.output?.ops.map((o) => o.kind) ?? [] };
} finally {
  driver.closeAll();
  // Interviewer conversations persist for resume; this check leaves nothing behind in ~/.claude/projects.
  if (sdkId) await deleteSession(sdkId, { dir: cwd }).catch(() => undefined);
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  for (const name of await readdir(projects).catch(() => [])) {
    // rmdir only removes an empty folder, so nothing but this run's own leftover can go.
    if (name.endsWith(`-${basename(cwd)}`)) await rmdir(join(projects, name)).catch(() => undefined);
  }
  await rm(cwd, { recursive: true, force: true });
}

const total = [...report.turns.map((t) => t.costUsd ?? 0), report.judge?.costUsd ?? 0, report.scribe?.costUsd ?? 0].reduce((a, b) => a + b, 0);
report.totalCostUsd = Math.round(total * 10_000) / 10_000;
process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`);
const ok = report.turns.length >= 3 && report.viewWhiteboardCalled && report.judge?.zodValid && report.scribe?.zodValid;
process.exitCode = ok ? 0 : 1;
