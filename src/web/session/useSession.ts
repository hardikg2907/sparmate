import { useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from "react";
import { ApiError, type SocketLike } from "../backend";
import type { BoardHandle } from "../board/Board";
import type { ClientMsg, ServerMsg } from "../../shared/protocol";
import type { Channel, PublicSession } from "../../shared/types";
import { CHAT_MAX_CHARS, PNG_MAX_BASE64 } from "../lib/contract";
import { chatItems, initialState, reducer } from "./reducer";
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
const NOT_CONNECTED = "Not connected yet. Try again in a moment.";

type Timer = ReturnType<typeof setTimeout>;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Everything the socket handlers and actions share but that must not cause a render when it changes. */
interface Io {
  codeVersion: number;
  codeTimer: Timer | null;
  pendingCode: string | null;
  boardVersion: number;
  pendingBoard: { version: number; elements: readonly Record<string, unknown>[] } | null;
  /** The last scene the board reported, so the debrief that follows in this page shows the final board. */
  latestBoard: { version: number; elements: readonly Record<string, unknown>[] } | null;
  fresh: boolean;
  runTimer: Timer | null;
  notesTimer: Timer | null;
  boardListeners: Set<() => void>;
}

function flushCode(io: Io, socketRef: MutableRefObject<SocketLike | null>): void {
  if (io.codeTimer) clearTimeout(io.codeTimer);
  io.codeTimer = null;
  if (io.pendingCode === null) return;
  const sent = socketRef.current?.send({ type: "code.update", version: io.codeVersion, content: io.pendingCode }) ?? false;
  if (sent) io.pendingCode = null;
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
      codeVersion: 0,
      codeTimer: null,
      pendingCode: null,
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
        io.codeVersion = data.code?.version ?? 0;
        io.boardVersion = data.board?.version ?? 0;
        io.pendingCode = null;
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
      const reply = (pngBase64: string | null, error: string | null) =>
        socket.send({ type: "board.png.result", requestId, pngBase64, error });
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
      if (io.pendingCode !== null) {
        flushCode(io, socketRef);
      } else if (session.code && session.code.version > io.codeVersion) {
        source.fetchCode().then(
          (code) => {
            if (io.pendingCode !== null) return;
            io.codeVersion = code.version;
            dispatch({ type: "code-synced", code });
          },
          () => {},
        );
      }
    };

    const onServer = (msg: ServerMsg) => {
      const fresh = io.fresh && msg.type === "session.state";
      if (fresh) io.fresh = false;
      dispatch({ type: "server", msg, now: Date.now(), fresh });
      switch (msg.type) {
        case "board.png.request":
          answerPng(msg.requestId, msg.frameId);
          break;
        case "code.external":
          // The editor is about to be replaced, so an unsent edit would overwrite the outside change.
          if (io.codeTimer) clearTimeout(io.codeTimer);
          io.codeTimer = null;
          io.pendingCode = null;
          io.codeVersion = msg.version;
          break;
        case "session.state":
          if (fresh) afterReconnect(msg.session);
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
      flushCode(io, socketRef);
      for (const off of offs) off();
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
      if (io.runTimer) clearTimeout(io.runTimer);
      if (io.notesTimer) clearTimeout(io.notesTimer);
      io.runTimer = io.notesTimer = null;
      io.fresh = false;
    };
  }, [source, loaded, io]);

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
      flushCode(io, socketRef);
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
        flush();
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
        flush();
        send({ type: "session.discard" });
      },
      guidedFeedback() {
        send({ type: "guided.feedback" });
      },
      guidedHint() {
        send({ type: "guided.hint" });
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
        io.codeVersion += 1;
        io.pendingCode = content;
        dispatch({ type: "code-edit", content, version: io.codeVersion });
        if (io.codeTimer) clearTimeout(io.codeTimer);
        io.codeTimer = setTimeout(flush, CODE_DEBOUNCE_MS);
      },

      runCode() {
        if (stateRef.current.code?.running) return;
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
