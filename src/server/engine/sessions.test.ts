import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../shared/types";
import { makeStack, type Stack } from "./__fixtures__/stack";
import { SessionManager } from "./sessions";

let stack: Stack;
beforeEach(async () => {
  stack = await makeStack();
});
afterEach(async () => {
  await stack.cleanup();
});

describe("starting the server with rounds on disk", () => {
  it("pauses a round that was live, as paused by the restart, and saves that", async () => {
    const id = await stack.manager.create({ problemId: "c2-url-shortener", mode: "interview" });
    await stack.manager.shutdown();

    const fresh = new SessionManager(stack.deps);
    await fresh.init();
    const session = (await fresh.session(id)) as Session;
    expect(session).toMatchObject({ status: "paused", pauseReason: "restart" });
    expect(session.pauseStartedAt).not.toBeNull();
    const onDisk = JSON.parse(await readFile(join(stack.store.dir(id), "session.json"), "utf8")) as Session;
    expect(onDisk).toMatchObject({ status: "paused", pauseReason: "restart" });
    await fresh.shutdown();
  });

  it("keeps the reason a round was already paused for", async () => {
    const id = await stack.manager.create({ problemId: "c2-url-shortener", mode: "interview" });
    const rt = await stack.manager.open(id);
    const peer = { id: "p", send() {}, close() {} };
    rt?.attach(peer);
    await rt?.handle({ type: "session.pause" }, peer);
    await stack.manager.shutdown();

    const fresh = new SessionManager(stack.deps);
    await fresh.init();
    expect(await fresh.session(id)).toMatchObject({ status: "paused", pauseReason: "user" });
    await fresh.shutdown();
  });
});

describe("the sweep that drops idle rounds from memory", () => {
  const sweep = (m: SessionManager) => (m as unknown as { sweep(): void }).sweep();

  it("keeps a paused round that still owes the interviewer its pause note", async () => {
    const id = await stack.manager.create({ problemId: "c2-url-shortener", mode: "interview" });
    const rt = await stack.manager.open(id);
    const peer = { id: "p", send() {}, close() {} };
    rt!.attach(peer);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rt!.handle({ type: "session.pause" }, peer);
    rt!.detach(peer);
    rt!.lastActivity = 0;
    sweep(stack.manager);
    expect(await stack.manager.open(id)).toBe(rt);
  });

  it("drops a finished round nobody is watching", async () => {
    const id = await stack.manager.create({ problemId: "c2-url-shortener", mode: "interview" });
    const rt = await stack.manager.open(id);
    const peer = { id: "p", send() {}, close() {} };
    rt!.attach(peer);
    // With no page open, the debrief does not wait for a board image.
    rt!.detach(peer);
    await rt!.handle({ type: "session.end" }, peer);
    await vi.waitFor(() => expect(rt!.session.transcript.some((e) => e.channel === "coach" && e.role === "coach")).toBe(true), { timeout: 5_000 });
    rt!.lastActivity = 0;
    sweep(stack.manager);
    expect(await stack.manager.open(id)).not.toBe(rt);
  });
});
