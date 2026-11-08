import { useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from "react";
import { ApiError, type SocketLike } from "../backend";
import type { BoardHandle } from "../board/Board";
import type { ClientMsg, ServerMsg } from "../../shared/protocol";
import type { Channel, PublicSession } from "../../shared/types";
import { CHAT_MAX_CHARS, PNG_MAX_BASE64 } from "../lib/contract";
import { roundMsAt } from "../lib/timing";
import {
  confirmVersion,
  decideAfterReconnect,
  decideOnExternal,
  decideOnRejected,
  editLedger,
  recordSent,
  settleLedger,
  startLedger,
  type CodeDecision,
  type CodeLedger,
  type CodeText,
} from "./codeSync";
import { chatItems, initialState, reducer, type Action } from "./reducer";
import type { SessionActions, SessionController, SessionSource } from "./types";

const SERVER_TYPES = [
  "session.state",
  "chat.delta",
  "chat.message",
  "agent.status",
  "phase.changed",
  "board.png.request",
  "board.graph",
  "code.external",
  "code.rejected",
  "code.diagnostics",
  "code.run.result",
  "debrief.progress",
  "debrief.ready",
  "bookkeeping.proposal",
  "bookkeeping.applied",
  "session.discarded",
  "error",
] as const satisfies readonly ServerMsg["type"][];

const CODE_DEBOUNCE_MS = 500;
const RUN_GUARD_MS = 60_000;
const NOTES_GUARD_MS = 240_000;
// The server ends the round on its own clock, so the last work goes out a moment before the page's reaches zero.
const TIME_UP_LEAD_MS = 1000;
const NOT_CONNECTED = "Not connected yet. Try again in a moment.";
const CODE_CHECKING = "Saving your code first. Try again in a moment.";

type Timer = ReturnType<typeof setTimeout>;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Everything the socket handlers and actions share but that must not cause a render when it changes. */
interface Io {
  /** Null on a round without a code file. */
  code: CodeLedger | null;
  codeTimer: Timer | null;
  /** After a reconnect the server's file is unknown until fetched, and no update may go out before that. */
  codeStale: boolean;
  codeChecking: boolean;
  /** Numbers each check, so a slow fetch cannot settle the code after a newer one started. */
  codeCheck: number;
  /** The highest code version the server has reported, for a last save that cannot wait for the check. */
  codeServerVersion: number;
  boardVersion: number;
  pendingBoard: { version: number; elements: readonly Record<string, unknown>[] } | null;
  /** The last scene the board reported, so the debrief that follows in this page shows the final board. */
  latestBoard: { version: number; elements: readonly Record<string, unknown>[] } | null;
  fresh: boolean;
  runTimer: Timer | null;
  notesTimer: Timer | null;
  boardListeners: Set<() => void>;
}

/** With `force`, a save that cannot wait for the check goes out above every version the server has reported. */
function flushCode(io: Io, socketRef: MutableRefObject<SocketLike | null>, force = false): void {
  if (io.codeTimer) clearTimeout(io.codeTimer);
  io.codeTimer = null;
  const ledger = io.code;
  if (!ledger?.unsent || (io.codeStale && !force)) return;
  const editor = force && io.codeStale ? { ...ledger.editor, version: Math.max(ledger.editor.version, io.codeServerVersion + 1) } : ledger.editor;
  const sent = socketRef.current?.send({ type: "code.update", version: editor.version, content: editor.content }) ?? false;
  if (sent) io.code = recordSent({ ...ledger, editor });
}

/**
 * Settles the ledger on a code decision and sends an editor text that wins. The caller shows the server's text on
 * "take", since a reconnect and a live outside change carry it in different messages.
 */
function applyCodeDecision(io: Io, socketRef: MutableRefObject<SocketLike | null>, dispatch: (action: Action) => void, decision: CodeDecision, server: CodeText): void {
  if (!io.code) return;
  io.code = settleLedger(io.code, decision, server);
  if (decision.kind === "take") {
    if (io.codeTimer) clearTimeout(io.codeTimer);
    io.codeTimer = null;
    return;
  }
  if (decision.kind !== "keep") dispatch({ type: "code-edit", content: io.code.editor.content, version: io.code.editor.version });
  if (decision.kind === "send") flushCode(io, socketRef);
  if (decision.kind !== "same" && decision.notice) dispatch({ type: "notice", message: decision.notice });
}

/**
 * Fetches the server's file and settles it against the editor; until then no code update goes out. A reconnect
 * restarts a check in flight, since the server may have moved on; an edit or a run only starts one when none runs.
 */
function checkCode(io: Io, source: SessionSource, socketRef: MutableRefObject<SocketLike | null>, dispatch: (action: Action) => void, restart: boolean): void {
  if (io.codeChecking && !restart) return;
  const check = ++io.codeCheck;
  io.codeStale = true;
  io.codeChecking = true;
  if (io.codeTimer) clearTimeout(io.codeTimer);
  io.codeTimer = null;
  source.fetchCode().then(
    (code) => {
      if (check !== io.codeCheck || !io.code) return;
      io.codeStale = io.codeChecking = false;
      io.codeServerVersion = Math.max(io.codeServerVersion, code.version);
      const decision = decideAfterReconnect(io.code, code);
      applyCodeDecision(io, socketRef, dispatch, decision, code);
      if (decision.kind === "take") dispatch({ type: "code-synced", code });
    },
    () => {
      // Still stale, so the next edit, run or reconnect checks again.
      if (check === io.codeCheck) io.codeChecking = false;
    },
  );
}

/** Sends the board and code changes still held back by the throttle and the debounce. */
function flushWork(io: Io, socketRef: MutableRefObject<SocketLike | null>, boardRef: MutableRefObject<BoardHandle | null>): void {
  boardRef.current?.flush();
  flushCode(io, socketRef, true);
}

export function useSessionController(source: SessionSource): SessionController {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [attempt, setAttempt] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const boardRef = useRef<BoardHandle | null>(null);
  const socketRef = useRef<SocketLike | null>(null);
  const ioRef = useRef<Io | null>(null);
  if (!ioRef.current) {
    ioRef.current = {
      code: null,
      codeTimer: null,
      codeStale: false,
      codeChecking: false,
      codeCheck: 0,
      codeServerVersion: 0,
      boardVersion: 0,
      pendingBoard: null,
      latestBoard: null,
      fresh: false,
      runTimer: null,
      notesTimer: null,
      boardListeners: new Set(),
    };
  }
  const io = ioRef.current;
  const loaded = state.session !== null;

  // Load the first copy over REST so the page can render, and so an unknown id fails fast.
  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "reset" });
    source.load().then(
      (data) => {
        if (cancelled) return;
        io.code = data.code ? startLedger({ version: data.code.version, content: data.code.content }) : null;
        io.codeStale = io.codeChecking = false;
        io.codeCheck += 1;
        io.codeServerVersion = data.code?.version ?? 0;
        io.boardVersion = data.board?.version ?? 0;
        io.pendingBoard = null;
        io.latestBoard = null;
        dispatch({ type: "loaded", ...data, now: Date.now() });
      },
      (error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof ApiError && error.status === 404
            ? "This session was not found."
            : error instanceof ApiError && error.message
              ? error.message
              : "The session could not be loaded.";
        dispatch({ type: "load-failed", message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, attempt, io]);

  // The socket opens once the first copy is in, and closes with the page.
  useEffect(() => {
    if (!loaded) return;
    const socket = source.createSocket();
    socketRef.current = socket;

    const answerPng = (requestId: string, frameId?: string) => {
      const reply = (pngBase64: string | null, error: string | null) => socket.send({ type: "board.png.result", requestId, pngBase64, error });
      const handle = boardRef.current;
      if (!handle) {
        reply(null, "The board is not open in this page.");
        return;
      }
      handle.exportPng(frameId).then(
        (png) => (png.length > PNG_MAX_BASE64 ? reply(null, "The board image is too large.") : reply(png, null)),
        () => reply(null, "The board image could not be created."),
      );
    };

    const afterReconnect = (session: PublicSession) => {
      // Send what the dropped connection swallowed, then pick up any file change made while away.
      if (io.pendingBoard && socket.send({ type: "board.update", version: io.pendingBoard.version, elements: Array.from(io.pendingBoard.elements) })) {
        io.pendingBoard = null;
      }
      if (!io.code || !session.code) return;
      io.codeServerVersion = Math.max(io.codeServerVersion, session.code.version);
      // An update in flight at the drop may be lost, and the file may have changed while away.
      if (io.code.unsent || io.code.sent.length > 0 || io.codeStale || session.code.version !== io.code.base.version) {
        checkCode(io, source, socketRef, dispatch, true);
      }
    };

    const onExternal = (msg: Extract<ServerMsg, { type: "code.external" }>) => {
      io.codeServerVersion = Math.max(io.codeServerVersion, msg.version);
      if (!io.code) {
        dispatch({ type: "server", msg, now: Date.now(), fresh: false });
        return;
      }
      const decision = decideOnExternal(io.code, msg);
      applyCodeDecision(io, socketRef, dispatch, decision, msg);
      if (decision.kind === "take") dispatch({ type: "server", msg, now: Date.now(), fresh: false });
    };

    const onRejected = (msg: Extract<ServerMsg, { type: "code.rejected" }>) => {
      io.codeServerVersion = Math.max(io.codeServerVersion, msg.held);
      if (!io.code) return;
      if (decideOnRejected(io.code, msg.held).kind === "check") checkCode(io, source, socketRef, dispatch, true);
    };

    const onServer = (msg: ServerMsg) => {
      if (msg.type === "code.external") {
        onExternal(msg);
        return;
      }
      if (msg.type === "code.rejected") {
        onRejected(msg);
        return;
      }
      const fresh = io.fresh && msg.type === "session.state";
      if (fresh) io.fresh = false;
      dispatch({ type: "server", msg, now: Date.now(), fresh });
      switch (msg.type) {
        case "board.png.request":
          answerPng(msg.requestId, msg.frameId);
          break;
        case "code.diagnostics":
          if (io.code) io.code = confirmVersion(io.code, msg.version);
          break;
        case "session.state":
          if (fresh) afterReconnect(msg.session);
          // A round that ended on time still takes the work of its last moments for a short while.
          if (msg.session.status === "ended") flushWork(io, socketRef, boardRef);
          if (io.latestBoard && !["live", "paused", "ended"].includes(msg.session.status)) {
            dispatch({ type: "board-synced", board: { version: io.latestBoard.version, elements: [...io.latestBoard.elements] } });
            io.latestBoard = null;
          }
          break;
        case "code.run.result":
          if (io.runTimer) clearTimeout(io.runTimer);
          io.runTimer = null;
          break;
        case "bookkeeping.proposal":
        case "bookkeeping.applied":
          if (io.notesTimer) clearTimeout(io.notesTimer);
          io.notesTimer = null;
          break;
        default:
          break;
      }
    };

    const offs: (() => void)[] = [
      socket.onStatus((status) => {
        dispatch({ type: "connection", status });
        if (status === "open") io.fresh = true;
      }),
    ];
    for (const type of SERVER_TYPES) offs.push(socket.on(type, (msg) => onServer(msg as ServerMsg)));
    socket.connect();

    return () => {
      flushCode(io, socketRef, true);
      for (const off of offs) off();
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
      if (io.runTimer) clearTimeout(io.runTimer);
      if (io.notesTimer) clearTimeout(io.notesTimer);
      io.runTimer = io.notesTimer = null;
      io.fresh = false;
    };
  }, [source, loaded, io]);

  const timedSession = state.session?.status === "live" && state.session.mode === "interview" ? state.session : null;
  const timedClock = timedSession?.clock;
  const clockOffsetMs = state.clockOffsetMs;
  useEffect(() => {
    if (!timedClock) return;
    const remaining = timedClock.durationMs - roundMsAt(timedClock, Date.now() + clockOffsetMs);
    const timer = setTimeout(() => flushWork(io, socketRef, boardRef), Math.max(0, remaining - TIME_UP_LEAD_MS));
    return () => clearTimeout(timer);
  }, [timedClock, clockOffsetMs, io]);

  useEffect(() => {
    if (!state.notice) return;
    const timer = setTimeout(() => dispatch({ type: "notice", message: null }), 6000);
    return () => clearTimeout(timer);
  }, [state.notice]);

  const actions = useMemo<SessionActions>(() => {
    const send = (msg: ClientMsg): boolean => {
      const sent = socketRef.current?.send(msg) ?? false;
      if (!sent) dispatch({ type: "notice", message: NOT_CONNECTED });
      return sent;
    };

    const flush = () => {
      if (io.codeStale && io.code?.unsent) checkCode(io, source, socketRef, dispatch, false);
      else flushCode(io, socketRef);
    };

    return {
      sendChat(channel: Channel, text: string) {
        const trimmed = text.trim();
        if (!trimmed) return false;
        if (trimmed.length > CHAT_MAX_CHARS) {
          dispatch({ type: "notice", message: "That message is too long to send." });
          return false;
        }
        const clientMsgId = newId();
        // The local copy goes in first so the server's echo always finds it, however fast it answers.
        dispatch({ type: "pending-add", message: { clientMsgId, channel, text: trimmed, sentAt: Date.now() } });
        if (send({ type: "chat.send", channel, clientMsgId, text: trimmed })) return true;
        dispatch({ type: "pending-drop", clientMsgId });
        return false;
      },

      setPhase(phase) {
        if (stateRef.current.session?.phase === phase) return;
        if (send({ type: "phase.set", phase })) dispatch({ type: "phase-local", phase, now: Date.now() });
      },

      end() {
        // The board and code are throttled, so the last seconds of work may not have been sent yet.
        const handle = boardRef.current;
        if (handle) {
          io.boardVersion += 1;
          const elements = Array.from(handle.getElements());
          io.latestBoard = { version: io.boardVersion, elements };
          socketRef.current?.send({ type: "board.update", version: io.boardVersion, elements });
        }
        flushCode(io, socketRef, true);
        send({ type: "session.end" });
      },

      pause() {
        send({ type: "session.pause" });
      },
      resume() {
        send({ type: "session.resume" });
      },
      discard() {
        // Code typed in the last moments may not have been sent; the server keeps an attempt file that has code.
        flushCode(io, socketRef, true);
        send({ type: "session.discard" });
      },
      guidedFeedback() {
        send({ type: "guided.feedback" });
      },
      guidedHint() {
        send({ type: "guided.hint" });
      },
      guidedStuck() {
        send({ type: "guided.stuck" });
      },

      onBoardChange(elements, version) {
        io.boardVersion = version;
        io.latestBoard = { version, elements };
        const sent = socketRef.current?.send({ type: "board.update", version, elements: Array.from(elements) }) ?? false;
        io.pendingBoard = sent ? null : { version, elements };
        for (const listener of [...io.boardListeners]) listener();
      },

      onBoardActivity(listener) {
        io.boardListeners.add(listener);
        return () => {
          io.boardListeners.delete(listener);
        };
      },

      refreshGraph() {
        source.fetchSession().then(
          (session) => dispatch({ type: "graph-refreshed", board: session.board }),
          () => {},
        );
      },

      editCode(content) {
        if (!io.code) return;
        io.code = editLedger(io.code, content);
        dispatch({ type: "code-edit", content, version: io.code.editor.version });
        if (io.codeTimer) clearTimeout(io.codeTimer);
        io.codeTimer = setTimeout(flush, CODE_DEBOUNCE_MS);
      },

      runCode() {
        if (stateRef.current.code?.running) return;
        if (io.codeStale) {
          // The program would compile whatever the server holds, which may not be the editor's text.
          checkCode(io, source, socketRef, dispatch, false);
          dispatch({ type: "notice", message: CODE_CHECKING });
          return;
        }
        flush();
        if (!send({ type: "code.run" })) return;
        dispatch({ type: "run-start" });
        if (io.runTimer) clearTimeout(io.runTimer);
        io.runTimer = setTimeout(() => dispatch({ type: "run-stop" }), RUN_GUARD_MS);
      },

      retryDebrief() {
        if (send({ type: "debrief.retry" })) dispatch({ type: "debrief-retry" });
      },

      draftNotes() {
        if (!send({ type: "bookkeeping.draft" })) return;
        dispatch({ type: "notes-drafting" });
        if (io.notesTimer) clearTimeout(io.notesTimer);
        io.notesTimer = setTimeout(() => {
          dispatch({ type: "notes-reset" });
          dispatch({ type: "notice", message: "Drafting took too long. Try again." });
        }, NOTES_GUARD_MS);
      },

      applyNotes(proposalId, opIds) {
        if (!send({ type: "bookkeeping.apply", proposalId, opIds })) return;
        dispatch({ type: "notes-applying" });
        if (io.notesTimer) clearTimeout(io.notesTimer);
        io.notesTimer = setTimeout(() => {
          dispatch({ type: "notes-reset" });
          dispatch({ type: "notice", message: "Saving took too long. Check the files before trying again." });
        }, NOTES_GUARD_MS);
      },

      reconnect() {
        socketRef.current?.connect();
      },

      dismissNotice() {
        dispatch({ type: "notice", message: null });
      },
      dismissError() {
        dispatch({ type: "dismiss-error" });
      },
    };
  }, [source, io]);

  const chat = useMemo(
    () => ({ interview: chatItems(state, "interview"), coach: chatItems(state, "coach") }),
    // chatItems reads only these three parts of the state.
    [state.session, state.pending, state.streams],
  );

  return { state, chat, actions, boardRef, reload: () => setAttempt((n) => n + 1) };
}
