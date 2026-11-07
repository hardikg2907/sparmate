import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
