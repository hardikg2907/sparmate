import type { ServerMsg } from "../../shared/protocol";
import type { BoardSnapshot, CodeSnapshot, SocketStatus } from "../backend";
import type { Channel, PublicSession, RunResult, TranscriptEntry } from "../../shared/types";
import { splitGraphText } from "../lib/graphText";
import { clockOffset, roundMsAt } from "../lib/timing";
import type { ChatItem, CodeState, PendingMessage, SessionState } from "./types";

const SILENT = "<silent/>";

export const initialState: SessionState = {
  session: null,
  loadError: null,
  loadMissing: false,
  clockOffsetMs: 0,
  connection: "connecting",
  streams: {},
  pending: [],
  agent: { interview: { state: "idle", error: null }, coach: { state: "idle", error: null } },
  graph: { version: null, text: "", warnings: [] },
  board: null,
  code: null,
  debrief: { stage: null, detail: null },
  notes: { proposal: null, drafting: false, applying: false, result: null },
  notice: null,
  error: null,
  discarded: false,
};

export type Action =
  | { type: "reset" }
  | { type: "loaded"; session: PublicSession; board: BoardSnapshot | null; code: CodeSnapshot | null; now: number }
  | { type: "load-failed"; message: string; missing?: boolean }
  | { type: "connection"; status: SocketStatus }
  /** `fresh` marks the first state after a (re)connect, when partial streams are no longer trustworthy. */
  | { type: "server"; msg: ServerMsg; now: number; fresh: boolean }
  | { type: "pending-add"; message: PendingMessage }
  | { type: "pending-drop"; clientMsgId: string }
  | { type: "code-edit"; content: string; version: number }
  | { type: "code-synced"; code: CodeSnapshot }
  | { type: "board-synced"; board: BoardSnapshot }
  | { type: "run-start" }
  | { type: "run-stop" }
  | { type: "notes-drafting" }
  | { type: "notes-applying" }
  | { type: "notes-reset" }
  | { type: "graph-refreshed"; board: PublicSession["board"] }
  | { type: "phase-local"; phase: string; now: number }
  | { type: "notice"; message: string | null }
  | { type: "dismiss-error" }
  | { type: "debrief-retry" };

function upsertEntry(transcript: TranscriptEntry[], entry: TranscriptEntry): TranscriptEntry[] {
  const at = transcript.findIndex((e) => e.id === entry.id);
  if (at === -1) return [...transcript, entry];
  const next = transcript.slice();
  next[at] = entry;
  return next;
}

function newerRun(current: RunResult | null, incoming: RunResult | null | undefined): RunResult | null {
  if (!incoming) return current;
  if (!current) return incoming;
  return incoming.at > current.at ? incoming : current;
}

function graphFromBoard(board: PublicSession["board"]) {
  return { version: board.version, text: board.graphText, warnings: splitGraphText(board.graphText).warnings };
}

/**
 * Drops local copies once the server transcript holds them. Each entry stands for one message only, and an
 * entry the page already had is the echo of an earlier message, so two identical texts need two new entries.
 */
function reconcilePending(pending: PendingMessage[], transcript: TranscriptEntry[], known: TranscriptEntry[]): PendingMessage[] {
  const used = new Set(known.map((e) => e.id));
  const kept: PendingMessage[] = [];
  for (const p of pending) {
    const match = transcript.find((e) => !used.has(e.id) && e.role === "candidate" && e.channel === p.channel && e.text.trim() === p.text && Date.parse(e.wall) >= p.sentAt - 5000);
    if (match) used.add(match.id);
    else kept.push(p);
  }
  return kept;
}

function withoutStreams(streams: SessionState["streams"], transcript: TranscriptEntry[]): SessionState["streams"] {
  const done = new Set(transcript.map((e) => e.id));
  const next: SessionState["streams"] = {};
  for (const [id, buffer] of Object.entries(streams)) if (!done.has(id)) next[id] = buffer;
  return next;
}

function applyServer(state: SessionState, msg: ServerMsg, now: number, fresh: boolean): SessionState {
  switch (msg.type) {
    case "session.state": {
      const session = msg.session;
      let pending = state.pending;
      let notice = state.notice;
      if (pending.length > 0) {
        const kept = reconcilePending(pending, session.transcript, state.session?.transcript ?? []);
        // The state that opens a connection is taken before the server reads anything sent on it, so only
        // messages sent on the closed connection can be known lost.
        const lost = fresh ? kept.filter((p) => p.carried).length : 0;
        if (lost > 0) notice = lost === 1 ? "A message did not send. Please send it again." : "Some messages did not send. Please send them again.";
        pending = fresh ? kept.filter((p) => !p.carried) : kept;
      }
      const streams = fresh ? {} : withoutStreams(state.streams, session.transcript);
      const useBoard = state.graph.version === null || session.board.version >= state.graph.version;
      let code: CodeState | null = null;
      if (state.code) {
        const lastRun = newerRun(state.code.lastRun, session.code?.lastRun);
        // A newer run than the page knows means the one it waits for has finished, even if its result was lost.
        const running = state.code.running && lastRun === state.code.lastRun;
        code = { ...state.code, path: session.code?.path ?? state.code.path, lastRun, running };
      }
      const debrief = session.status === "debriefed" ? { stage: "done" as const, detail: null } : state.debrief;
      return {
        ...state,
        session,
        clockOffsetMs: clockOffset(session.clock, now),
        streams,
        pending,
        notice,
        // An error shown before a drop (a rejected token, say) is stale once the connection is back.
        error: fresh ? null : state.error,
        // The server repeats only a busy or failed channel after this state, so whatever is not repeated is idle.
        agent: fresh ? initialState.agent : state.agent,
        code,
        debrief,
        graph: useBoard ? graphFromBoard(session.board) : state.graph,
      };
    }

    case "chat.delta": {
      const done = state.session?.transcript.some((e) => e.id === msg.messageId);
      if (done) return state;
      const existing = state.streams[msg.messageId];
      return {
        ...state,
        streams: { ...state.streams, [msg.messageId]: { channel: msg.channel, text: (existing?.text ?? "") + msg.textDelta } },
      };
    }

    case "chat.message": {
      if (!state.session) return state;
      const transcript = upsertEntry(state.session.transcript, msg.entry);
      const streams = { ...state.streams };
      delete streams[msg.entry.id];
      const pending = msg.clientMsgId ? state.pending.filter((p) => p.clientMsgId !== msg.clientMsgId) : state.pending;
      return { ...state, session: { ...state.session, transcript }, streams, pending };
    }

    case "agent.status":
      return { ...state, agent: { ...state.agent, [msg.channel]: { state: msg.state, error: msg.error ?? null } } };

    case "phase.changed": {
      const session = state.session;
      if (!session) return state;
      const last = session.phaseHistory[session.phaseHistory.length - 1];
      const phaseHistory =
        last?.phase === msg.phase ? session.phaseHistory : [...session.phaseHistory, { phase: msg.phase, at: roundMsAt(session.clock, now + state.clockOffsetMs), by: msg.by }];
      return { ...state, session: { ...session, phase: msg.phase, phaseHistory } };
    }

    case "notes.changed":
      // The page shows no written step text during a round; the session copy is enough for the debrief.
      return state;

    case "board.graph":
      return { ...state, graph: { version: msg.version, text: msg.graphText, warnings: msg.warnings } };

    case "code.external": {
      if (!state.code) return state;
      return { ...state, code: { ...state.code, content: msg.content, version: msg.version } };
    }

    case "code.rejected":
      // The session hook settles the editor against the server's text; nothing in the page state changes.
      return state;

    case "code.diagnostics": {
      if (!state.code || msg.version < state.code.diagnosticsVersion) return state;
      return { ...state, code: { ...state.code, diagnostics: msg.diagnostics, diagnosticsVersion: msg.version } };
    }

    case "code.run.result": {
      if (!state.code) return state;
      return { ...state, code: { ...state.code, lastRun: msg.result, running: false } };
    }

    case "debrief.progress":
      return { ...state, debrief: { stage: msg.stage, detail: msg.detail ?? null } };

    case "debrief.ready": {
      if (!state.session) return state;
      return { ...state, session: { ...state.session, scorecard: msg.scorecard }, debrief: { stage: "done", detail: null } };
    }

    case "bookkeeping.proposal": {
      // After a save the server sends the same proposal again with its new status; the result of the
      // save belongs to it, so only a different proposal starts clean.
      const same = state.notes.proposal?.id === msg.proposal.id;
      return { ...state, notes: { proposal: msg.proposal, drafting: false, applying: false, result: same ? state.notes.result : null } };
    }

    case "bookkeeping.applied": {
      const proposal = state.notes.proposal;
      const result = { proposalId: msg.proposalId, applied: msg.applied, failed: msg.failed };
      let next = proposal;
      if (proposal && proposal.id === msg.proposalId) {
        const stale = msg.applied.length === 0 && msg.failed.some((f) => /stale|changed since/i.test(f.reason));
        if (stale) next = { ...proposal, status: "stale" };
        else if (msg.failed.length === 0 && msg.applied.length > 0) next = { ...proposal, status: "applied" };
      }
      return { ...state, notes: { ...state.notes, proposal: next, applying: false, result } };
    }

    case "error":
      return {
        ...state,
        error: msg.message || "Something went wrong.",
        notes: { ...state.notes, drafting: false, applying: false },
        code: state.code ? { ...state.code, running: false } : state.code,
      };

    case "board.png.request":
      return state;

    case "session.discarded":
      return { ...state, discarded: true };
  }
}

export function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case "reset":
      return initialState;

    case "loaded": {
      const { session, board, code, now } = action;
      return {
        ...initialState,
        session,
        clockOffsetMs: clockOffset(session.clock, now),
        board,
        graph: graphFromBoard(session.board),
        code: code
          ? {
              path: code.path,
              content: code.content,
              version: code.version,
              diagnostics: [],
              diagnosticsVersion: -1,
              lastRun: session.code?.lastRun ?? null,
              running: false,
            }
          : null,
        debrief: session.status === "debriefed" ? { stage: "done", detail: null } : initialState.debrief,
        connection: state.connection,
      };
    }

    case "load-failed":
      return { ...state, loadError: action.message, loadMissing: action.missing === true };

    case "connection":
      // What is still pending when a connection opens went out on the one before it.
      return {
        ...state,
        connection: action.status,
        pending: action.status === "open" && state.pending.length > 0 ? state.pending.map((p) => (p.carried ? p : { ...p, carried: true })) : state.pending,
      };

    case "server":
      return applyServer(state, action.msg, action.now, action.fresh);

    case "pending-add":
      return { ...state, pending: [...state.pending, action.message] };

    case "pending-drop":
      return { ...state, pending: state.pending.filter((p) => p.clientMsgId !== action.clientMsgId) };

    case "code-edit":
      return state.code ? { ...state, code: { ...state.code, content: action.content, version: action.version } } : state;

    case "board-synced":
      return { ...state, board: action.board };

    case "code-synced":
      return state.code ? { ...state, code: { ...state.code, content: action.code.content, version: action.code.version, path: action.code.path } } : state;

    case "run-start":
      return state.code ? { ...state, code: { ...state.code, running: true } } : state;

    case "run-stop":
      return state.code ? { ...state, code: { ...state.code, running: false } } : state;

    case "notes-drafting":
      return { ...state, notes: { proposal: null, drafting: true, applying: false, result: null } };

    case "notes-applying":
      return { ...state, notes: { ...state.notes, applying: true } };

    case "notes-reset":
      return { ...state, notes: { ...state.notes, drafting: false, applying: false } };

    case "graph-refreshed":
      return state.graph.version !== null && action.board.version < state.graph.version ? state : { ...state, graph: graphFromBoard(action.board) };

    case "phase-local": {
      const session = state.session;
      if (!session || session.phase === action.phase) return state;
      return {
        ...state,
        session: {
          ...session,
          phase: action.phase,
          phaseHistory: [...session.phaseHistory, { phase: action.phase, at: roundMsAt(session.clock, action.now + state.clockOffsetMs), by: "candidate" }],
        },
      };
    }

    case "notice":
      return { ...state, notice: action.message };

    case "dismiss-error":
      return { ...state, error: null };

    case "debrief-retry":
      return { ...state, debrief: { stage: null, detail: null } };
  }
}

// ---------------------------------------------------------------------------
// Selectors

/** A reply that is only `<silent/>` is never shown, even for the instant before the final message replaces it. */
export function visibleStreamText(raw: string): string {
  const text = raw.split(SILENT).join("").trimStart();
  if (text === "" || SILENT.startsWith(text.trimEnd())) return "";
  return text;
}

export function chatItems(state: Pick<SessionState, "session" | "pending" | "streams">, channel: Channel): ChatItem[] {
  const items: ChatItem[] = [];
  for (const entry of state.session?.transcript ?? []) {
    if (entry.channel !== channel || entry.hidden) continue;
    items.push({
      id: entry.id,
      role: entry.role,
      text: entry.text,
      ...(entry.blocks?.length ? { blocks: entry.blocks } : {}),
      at: entry.at,
      kind: entry.kind,
      state: "done",
    });
  }
  for (const pending of state.pending) {
    if (pending.channel === channel) {
      items.push({ id: `pending-${pending.clientMsgId}`, role: "candidate", text: pending.text, at: null, state: "pending" });
    }
  }
  for (const [id, buffer] of Object.entries(state.streams)) {
    if (buffer.channel !== channel) continue;
    const text = visibleStreamText(buffer.text);
    if (text) items.push({ id, role: channel === "coach" ? "coach" : "interviewer", text, at: null, state: "streaming" });
  }
  return items;
}
