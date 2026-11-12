import { z } from "zod";
import type { CompileDiagnostic, Proposal, PublicSession, RunResult, Scorecard, TranscriptEntry } from "./types";

// One WebSocket per open session page: ws://<host>/ws/session/<sessionId>
// The first client message must be "hello" with the CSRF token from GET /api/bootstrap.
// The server closes the socket on a bad token, a bad Origin, an unknown session or an invalid message.

export const LIMITS = {
  chatChars: 8000,
  stepNoteChars: 8000,
  sceneBytes: 2_000_000,
  codeBytes: 200_000,
  pngBase64Bytes: 6_000_000,
  messagesPerSecond: 25,
  pinNoteChars: 200,
  proposalOps: 50,
} as const;

// ---------------------------------------------------------------------------
// Browser -> server

export const ClientMsgSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello"), token: z.string().min(16).max(200) }),
  z.strictObject({
    type: z.literal("chat.send"),
    channel: z.enum(["interview", "coach"]),
    clientMsgId: z.string().min(1).max(64),
    text: z.string().min(1).max(LIMITS.chatChars),
    fromOption: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal("board.update"),
    version: z.number().int().nonnegative(),
    /** Non-deleted Excalidraw elements, as returned by api.getSceneElements(). Validated loosely, size-capped. */
    elements: z.array(z.record(z.string(), z.unknown())).max(5000),
  }),
  z.strictObject({
    type: z.literal("board.png.result"),
    requestId: z.string().min(1).max(64),
    pngBase64: z.string().max(LIMITS.pngBase64Bytes).nullable(),
    error: z.string().max(500).nullable(),
  }),
  z.strictObject({
    type: z.literal("code.update"),
    version: z.number().int().nonnegative(),
    content: z.string().max(LIMITS.codeBytes),
  }),
  z.strictObject({
    type: z.literal("notes.update"),
    /** Must be a phase of the session's track; the server checks that. */
    phase: z.string().min(1).max(40),
    text: z.string().max(LIMITS.stepNoteChars),
    version: z.number().int().positive(),
  }),
  // The interview chat box changed (typed or dictated). The page throttles it; the server only notes that he is working.
  z.strictObject({ type: z.literal("chat.composing") }),
  z.strictObject({ type: z.literal("code.run") }),
  z.strictObject({ type: z.literal("phase.set"), phase: z.string().min(1).max(40) }),
  z.strictObject({ type: z.literal("guided.feedback") }), // guided mode: "check my current step"
  z.strictObject({ type: z.literal("guided.hint") }), // guided mode: "give me a nudge"
  z.strictObject({ type: z.literal("guided.stuck") }), // guided mode: "show me a model answer for this step"
  z.strictObject({ type: z.literal("session.pause") }), // either mode: the user steps away
  z.strictObject({ type: z.literal("session.discard") }), // delete the round without a debrief
  z.strictObject({ type: z.literal("session.resume") }), // guided mode, or retry after a backend error
  z.strictObject({ type: z.literal("session.end") }),
  z.strictObject({ type: z.literal("debrief.retry") }),
  z.strictObject({ type: z.literal("coach.open") }),
  z.strictObject({ type: z.literal("bookkeeping.draft") }),
  z.strictObject({
    type: z.literal("bookkeeping.apply"),
    proposalId: z.string().min(1).max(64),
    opIds: z.array(z.string().min(1).max(64)).max(LIMITS.proposalOps),
  }),
]);
export type ClientMsg = z.infer<typeof ClientMsgSchema>;

// ---------------------------------------------------------------------------
// Server -> browser

export type ServerMsg =
  | { type: "session.state"; session: PublicSession }
  | { type: "chat.delta"; channel: "interview" | "coach"; messageId: string; textDelta: string }
  | { type: "chat.message"; entry: TranscriptEntry; clientMsgId?: string }
  | { type: "agent.status"; channel: "interview" | "coach"; state: "idle" | "thinking" | "error"; error?: string }
  | { type: "phase.changed"; phase: string; by: "candidate" | "interviewer" }
  /** With `frameId`, only that frame of the board, cropped to its edges. */
  | { type: "board.png.request"; requestId: string; frameId?: string }
  | { type: "notes.changed"; phase: string; text: string; version: number }
  | { type: "board.graph"; version: number; graphText: string; warnings: string[] }
  | { type: "code.external"; version: number; content: string }
  /** The server dropped a `code.update` that was not newer than its text; `held` is the version it holds. */
  | { type: "code.rejected"; version: number; held: number }
  | { type: "code.diagnostics"; version: number; diagnostics: CompileDiagnostic[] }
  | { type: "code.run.result"; result: RunResult }
  | { type: "debrief.progress"; stage: "collecting" | "testing" | "judging" | "checking" | "done"; detail?: string }
  | { type: "debrief.ready"; scorecard: Scorecard }
  | { type: "bookkeeping.proposal"; proposal: Proposal }
  | { type: "bookkeeping.applied"; proposalId: string; applied: string[]; failed: { opId: string; reason: string }[] }
  | { type: "session.discarded" }
  | { type: "error"; code: string; message: string };

// ---------------------------------------------------------------------------
// REST (all JSON; every non-GET needs the header "x-csrf-token" and a same-origin Origin header)

export type SetupCheckId = "compiler" | "claude-login" | "kokoro";

/** One prerequisite of the app. `fix` is a command for the user to run; the app never runs it. */
export interface SetupCheck {
  id: SetupCheckId;
  ok: boolean;
  optional: boolean;
  title: string;
  detail: string;
  fix?: string;
}

export interface BootstrapResponse {
  csrfToken: string;
  version: string;
  studyRoot: string; // shown in settings so the user knows which folder bookkeeping writes to
  fakeAgent: boolean; // true when SPARMATE_FAKE_AGENT=1 (UI testing without model calls)
  setup: SetupCheck[]; // prerequisites, so the home page can say what is still missing
}

export const CreateSessionSchema = z.strictObject({
  problemId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,80}$/)
    .optional(),
  customPrompt: z.string().min(10).max(4000).optional(),
  customTrack: z.enum(["hld", "lld"]).optional(),
  mode: z.enum(["interview", "guided"]),
  /** A short guided round on one debrief gap. Needs problemId and mode "guided". */
  focus: z
    .strictObject({
      title: z.string().min(2).max(200),
      goodLooksLike: z.string().min(2).max(1500),
      /** The debriefed round the gap comes from, so a passed gap round can mark it there. */
      sourceSessionId: z.string().min(1).max(120).optional(),
    })
    .optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionSchema>;

export const PrepareCustomProblemSchema = z.strictObject({
  prompt: z.string().min(10).max(4000),
  track: z.enum(["hld", "lld"]),
});
export type PrepareCustomProblemRequest = z.infer<typeof PrepareCustomProblemSchema>;

export type CustomProblemStage = "researching" | "writing" | "checking" | "ready" | "failed" | "cancelled";

export interface CustomProblemJobStatus {
  id: string;
  stage: CustomProblemStage;
  searches: number;
  pages: number;
  error?: string;
  problemId?: string;
  title?: string;
  track?: "hld" | "lld";
  sourcesCount?: number;
  corrections?: { section: string; claim: string; fix: string; source: string }[];
  confidence?: string;
  costUsd?: number;
}
