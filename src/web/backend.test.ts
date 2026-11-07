import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMsg } from "../shared/protocol";
import { ApiError, SessionSocket, api, getBootstrap, type SocketStatus } from "./backend";

/** Just enough of WebSocket for the class under test, driven by hand. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
}

const STATE: ServerMsg = {
  type: "agent.status",
  channel: "interview",
  state: "idle",
};

function make() {
  const getToken = vi.fn(async (refresh: boolean) => (refresh ? "fresh-token" : "first-token"));
  const socket = new SessionSocket({ url: "ws://x/ws/session/s1", getToken, createSocket: (url) => new FakeWebSocket(url) as unknown as WebSocket });
  const statuses: SocketStatus[] = [];
  socket.onStatus((status) => statuses.push(status));
  return { socket, getToken, statuses };
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1] as FakeWebSocket;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionSocket", () => {
  it("sends hello with the token before anything else", async () => {
    const { socket, statuses } = make();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.connected).toBe(false);
    last().open();
    expect(JSON.parse(last().sent[0] ?? "{}")).toEqual({ type: "hello", token: "first-token" });
    expect(socket.connected).toBe(true);
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("refuses to send until the socket is open", async () => {
    const { socket } = make();
    expect(socket.send({ type: "session.pause" })).toBe(false);
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.send({ type: "session.pause" })).toBe(false);
    last().open();
    expect(socket.send({ type: "session.pause" })).toBe(true);
    expect(last().sent).toHaveLength(2);
  });

  it("hands typed messages to the matching handlers and ignores junk", async () => {
    const { socket } = make();
    const handler = vi.fn();
    const other = vi.fn();
    const off = socket.on("agent.status", handler);
    socket.on("phase.changed", other);
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    last().receive(STATE);
    last().receive("not json");
    last().receive({ nope: true });
    last().receive({ type: 42 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(STATE);
    expect(other).not.toHaveBeenCalled();
    off();
    last().receive(STATE);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps going when one handler throws", async () => {
    const { socket } = make();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    socket.on("agent.status", () => {
      throw new Error("boom");
    });
    socket.on("agent.status", good);
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    last().receive(STATE);
    expect(good).toHaveBeenCalled();
    error.mockRestore();
  });

  it("reconnects quickly after a healthy connection drops, with the same token", async () => {
    const { socket, getToken, statuses } = make();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    last().receive(STATE);
    last().drop();
    expect(socket.connected).toBe(false);
    expect(statuses.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(400);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(getToken).toHaveBeenLastCalledWith(false);
  });

  it("asks for a fresh token after a connection that never heard from the server", async () => {
    const { socket, getToken } = make();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    // The server closed on a stale token before saying anything.
    last().drop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(getToken).toHaveBeenLastCalledWith(true);
    expect(JSON.parse((last().open(), last().sent[0] ?? "{}")).token).toBe("fresh-token");
  });

  it("treats an error frame as a rejection, not as a healthy connection", async () => {
    const { socket, getToken } = make();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    last().receive({ type: "error", code: "unauthorized", message: "Not allowed." });
    last().drop(4401);
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    // A restarted server has a new token, so the next try must fetch it again.
    expect(getToken).toHaveBeenLastCalledWith(true);
  });

  it("gives up at once when the server says the session does not exist", async () => {
    const { socket } = make();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    last().receive({ type: "error", code: "not_found", message: "That session does not exist." });
    last().drop(4404);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.status).toBe("closed");
  });

  it("backs off between failed attempts and then stops", async () => {
    const { socket, statuses } = make();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    for (let attempt = 0; attempt < 12 && socket.status !== "closed"; attempt++) {
      last().drop();
      await vi.advanceTimersByTimeAsync(15_000);
    }
    expect(socket.status).toBe("closed");
    expect(statuses.at(-1)).toBe("closed");
    const made = FakeWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(made);

    // A manual retry starts over.
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(made + 1);
  });

  it("stays shut after close, even with a retry pending", async () => {
    const { socket } = make();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    last().receive(STATE);
    last().drop();
    socket.close();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.status).toBe("closed");
  });

  it("does not open a socket if it was closed while the token was loading", async () => {
    let release: (token: string) => void = () => {};
    const getToken = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const socket = new SessionSocket({ url: "ws://x", getToken, createSocket: (url) => new FakeWebSocket(url) as unknown as WebSocket });
    socket.connect();
    socket.close();
    release("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe("discarding a session over REST", () => {
  const ID = "20261030-0900-c2-url-shortener-abcd";
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends DELETE with the CSRF token and reads the answer", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => (url === "/api/bootstrap" ? json(200, { csrfToken: "tok1" }) : json(200, { ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    await getBootstrap(true);

    await expect(api.discardSession(ID)).resolves.toEqual({ ok: true });
    const call = fetchMock.mock.calls.find(([url]) => url === `/api/sessions/${ID}`);
    expect(call?.[1]).toMatchObject({ method: "DELETE", credentials: "same-origin" });
    expect((call?.[1]?.headers as Record<string, string>)["x-csrf-token"]).toBe("tok1");
  });

  it("asks for a fresh token once after a 403, as for the other writes", async () => {
    let tokens = 0;
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/bootstrap") return json(200, { csrfToken: `tok${++tokens}` });
        const token = (init?.headers as Record<string, string>)["x-csrf-token"] ?? "";
        seen.push(token);
        return token === "tok1" ? json(403, { error: "Forbidden" }) : json(200, { ok: true });
      }),
    );
    await getBootstrap(true);
    await expect(api.discardSession(ID)).resolves.toEqual({ ok: true });
    expect(seen).toEqual(["tok1", "tok2"]);
  });

  it("surfaces the server's message when it refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url === "/api/bootstrap" ? json(200, { csrfToken: "tok1" }) : json(409, { error: "The debrief is running. Wait for it to finish, then discard the round." }))),
    );
    await getBootstrap(true);
    await expect(api.discardSession(ID)).rejects.toMatchObject({ status: 409, message: "The debrief is running. Wait for it to finish, then discard the round." });
    await expect(api.discardSession(ID)).rejects.toBeInstanceOf(ApiError);
  });
});
