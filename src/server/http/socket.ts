import type { FastifyInstance } from "fastify";
import { ClientMsgSchema, LIMITS, type ServerMsg } from "../../shared/protocol";
import { randomId } from "../engine/fsutil";
import type { Logger } from "../engine/log";
import type { Peer, SessionRuntime } from "../engine/runtime";
import { HttpError, type SessionManager } from "../engine/sessions";
import { SESSION_ID } from "../engine/store";
import { tokenMatches } from "./security";

const HELLO_TIMEOUT_MS = 5_000;
export const PING_INTERVAL_MS = 20_000;
const OPEN = 1;

/** The parts of a ws socket this handler uses (the library ships no types here). */
interface WsLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping?(data?: unknown): void;
  terminate?(): void;
  on(event: "message", listener: (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "pong", listener: () => void): void;
}

export interface SocketDeps {
  csrfToken: string;
  manager: SessionManager;
  log: Logger;
  pingIntervalMs?: number;
}

function asText(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

export function registerSocket(app: FastifyInstance, deps: SocketDeps): void {
  const pingInterval = deps.pingIntervalMs ?? PING_INTERVAL_MS;

  app.get<{ Params: { id: string } }>("/ws/session/:id", { websocket: true }, (raw, req) => {
    const socket = raw as unknown as WsLike;
    const sessionId = req.params.id;
    let closed = false;
    let detached = false;
    let missedPongs = 0;
    let ready: Promise<SessionRuntime | null> | null = null;
    let windowStart = Date.now();
    let count = 0;

    socket.on("pong", () => {
      missedPongs = 0;
    });

    const pingTimer = setInterval(() => {
      if (closed) return;
      missedPongs += 1;
      if (missedPongs >= 2) {
        closed = true;
        clearInterval(pingTimer);
        clearTimeout(helloTimer);
        if (!detached) {
          detached = true;
          void ready?.then((rt) => rt?.detach(peer));
        }
        try {
          if (typeof socket.terminate === "function") {
            socket.terminate();
          } else {
            socket.close(1006, "ping_timeout");
          }
        } catch {
          // Socket was already terminated.
        }
        return;
      }
      try {
        socket.ping?.();
      } catch {
        // Socket may have closed abruptly.
      }
    }, pingInterval);
    pingTimer.unref?.();

    const peer: Peer = {
      id: randomId(6),
      send(msg: ServerMsg) {
        if (closed || socket.readyState !== OPEN) return;
        try {
          socket.send(JSON.stringify(msg));
        } catch {
          // A socket that cannot take a message is about to close anyway.
        }
      },
      close() {
        if (closed) return;
        closed = true;
        clearInterval(pingTimer);
        // 4404 is the code for a session that does not exist, which tells the browser not to reconnect.
        socket.close(4404, "discarded");
      },
    };

    const fail = (code: number, errorCode: string, message: string) => {
      if (closed) return;
      clearInterval(pingTimer);
      peer.send({ type: "error", code: errorCode, message });
      closed = true;
      socket.close(code, errorCode);
    };

    if (!SESSION_ID.test(sessionId)) {
      fail(4404, "not_found", "That session does not exist.");
      return;
    }

    const helloTimer = setTimeout(() => fail(4401, "no_hello", "The connection was not authorised in time."), HELLO_TIMEOUT_MS);

    socket.on("message", (data, isBinary) => {
      if (closed) return;
      const now = Date.now();
      if (now - windowStart >= 1_000) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      if (count > LIMITS.messagesPerSecond) return fail(4429, "rate_limited", "Too many messages. Reconnecting.");
      if (isBinary) return fail(4400, "invalid_message", "Invalid message.");
      let json: unknown;
      try {
        json = JSON.parse(asText(data));
      } catch {
        return fail(4400, "invalid_message", "Invalid message.");
      }
      const parsed = ClientMsgSchema.safeParse(json);
      if (!parsed.success) return fail(4400, "invalid_message", "Invalid message.");
      const msg = parsed.data;

      if (!ready) {
        if (msg.type !== "hello" || !tokenMatches(deps.csrfToken, msg.token)) return fail(4401, "unauthorized", "Not allowed.");
        clearTimeout(helloTimer);
        ready = deps.manager.open(sessionId).then(
          (rt) => {
            if (!rt) {
              fail(4404, "not_found", "That session does not exist.");
              return null;
            }
            if (!closed) rt.attach(peer);
            return rt;
          },
          (err) => {
            deps.log.error(`Could not open session ${sessionId}`, err);
            fail(1011, "server_error", "The session could not be opened.");
            return null;
          },
        );
        return;
      }
      if (msg.type === "hello") return;
      if (msg.type === "session.discard") {
        void ready.then(async (rt) => {
          if (!rt || closed) return;
          try {
            await deps.manager.discard(sessionId);
          } catch (err) {
            if (err instanceof HttpError) {
              peer.send({ type: "error", code: "discard_refused", message: err.message });
            } else {
              deps.log.error(`Could not discard session ${sessionId}`, err);
              peer.send({ type: "error", code: "server_error", message: "The round could not be deleted. Try again." });
            }
          }
        });
        return;
      }
      void ready.then((rt) => {
        if (rt && !closed) return rt.handle(msg, peer);
      });
    });

    socket.on("close", () => {
      closed = true;
      clearInterval(pingTimer);
      clearTimeout(helloTimer);
      if (!detached) {
        detached = true;
        void ready?.then((rt) => rt?.detach(peer));
      }
    });

    socket.on("error", (err) => deps.log.warn(`WebSocket error on session ${sessionId}`, err));
  });
}
