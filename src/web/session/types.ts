import type { MutableRefObject } from "react";
import type { BoardHandle } from "../board/Board";
import type { BoardSnapshot, CodeSnapshot, SocketLike, SocketStatus } from "../backend";
import type {
  Channel,
  CompileDiagnostic,
  Proposal,
  PublicSession,
  Role,
  RunResult,
  TranscriptEntry,
} from "../../shared/types";

export type ProgressStage = "collecting" | "testing" | "judging" | "checking" | "done";

export interface AgentState {
  state: "idle" | "thinking" | "error";
  error: string | null;
}

export interface PendingMessage {
  clientMsgId: string;
  channel: Channel;
  text: string;
  sentAt: number;
  /** Sent on a connection that has since closed, so a fresh state without it means the server never got it. */
  carried?: boolean;
}

export interface StreamBuffer {
  channel: Channel;
  text: string;
}

export interface GraphState {
  version: number | null;
  text: string;
  warnings: string[];
}

export interface CodeState {
  path: string;
  content: string;
  version: number;
  diagnostics: CompileDiagnostic[];
  diagnosticsVersion: number;
  lastRun: RunResult | null;
  running: boolean;
}

export interface DebriefState {
  stage: ProgressStage | null;
  detail: string | null;
}

export interface NotesState {
  proposal: Proposal | null;
  drafting: boolean;
  applying: boolean;
  result: { proposalId: string; applied: string[]; failed: { opId: string; reason: string }[] } | null;
}

export interface SessionState {
  session: PublicSession | null;
  loadError: string | null;
  clockOffsetMs: number;
  connection: SocketStatus;
  streams: Record<string, StreamBuffer>;
  pending: PendingMessage[];
  agent: Record<Channel, AgentState>;
  graph: GraphState;
  board: BoardSnapshot | null;
  code: CodeState | null;
  debrief: DebriefState;
  notes: NotesState;
  notice: string | null;
  error: string | null;
  /** The server deleted this round; the page has nothing left to show. */
  discarded: boolean;
}

export interface ChatItem {
  id: string;
  role: Role;
  text: string;
  /** Round time in ms; null while the message is still local or streaming. */
  at: number | null;
  kind?: TranscriptEntry["kind"];
  state: "done" | "pending" | "streaming";
}

export interface LoadedSession {
  session: PublicSession;
  board: BoardSnapshot | null;
  code: CodeSnapshot | null;
}

/** Where a session page gets its data. The live source talks to the server; a fixture source does not. */
export interface SessionSource {
  id: string;
  load(): Promise<LoadedSession>;
  fetchSession(): Promise<PublicSession>;
  fetchCode(): Promise<CodeSnapshot>;
  createSocket(): SocketLike;
  /** Address of the final board image shown on the debrief. */
  boardImageUrl(): string;
}

export interface SessionActions {
  sendChat(channel: Channel, text: string): boolean;
  setPhase(phase: string): void;
  end(): void;
  pause(): void;
  resume(): void;
  discard(): void;
  guidedFeedback(): void;
  guidedHint(): void;
  onBoardChange(elements: readonly Record<string, unknown>[], version: number): void;
  onBoardActivity(listener: () => void): () => void;
  refreshGraph(): void;
  editCode(content: string): void;
  runCode(): void;
  retryDebrief(): void;
  draftNotes(): void;
  applyNotes(proposalId: string, opIds: string[]): void;
  reconnect(): void;
  dismissNotice(): void;
  dismissError(): void;
}

export interface SessionController {
  state: SessionState;
  chat: Record<Channel, ChatItem[]>;
  actions: SessionActions;
  boardRef: MutableRefObject<BoardHandle | null>;
  reload(): void;
}
