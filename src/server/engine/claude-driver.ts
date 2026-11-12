import { createSdkMcpServer, query, tool, type Options, type Query, type SDKMessage, type SDKResultMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  DriverError,
  type Conversation,
  type ConversationSetup,
  type ManagedDriver,
  type OneShotResult,
  type OneShotSetup,
  type RoleSetup,
  type RoomTool,
  type TurnHandlers,
  type TurnReply,
  type UserTurn,
} from "./driver";
import { truncate, type Logger } from "./log";
import { AssistantSpend, addStats, attachFailureStats, extractConversationStats, extractOneShotStats, failureStats, noResultStats } from "./usage-capture";

export interface ClaudeDriverOptions {
  /** Empty folder every model subprocess runs in. */
  cwd: string;
  log: Logger;
  clientApp?: string;
}

const MCP_SERVER = "room";
const TOOL_TIMEOUT_MS = 120_000;

/**
 * Variables that tie a process to a parent Claude Code session. When the server is started from inside one,
 * passing them on would make the model subprocess think it is part of that session (and inherit its effort).
 */
const PARENT_SESSION_ENV = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_AGENT_SDK_VERSION",
]);

function childEnv(clientApp: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) if (!PARENT_SESSION_ENV.has(k)) env[k] = v;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = clientApp;
  return env;
}

function toSdkTool(t: RoomTool) {
  return tool(t.name, t.description, t.shape, async (args) => {
    const out = await t.run(args);
    return {
      content: out.content.map((c) => (c.type === "text" ? { type: "text" as const, text: c.text } : { type: "image" as const, data: c.data, mimeType: c.mimeType })),
      ...(out.isError ? { isError: true } : {}),
    };
  });
}

function userMessage(turn: UserTurn): SDKUserMessage {
  const content = turn.images?.length
    ? [
        ...turn.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } })),
        { type: "text" as const, text: turn.text },
      ]
    : turn.text;
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
}

/** An async iterable the SDK reads user messages from; it stays open until end() so tools keep working. */
class InputQueue<T> {
  private readonly items: T[] = [];
  private wake: (() => void) | null = null;
  private ended = false;

  push(item: T): void {
    if (this.ended) return;
    this.items.push(item);
    this.wake?.();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }

  async *iterate(): AsyncGenerator<T> {
    for (;;) {
      while (this.items.length > 0) yield this.items.shift() as T;
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
  }
}

type AssistantErrorKind = NonNullable<Extract<SDKMessage, { type: "assistant" }>["error"]>;

export function plainMessage(kind: AssistantErrorKind | null, status: number | null | undefined): string {
  switch (kind) {
    case "authentication_failed":
    case "oauth_org_not_allowed":
    case "account_on_hold":
    case "verification_required":
    case "billing_error":
    case "cloud_credential_error":
      return "The Claude login did not work. Run claude in a terminal, log in, then retry.";
    case "rate_limit":
      return "The model is rate limited right now. Wait a minute, then retry.";
    case "overloaded":
    case "server_error":
      return "The model service is busy or failing. Retry in a moment.";
    case "model_not_found":
      return "The chosen model is not available. Pick another model in settings, then retry.";
    case "max_output_tokens":
      return "The model's reply was too long and was cut off. Retry.";
    default:
      break;
  }
  if (status === 429) return "The model is rate limited right now. Wait a minute, then retry.";
  if (status === 401 || status === 403) return "The Claude login did not work. Run claude in a terminal, log in, then retry.";
  if (status !== null && status !== undefined && status >= 500) return "The model service is busy or failing. Retry in a moment.";
  return "The model could not answer. Retry.";
}

export class StderrTail {
  private readonly lines: string[] = [];

  constructor(
    private readonly log: Logger,
    private readonly role: string,
  ) {}

  push = (data: string): void => {
    for (const line of data.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.lines.push(truncate(trimmed, 300));
      if (this.lines.length > 12) this.lines.shift();
      this.log.info(`model process (${this.role}): ${truncate(trimmed, 300)}`);
    }
  };

  text(): string {
    return this.lines.join(" | ");
  }
}

export function baseOptions(
  setup: RoleSetup,
  opts: ClaudeDriverOptions,
  systemPrompt: string,
  abortController: AbortController,
  stderr: StderrTail,
  seenToolUseIds?: Set<string>,
): Options {
  const isWebResearchRole = setup.role === "brief-writer" || setup.role === "brief-checker";

  const allowed = isWebResearchRole ? ["WebSearch", "WebFetch"] : setup.tools.map((t) => `mcp__${MCP_SERVER}__${t.name}`);

  const mcpServers: Options["mcpServers"] =
    !isWebResearchRole && setup.tools.length > 0
      ? {
          [MCP_SERVER]: createSdkMcpServer({
            name: MCP_SERVER,
            version: "0.1.0",
            tools: setup.tools.map(toSdkTool),
            // Deferred tools would need a tool-search tool, and this subprocess has no built-in tools at all.
            alwaysLoad: true,
            timeout: TOOL_TIMEOUT_MS,
          }),
        }
      : {};

  let searchCount = 0;
  let fetchCount = 0;
  const maxSearches = setup.role === "brief-checker" ? 3 : 8;
  const maxFetches = setup.role === "brief-checker" ? 10 : 6;
  const seen = seenToolUseIds ?? new Set<string>();

  const hooks: Options["hooks"] = isWebResearchRole
    ? {
        PreToolUse: [
          {
            hooks: [
              async (input, toolUseId) => {
                if (input.hook_event_name === "PreToolUse") {
                  const toolName = input.tool_name;
                  const id = toolUseId || input.tool_use_id;
                  if (id && !seen.has(id)) {
                    seen.add(id);
                    setup.onToolUse?.(toolName, input.tool_input);
                  } else if (!id) {
                    setup.onToolUse?.(toolName, input.tool_input);
                  }

                  if (toolName === "WebSearch") {
                    searchCount++;
                    if (searchCount > maxSearches) {
                      return {
                        decision: "block" as const,
                        reason: `Search limit reached (${maxSearches} max).`,
                        hookSpecificOutput: {
                          hookEventName: "PreToolUse" as const,
                          permissionDecision: "deny" as const,
                          permissionDecisionReason: `Search limit reached (${maxSearches} max).`,
                        },
                      };
                    }
                  } else if (toolName === "WebFetch") {
                    fetchCount++;
                    if (fetchCount > maxFetches) {
                      return {
                        decision: "block" as const,
                        reason: `Fetch limit reached (${maxFetches} max).`,
                        hookSpecificOutput: {
                          hookEventName: "PreToolUse" as const,
                          permissionDecision: "deny" as const,
                          permissionDecisionReason: `Fetch limit reached (${maxFetches} max).`,
                        },
                      };
                    }
                  }
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      permissionDecision: "allow" as const,
                    },
                  };
                }
                return {};
              },
            ],
          },
        ],
      }
    : undefined;

  return {
    // The user's own settings import their CLAUDE.md, which carries context that must never reach these roles.
    settingSources: [],
    tools: isWebResearchRole ? ["WebSearch", "WebFetch"] : [],
    strictMcpConfig: true,
    mcpServers,
    allowedTools: allowed,
    permissionMode: "default",
    // Nothing answers permission prompts, so any tool outside the role's list is denied at once.
    permissionPrompts: "none",
    cwd: opts?.cwd,
    model: setup.model,
    effort: setup.effort,
    systemPrompt,
    // Candidate text must reach the model as written: no @path file expansion, no slash commands.
    verbatimPrompts: true,
    env: childEnv(opts?.clientApp ?? "sparmate/0.1"),
    stderr: stderr.push,
    abortController,
    ...(hooks ? { hooks } : {}),
  };
}

function resultFailure(result: Extract<SDKResultMessage, { type: "result" }>, kind: AssistantErrorKind | null, stderr: StderrTail): DriverError {
  const status = "api_error_status" in result ? result.api_error_status : null;
  const errors = "errors" in result && Array.isArray(result.errors) ? result.errors.join(" | ") : "";
  const text = result.subtype === "success" ? truncate(result.result ?? "", 300) : "";
  const detail = `result ${result.subtype}${status ? ` status ${status}` : ""}${kind ? ` (${kind})` : ""}: ${errors || text} ${stderr.text()}`.trim();
  if (result.subtype === "error_max_turns") return new DriverError("The model took too many steps and was stopped. Retry.", detail);
  if (result.subtype === "error_max_structured_output_retries") return new DriverError("The model could not produce valid structured data. Retry.", detail);
  return new DriverError(plainMessage(kind, status), detail);
}

/** Whitespace runs become one space, so a repeat that differs only in line breaks still matches. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Index in `raw` just after the part that collapses to the first `length` characters of collapse(raw). */
function rawEnd(raw: string, length: number): number {
  let count = 0;
  let inSpace = false;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i]!)) {
      if (!inSpace && count > 0) count++;
      inSpace = true;
    } else {
      inSpace = false;
      count++;
    }
    if (count >= length) return i + 1;
  }
  return raw.length;
}

/** Three-word runs of a text, lower-cased and stripped of punctuation, for comparing two drafts of one reply. */
function wordTriples(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/** Shortest earlier block worth comparing; a short lead-in such as "Let me check." is never a draft of the reply. */
const REDRAFT_MIN_TRIPLES = 12;
/** Share of an earlier block's word runs that a later block must repeat for the later one to count as its rewrite. */
const REDRAFT_OVERLAP = 0.6;

/** Whether `later` says the same thing as `earlier` in new words, so the reader would see the answer twice. */
function rewrites(earlier: string, later: string): boolean {
  const before = wordTriples(earlier);
  if (before.size < REDRAFT_MIN_TRIPLES) return false;
  const after = wordTriples(later);
  let shared = 0;
  for (const run of before) if (after.has(run)) shared++;
  return shared / before.size >= REDRAFT_OVERLAP;
}

/**
 * Joins the top-level text blocks of one turn into the text the user sees. When the model writes a paragraph, calls a
 * tool, then writes it again, the repeat is held back while it still matches the start of an earlier block and
 * dropped when the block ends equal to one. Text is compared with whitespace collapsed, because a repeat often differs
 * only in the line breaks. A held block that goes on past an earlier block keeps only what follows that block, and
 * any other block that stops matching is released whole with its separator, so ordinary text still streams live.
 */
class TurnText {
  text = "";
  private readonly earlier: string[] = [];
  /** What each block put into `text`, so a block the model later wrote again in new words can be left out at the end. */
  private readonly shown: string[] = [];
  private cur: { index: number; text: string; held: boolean; from: number } | null = null;

  constructor(private readonly emit: (delta: string) => void) {}

  private out(delta: string): void {
    this.text += delta;
    this.emit(delta);
  }

  private release(text: string): void {
    this.out(`${this.text.length > 0 ? "\n\n" : ""}${text}`);
  }

  startBlock(index: number): void {
    this.finish();
    this.cur = { index, text: "", held: this.earlier.length > 0, from: this.text.length };
  }

  delta(delta: string): void {
    const cur = this.cur;
    if (!cur) {
      this.out(delta);
      return;
    }
    cur.text += delta;
    if (!cur.held) {
      this.out(delta);
      return;
    }
    const seen = collapse(cur.text);
    if (this.earlier.some((e) => e.startsWith(seen))) return;
    cur.held = false;
    const repeated = this.earlier.filter((e) => e !== "" && seen.startsWith(`${e} `)).sort((a, b) => b.length - a.length)[0];
    this.release(repeated ? cur.text.slice(rawEnd(cur.text, repeated.length)).trimStart() : cur.text);
  }

  stopBlock(index: number): void {
    if (this.cur?.index === index) this.finish();
  }

  finish(): void {
    const cur = this.cur;
    if (!cur) return;
    this.cur = null;
    const seen = collapse(cur.text);
    if (cur.held && seen !== "" && !this.earlier.includes(seen)) this.release(cur.text);
    this.earlier.push(seen);
    const shown = this.text.slice(cur.from).trim();
    if (shown !== "") this.shown.push(shown);
  }

  /**
   * The reply once a block that a later block rewrites is left out. The model sometimes writes its answer, calls a
   * tool, then writes it again in other words; the first draft has already streamed, so the final text drops it.
   */
  settled(): string {
    const kept = this.shown.filter((block, i) => !this.shown.slice(i + 1).some((later) => rewrites(block, later)));
    return kept.length === this.shown.length ? this.text : kept.join("\n\n");
  }
}

/** The blocks of a reply that was never streamed, without a block that repeats an earlier one. */
function distinctBlocks(blocks: string[]): string[] {
  const seen: string[] = [];
  const kept: string[] = [];
  for (const block of blocks) {
    const collapsed = collapse(block);
    if (seen.includes(collapsed)) continue;
    seen.push(collapsed);
    kept.push(block);
  }
  return kept;
}

/** Set once the server starts to stop, so a process the terminal's interrupt kills first is not logged as a failure. */
interface DriverLifecycle {
  stopping: boolean;
}

class ClaudeConversation implements Conversation {
  private readonly input = new InputQueue<SDKUserMessage>();
  private readonly abort = new AbortController();
  private readonly stderr: StderrTail;
  private q: Query | null = null;
  private iterator: AsyncIterator<SDKMessage> | null = null;
  private sessionId: string | null;
  private closed = false;
  private lastCumulativeCost = 0;
  // A resumed session's first running total already holds earlier turns, so that turn's own cost is unknown.
  private costBaselineKnown: boolean;

  constructor(
    private readonly setup: ConversationSetup,
    private readonly opts: ClaudeDriverOptions,
    private readonly registry: Set<{ close(): void }>,
    private readonly lifecycle: DriverLifecycle,
  ) {
    this.costBaselineKnown = !setup.resumeSessionId;
    this.sessionId = setup.resumeSessionId;
    this.stderr = new StderrTail(opts.log, setup.role);
    registry.add(this);
  }

  sdkSessionId(): string | null {
    return this.sessionId;
  }

  async send(turn: UserTurn, handlers: TurnHandlers): Promise<TurnReply> {
    if (this.closed) throw new DriverError("The conversation was closed.");
    if (!this.q) {
      const systemPrompt = await this.setup.systemPrompt();
      if (this.closed) throw new DriverError("The conversation was closed.");
      const options: Options = {
        ...baseOptions(this.setup, this.opts, systemPrompt, this.abort, this.stderr),
        includePartialMessages: true,
        persistSession: true,
        ...(this.setup.resumeSessionId ? { resume: this.setup.resumeSessionId } : {}),
      };
      this.q = query({ prompt: this.input.iterate(), options });
      this.iterator = this.q[Symbol.asyncIterator]();
    }
    this.input.push(userMessage(turn));
    return this.readTurn(handlers);
  }

  private async readTurn(handlers: TurnHandlers): Promise<TurnReply> {
    const started = Date.now();
    const turnText = new TurnText((d) => handlers.onTextDelta(d));
    const assistantTexts: string[] = [];
    const spend = new AssistantSpend();
    let errorKind: AssistantErrorKind | null = null;
    const iterator = this.iterator;
    if (!iterator) throw new DriverError("The model process is not running.");
    for (;;) {
      let next: IteratorResult<SDKMessage>;
      try {
        next = await iterator.next();
      } catch (err) {
        throw this.stopped(started, spend, `${String(err)} ${this.stderr.text()}`);
      }
      if (next.done) throw this.stopped(started, spend, `stream ended ${this.stderr.text()}`);
      const msg = next.value;
      if ("session_id" in msg && typeof msg.session_id === "string" && msg.session_id) this.sessionId = msg.session_id;

      if (msg.type === "stream_event") {
        if (msg.parent_tool_use_id !== null) continue;
        const ev = msg.event;
        if (ev.type === "content_block_start" && ev.content_block.type === "text") turnText.startBlock(ev.index);
        else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") turnText.delta(ev.delta.text);
        else if (ev.type === "content_block_stop") turnText.stopBlock(ev.index);
      } else if (msg.type === "assistant") {
        if (msg.parent_tool_use_id !== null) continue;
        if (msg.error) errorKind = msg.error;
        spend.add(msg.message.id, msg.message.usage);
        for (const block of msg.message.content) if (block.type === "text") assistantTexts.push(block.text);
      } else if (msg.type === "result") {
        turnText.finish();
        const streamed = turnText.text;
        const settled = turnText.settled();
        const { stats, nextCumulativeCost } = extractConversationStats(msg, started, this.lastCumulativeCost, this.setup.model);
        this.lastCumulativeCost = nextCumulativeCost;
        if (!this.costBaselineKnown) {
          stats.costUsd = null;
          this.costBaselineKnown = true;
        }
        if (msg.subtype === "success" && !msg.is_error) {
          if (streamed) return settled === streamed ? { text: streamed, stats } : { text: settled, stats, superseded: true };
          const text = distinctBlocks(assistantTexts).join("\n\n") || msg.result;
          if (text) handlers.onTextDelta(text);
          return { text, stats };
        }
        throw attachFailureStats(resultFailure(msg, errorKind, this.stderr), stats);
      }
    }
  }

  /** The process ended mid-turn. Our own close() is not a failure, so only a real stop carries stats for the ledger. */
  private stopped(started: number, spend: AssistantSpend, detail: string): DriverError {
    if (this.closed || this.lifecycle.stopping) return new DriverError("The conversation was closed.", detail);
    return attachFailureStats(new DriverError("The model process stopped. Retry.", detail), noResultStats(started, this.setup.model, spend));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.registry.delete(this);
    this.input.end();
    this.abort.abort();
    try {
      this.q?.close();
    } catch {
      // The process may already be gone.
    }
  }
}

async function runOnceAttempt<T>(
  setup: OneShotSetup<T>,
  opts: ClaudeDriverOptions,
  jsonSchema: Record<string, unknown> | null,
  registry: Set<{ close(): void }>,
  lifecycle: DriverLifecycle,
): Promise<OneShotResult<T>> {
  if (setup.signal?.aborted) throw new DriverError("The model process was aborted.");
  const started = Date.now();
  const input = new InputQueue<SDKUserMessage>();
  const abort = new AbortController();
  const onSignalAbort = () => {
    abort.abort(setup.signal?.reason);
  };
  setup.signal?.addEventListener("abort", onSignalAbort, { once: true });
  const stderr = new StderrTail(opts.log, setup.role);
  const systemPrompt = await setup.systemPrompt();
  if (setup.signal?.aborted) throw new DriverError("The model process was aborted.");
  const seenToolUseIds = new Set<string>();
  const options: Options = {
    ...baseOptions(setup, opts, systemPrompt, abort, stderr, seenToolUseIds),
    persistSession: false,
    maxTurns: setup.maxTurns,
    ...(jsonSchema ? { outputFormat: { type: "json_schema" as const, schema: jsonSchema } } : {}),
  };
  input.push(userMessage(setup.turn));
  const q = query({ prompt: input.iterate(), options });
  // A call we cancel ourselves writes no ledger row; a process that dies on its own does.
  let cancelled = false;
  const handle = {
    close: () => {
      cancelled = true;
      abort.abort();
      try {
        q.close();
      } catch {}
    },
  };
  registry.add(handle);
  const onQueryAbort = () => {
    try {
      q.close();
    } catch {}
  };
  setup.signal?.addEventListener("abort", onQueryAbort, { once: true });
  let errorKind: AssistantErrorKind | null = null;
  const texts: string[] = [];
  const spend = new AssistantSpend();
  const stoppedError = (message: string, detail: string): DriverError => {
    const err = new DriverError(message, detail);
    return cancelled || lifecycle.stopping || setup.signal?.aborted ? err : attachFailureStats(err, noResultStats(started, setup.model, spend));
  };
  try {
    for await (const msg of q) {
      if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
        if (msg.error) errorKind = msg.error;
        spend.add(msg.message.id, msg.message.usage);
        for (const block of msg.message.content) {
          if (block.type === "text") texts.push(block.text);
          else if (block.type === "tool_use") {
            if (block.id && !seenToolUseIds.has(block.id)) {
              seenToolUseIds.add(block.id);
              setup.onToolUse?.(block.name, block.input);
            }
          }
        }
      } else if (msg.type === "result") {
        const stats = extractOneShotStats(msg, started, setup.model);
        if (msg.subtype !== "success" || msg.is_error) throw attachFailureStats(resultFailure(msg, errorKind, stderr), stats);
        const text = texts.join("\n\n") || msg.result;
        if (!setup.output) return { text, output: null, stats };
        const parsed = setup.output.schema.safeParse(msg.structured_output);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          throw attachFailureStats(new DriverError("The model returned data in the wrong shape. Retry.", `structured output failed validation: ${issues}`), stats);
        }
        return { text, output: parsed.data, stats };
      }
    }
    throw stoppedError("The model process stopped early. Retry.", `no result ${stderr.text()}`);
  } catch (err) {
    if (err instanceof DriverError) throw err;
    throw stoppedError("The model process stopped. Retry.", `${String(err)} ${stderr.text()}`);
  } finally {
    setup.signal?.removeEventListener("abort", onSignalAbort);
    setup.signal?.removeEventListener("abort", onQueryAbort);
    registry.delete(handle);
    input.end();
    try {
      q.close();
    } catch {
      // Already finished.
    }
  }
}

export function createClaudeDriver(opts: ClaudeDriverOptions): ManagedDriver {
  const registry = new Set<{ close(): void }>();
  const lifecycle: DriverLifecycle = { stopping: false };
  return {
    kind: "claude",
    startConversation: (setup: ConversationSetup) => new ClaudeConversation(setup, opts, registry, lifecycle),
    async runOnce<T>(setup: OneShotSetup<T>): Promise<OneShotResult<T>> {
      try {
        return await runOnceAttempt(setup, opts, setup.output?.jsonSchema ?? null, registry, lifecycle);
      } catch (err) {
        const fallback = setup.output?.fallbackJsonSchema;
        if (fallback && err instanceof DriverError && /json.?schema/i.test(err.detail)) {
          opts.log.warn(`Structured output schema refused for ${setup.role}; retrying with the conservative schema`);
          // The refused attempt may have spent tokens, so its stats join the retry's single ledger row.
          const first = failureStats(err);
          try {
            const res = await runOnceAttempt(setup, opts, fallback, registry, lifecycle);
            return first ? { ...res, stats: addStats(first, res.stats) } : res;
          } catch (retryErr) {
            const second = failureStats(retryErr);
            const spent = first && second ? addStats(first, second) : (second ?? first);
            if (spent && typeof retryErr === "object" && retryErr) attachFailureStats(retryErr, spent);
            throw retryErr;
          }
        }
        throw err;
      }
    },
    markStopping() {
      lifecycle.stopping = true;
    },
    closeAll() {
      lifecycle.stopping = true;
      for (const h of [...registry]) h.close();
    },
  };
}
