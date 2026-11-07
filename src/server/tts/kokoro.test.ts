import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KokoroManager } from "./kokoro";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn((path: string) => !path.includes("missing")),
}));

interface MockChildProcess extends EventEmitter {
  pid: number;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

function createMockChild(pid = 12345): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.pid = pid;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe("KokoroManager", () => {
  let mockSpawn: any;

  beforeEach(async () => {
    const cp = await import("node:child_process");
    mockSpawn = cp.spawn;
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports unavailable if any required file is missing", () => {
    const manager = new KokoroManager({
      kokoroHome: "/missing/folder",
      appRoot: "/app",
    });
    expect(manager.isAvailable()).toBe(false);
  });

  it("spawns worker lazily with argument array and handles successful reply", async () => {
    const child = createMockChild(555);
    mockSpawn.mockReturnValue(child);

    const manager = new KokoroManager({
      kokoroHome: "/valid/tts",
      appRoot: "/valid/app",
    });
    expect(manager.isAvailable()).toBe(true);

    child.stdin.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      const parsed = JSON.parse(line);
      const b64 = Buffer.from("fake-wav-bytes").toString("base64");
      child.stdout.write(JSON.stringify({ id: parsed.id, ok: true, wavBase64: b64 }) + "\n");
    });

    const wavPromise = manager.synthesize({ text: "Hello", voice: "bm_george", speed: 0.95 });
    const wav = await wavPromise;

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [bin, args] = mockSpawn.mock.calls[0];
    expect(bin).toBe("/valid/tts/.venv/bin/python");
    expect(args).toEqual(["-I", "/valid/app/scripts/tts/kokoro_worker.py", "/valid/tts/kokoro-v1.0.onnx", "/valid/tts/voices-v1.0.bin"]);
    expect(wav.toString("utf8")).toBe("fake-wav-bytes");

    manager.shutdown();
  });

  it("queues requests one at a time and answers in order", async () => {
    const child = createMockChild(777);
    mockSpawn.mockReturnValue(child);

    const manager = new KokoroManager({
      kokoroHome: "/valid/tts",
      appRoot: "/valid/app",
    });

    const receivedPayloads: any[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      const parsed = JSON.parse(chunk.toString("utf8").trim());
      receivedPayloads.push(parsed);
      // Reply after a short tick to confirm serial queueing.
      setTimeout(() => {
        const b64 = Buffer.from(`wav-${parsed.text}`).toString("base64");
        child.stdout.write(JSON.stringify({ id: parsed.id, ok: true, wavBase64: b64 }) + "\n");
      }, 5);
    });

    const p1 = manager.synthesize({ text: "First", voice: "bm_george", speed: 0.95 });
    const p2 = manager.synthesize({ text: "Second", voice: "af_heart", speed: 1.0 });

    const [wav1, wav2] = await Promise.all([p1, p2]);
    expect(wav1.toString("utf8")).toBe("wav-First");
    expect(wav2.toString("utf8")).toBe("wav-Second");
    expect(receivedPayloads).toHaveLength(2);
    expect(receivedPayloads[0].text).toBe("First");
    expect(receivedPayloads[1].text).toBe("Second");

    manager.shutdown();
  });

  it("times out a stalled request after limit, kills worker by PID, and restarts a fresh worker on next request", async () => {
    const child1 = createMockChild(1001);
    const child2 = createMockChild(1002);
    mockSpawn.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

    const manager = new KokoroManager({
      kokoroHome: "/valid/tts",
      appRoot: "/valid/app",
      timeoutMs: 50,
    });

    // child1 intentionally does not reply on stdout to trigger timeout.
    await expect(manager.synthesize({ text: "Stall", voice: "bm_george", speed: 0.95 })).rejects.toThrow("TTS request timed out");
    expect(child1.kill).toHaveBeenCalledWith("SIGKILL");

    // Next request triggers child2 spawn and completes.
    child2.stdin.on("data", (chunk: Buffer) => {
      const parsed = JSON.parse(chunk.toString("utf8").trim());
      const b64 = Buffer.from("recovered-audio").toString("base64");
      child2.stdout.write(JSON.stringify({ id: parsed.id, ok: true, wavBase64: b64 }) + "\n");
    });

    const res2 = await manager.synthesize({ text: "Next", voice: "bm_george", speed: 0.95 });
    expect(res2.toString("utf8")).toBe("recovered-audio");
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    manager.shutdown();
  });

  it("kills the worker process by PID when shutting down", async () => {
    const child = createMockChild(888);
    mockSpawn.mockReturnValue(child);

    const manager = new KokoroManager({
      kokoroHome: "/valid/tts",
      appRoot: "/valid/app",
    });

    child.stdin.on("data", (chunk: Buffer) => {
      const parsed = JSON.parse(chunk.toString("utf8").trim());
      const b64 = Buffer.from("audio").toString("base64");
      child.stdout.write(JSON.stringify({ id: parsed.id, ok: true, wavBase64: b64 }) + "\n");
    });

    await manager.synthesize({ text: "Hello", voice: "bm_george", speed: 0.95 });
    manager.shutdown();

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("stops the worker after idle timeout without requests, and restarts lazily", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const child1 = createMockChild(2001);
      const child2 = createMockChild(2002);
      mockSpawn.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

      const manager = new KokoroManager({
        kokoroHome: "/valid/tts",
        appRoot: "/valid/app",
        idleTimeoutMs: 1000,
      });

      child1.stdin.on("data", (chunk: Buffer) => {
        const parsed = JSON.parse(chunk.toString("utf8").trim());
        const b64 = Buffer.from("audio1").toString("base64");
        child1.stdout.write(JSON.stringify({ id: parsed.id, ok: true, wavBase64: b64 }) + "\n");
      });

      const res1 = await manager.synthesize({ text: "Hello", voice: "bm_george", speed: 0.95 });
      expect(res1.toString("utf8")).toBe("audio1");
      expect(child1.kill).not.toHaveBeenCalled();

      // Advance by idle timeout
      await vi.advanceTimersByTimeAsync(1000);
      expect(child1.kill).toHaveBeenCalledWith("SIGKILL");

      // Next request starts child2 lazily
      child2.stdin.on("data", (chunk: Buffer) => {
        const parsed = JSON.parse(chunk.toString("utf8").trim());
        const b64 = Buffer.from("audio2").toString("base64");
        child2.stdout.write(JSON.stringify({ id: parsed.id, ok: true, wavBase64: b64 }) + "\n");
      });

      const res2 = await manager.synthesize({ text: "World", voice: "bm_george", speed: 0.95 });
      expect(res2.toString("utf8")).toBe("audio2");
      expect(mockSpawn).toHaveBeenCalledTimes(2);

      manager.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops queued request when client abort signal is triggered", async () => {
    const child = createMockChild(3001);
    mockSpawn.mockReturnValue(child);

    const manager = new KokoroManager({
      kokoroHome: "/valid/tts",
      appRoot: "/valid/app",
    });

    const received: string[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      const parsed = JSON.parse(chunk.toString("utf8").trim());
      received.push(parsed.text);
      setTimeout(() => {
        const b64 = Buffer.from(`wav-${parsed.text}`).toString("base64");
        child.stdout.write(JSON.stringify({ id: parsed.id, ok: true, wavBase64: b64 }) + "\n");
      }, 20);
    });

    const ac = new AbortController();
    const p1 = manager.synthesize({ text: "First", voice: "bm_george", speed: 0.95 });
    const p2 = manager.synthesize({ text: "Second", voice: "bm_george", speed: 0.95 }, ac.signal);

    ac.abort();

    await expect(p2).rejects.toThrow(/abort/i);
    await expect(p1).resolves.toBeDefined();

    expect(received).toEqual(["First"]);

    manager.shutdown();
  });
});
