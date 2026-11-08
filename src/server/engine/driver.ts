import { z } from "zod";
import type { Mode, PhaseDef, Track } from "../../shared/phases";
import type { Problem } from "../../shared/problem";
import type { PinTarget } from "../../shared/graph/frames";
import type { ChecklistItem, Effort, ModelId, Scorecard, Session } from "../../shared/types";
import type { CheckpointKind } from "./clock";
import type { TesterOutput } from "./schemas";

export type RoleName = "interviewer" | "guide" | "tester" | "judge" | "coach" | "scribe" | "brief-writer" | "brief-checker" | "checker" | "grader";

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" };

export interface ToolOutput {
  content: ToolContent[];
  isError?: boolean;
}

/** A tool as the engine defines it. The Claude driver exposes it over in-process MCP; the fake driver calls run(). */
export interface RoomTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  /** Validates its own input, so both drivers get the same checks. */
  run(args: unknown): Promise<ToolOutput>;
}

export function defineTool<S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolOutput>): RoomTool {
  const schema = z.strictObject(shape);
  return {
    name,
    description,
    shape,
    async run(args: unknown) {
      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
        return { content: [{ type: "text", text: `Invalid input: ${issues}` }], isError: true };
      }
      try {
        return await handler(parsed.data as z.infer<z.ZodObject<S>>);
      } catch {
        return { content: [{ type: "text", text: "The tool failed. Carry on without it." }], isError: true };
      }
    },
  };
}

export function textOutput(text: string, isError = false): ToolOutput {
  return isError ? { content: [{ type: "text", text }], isError } : { content: [{ type: "text", text }] };
}

/** What a turn is, in structured form. The Claude driver ignores it; the fake driver answers from it. */
export interface TurnMeta {
  kind: "start" | "candidate" | "clock" | "request" | "replay" | "oneshot";
  checkpoint?: CheckpointKind;
  request?: "feedback" | "hint" | "stuck" | "coach_open";
  candidateText?: string;
}

export interface UserTurn {
  text: string;
  images?: { data: string; mimeType: "image/png" }[];
  meta: TurnMeta;
}

export interface TurnHandlers {
  onTextDelta(delta: string): void;
}

export interface TurnStats {
  durationMs: number;
  costUsd: number | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  model?: string;
}

export interface TurnReply {
  text: string;
  stats: TurnStats;
}

export interface Conversation {
  /** The SDK session id once known, for resume after a failure or restart. */
  sdkSessionId(): string | null;
  /** One turn. Callers send turns one at a time. */
  send(turn: UserTurn, handlers: TurnHandlers): Promise<TurnReply>;
  close(): void;
}

/** Facts the fake driver needs to answer like a model would. The Claude driver never reads them. */
export interface FakeFacts {
  problem?: Problem;
  phases?: readonly PhaseDef[];
  track?: Track;
  mode?: Mode;
  session?: () => Readonly<Session>;
  candidateLines?: string[];
  dimensionIds?: string[];
  tester?: TesterOutput | null;
  scorecard?: Scorecard | null;
  notesFileExists?: boolean;
  date?: string;
  exampleProblem?: Problem;
  checkItems?: readonly ChecklistItem[];
  frameText?: string;
  codeText?: string;
  imageAttached?: boolean;
  pinTargets?: () => PinTarget[];
  /** The grader's input: the drill's answer key and the candidate's answer. */
  drill?: { key: string; answer: string };
}

export interface UsageContext {
  sessionId?: string | null;
  problemId?: string | null;
  track?: Track | null;
  mode?: Mode | null;
}

export interface RoleSetup {
  role: RoleName;
  model: ModelId;
  effort: Effort;
  /** Rendered only when a real model starts, so the fake driver never needs the prompt files. */
  systemPrompt: () => Promise<string>;
  tools: RoomTool[];
  fake: FakeFacts;
  usage?: UsageContext;
  onToolUse?: (name: string, input: unknown) => void;
}

export interface ConversationSetup extends RoleSetup {
  resumeSessionId: string | null;
}

export interface StructuredOutputSpec<T> {
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  /** A more conservative JSON Schema to try once if the strict one is refused. */
  fallbackJsonSchema?: Record<string, unknown>;
}

export interface OneShotSetup<T> extends RoleSetup {
  turn: UserTurn;
  output: StructuredOutputSpec<T> | null;
  maxTurns: number;
  signal?: AbortSignal;
}

export interface OneShotResult<T> {
  text: string;
  output: T | null;
  stats: TurnStats;
}

export interface Driver {
  readonly kind: "claude" | "fake";
  startConversation(setup: ConversationSetup): Conversation;
  runOnce<T>(setup: OneShotSetup<T>): Promise<OneShotResult<T>>;
}

/** A failure the user can act on. The message is plain and safe to show. */
export class DriverError extends Error {
  override name = "DriverError";
  constructor(
    message: string,
    readonly detail: string = message,
  ) {
    super(message);
  }
}
