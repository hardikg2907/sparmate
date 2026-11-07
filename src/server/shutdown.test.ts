import { describe, expect, it, vi } from "vitest";
import { createShutdownHandler } from "./index";

describe("createShutdownHandler", () => {
  it("shuts down all subsystems cleanly and calls exit(0)", async () => {
    const kokoro = { shutdown: vi.fn() };
    const killRunners = vi.fn();
    const manager = { shutdown: vi.fn().mockResolvedValue(undefined) };
    const driver = { closeAll: vi.fn() };
    const app = { close: vi.fn().mockResolvedValue(undefined) };
    const log = {
      info: vi.fn(),
      error: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const exit = vi.fn();

    const handler = createShutdownHandler({
      kokoro,
      killRunners,
      manager,
      driver,
      app,
      log,
      exit,
      deadlineMs: 5000,
    });

    await handler("SIGTERM");

    expect(log.info).toHaveBeenCalledWith("Stopping on SIGTERM");
    expect(kokoro.shutdown).toHaveBeenCalled();
    expect(killRunners).toHaveBeenCalled();
    expect(manager.shutdown).toHaveBeenCalled();
    expect(driver.closeAll).toHaveBeenCalled();
    expect(app.close).toHaveBeenCalled();
    expect(log.close).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("forces exit(1) when shutdown operations exceed the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const kokoro = { shutdown: vi.fn() };
      const manager = {
        shutdown: vi.fn().mockReturnValue(new Promise(() => {})),
      };
      const driver = { closeAll: vi.fn() };
      const app = { close: vi.fn().mockResolvedValue(undefined) };
      const log = {
        info: vi.fn(),
        error: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const exit = vi.fn();

      const handler = createShutdownHandler({
        kokoro,
        manager,
        driver,
        app,
        log,
        exit,
        deadlineMs: 3000,
      });

      void handler("SIGINT");

      await vi.advanceTimersByTimeAsync(3000);

      expect(exit).toHaveBeenCalledWith(1);
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Shutdown timed out after 3000 ms"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores duplicate shutdown signals", async () => {
    const kokoro = { shutdown: vi.fn() };
    const manager = { shutdown: vi.fn().mockResolvedValue(undefined) };
    const driver = { closeAll: vi.fn() };
    const app = { close: vi.fn().mockResolvedValue(undefined) };
    const log = {
      info: vi.fn(),
      error: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const exit = vi.fn();

    const handler = createShutdownHandler({
      kokoro,
      manager,
      driver,
      app,
      log,
      exit,
      deadlineMs: 5000,
    });

    await Promise.all([handler("SIGHUP"), handler("SIGTERM")]);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(kokoro.shutdown).toHaveBeenCalledTimes(1);
  });
});
