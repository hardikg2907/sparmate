import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { registerSocket } from "./socket";
import { newCsrfToken } from "./security";
import type { SessionRuntime } from "../engine/runtime";

describe("WebSocket heartbeat", () => {
  it("pings the socket, resets count on pong, and terminates silent sockets after 2 missed pongs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const csrfToken = newCsrfToken();
      let wsHandler: ((raw: unknown, req: unknown) => void) | undefined;
      const mockApp = {
        get: vi.fn((path: string, _opts: unknown, handler: (raw: unknown, req: unknown) => void) => {
          if (path === "/ws/session/:id") {
            wsHandler = handler;
          }
        }),
      } as unknown as FastifyInstance;

      const mockRuntime = {
        attach: vi.fn(),
        detach: vi.fn(),
        handle: vi.fn(),
      };
      const mockManager = {
        open: vi.fn().mockResolvedValue(mockRuntime as unknown as SessionRuntime),
      };
      const mockLog = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      registerSocket(mockApp, {
        csrfToken,
        manager: mockManager as any,
        log: mockLog as any,
        pingIntervalMs: 1000,
      });

      expect(wsHandler).toBeDefined();

      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const mockSocket = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
        ping: vi.fn(),
        terminate: vi.fn(),
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
        }),
      };

      const mockReq = {
        params: { id: "20261029-1000-c2-url-shortener-abcd" },
        headers: {},
      };

      wsHandler!(mockSocket, mockReq);

      expect(mockSocket.on).toHaveBeenCalledWith("pong", expect.any(Function));

      // Authenticate with hello message to clear helloTimer
      listeners["message"]?.forEach((cb) => cb(Buffer.from(JSON.stringify({ type: "hello", token: csrfToken })), false));

      // Advance by 1 interval: first ping sent, 1 missed pong
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockSocket.ping).toHaveBeenCalledTimes(1);
      expect(mockSocket.terminate).not.toHaveBeenCalled();

      // Pong received from client
      listeners["pong"]?.forEach((cb) => cb());

      // Advance by 1 interval: ping sent again, missed pongs reset
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockSocket.ping).toHaveBeenCalledTimes(2);
      expect(mockSocket.terminate).not.toHaveBeenCalled();

      // Advance by 1 more interval without pong: 2 missed pongs triggers terminate
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockSocket.terminate).toHaveBeenCalledTimes(1);

      // Verify ping timer was cleared
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockSocket.ping).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
