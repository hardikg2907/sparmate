import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../shared/types";
import { STUDY_FILES, makeStack, recordingPeer, type Stack } from "./__fixtures__/stack";
import { attemptHeader } from "../study/attempts";
import { localDate } from "./fsutil";
import { SessionManager } from "./sessions";

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

let stack: Stack;

beforeEach(async () => {
  stack = await makeStack();
});
afterEach(async () => {
  vi.useRealTimers();
  await stack.cleanup();
});

const folder = (id: string) => stack.store.dir(id);

async function startHld(): Promise<string> {
  return stack.manager.create({ problemId: "c2-url-shortener", mode: "interview" });
}

async function startLld(): Promise<{ id: string; attempt: string }> {
  const id = await stack.manager.create({ problemId: "b3-parking-lot", mode: "interview" });
  const session = await stack.manager.session(id);
  return { id, attempt: join(stack.study, session?.code?.path ?? "missing") };
}

async function expectStudyFilesUntouched() {
  for (const [name, text] of Object.entries(STUDY_FILES)) expect(await readFile(join(stack.study, name), "utf8"), name).toBe(text);
}

describe("discarding a round", () => {
  it("deletes the session folder and the history entry, and the round cannot be opened again", async () => {
    const id = await startHld();
    expect(await exists(folder(id))).toBe(true);
    expect(stack.manager.history().map((h) => h.id)).toEqual([id]);

    await stack.manager.discard(id);
    expect(await exists(folder(id))).toBe(false);
    expect(stack.manager.history()).toEqual([]);
    expect(await stack.manager.open(id)).toBeNull();
    expect(await stack.manager.publicSession(id)).toBeNull();
    await expectStudyFilesUntouched();
  });

  it("tells every open socket the round was discarded and closes it", async () => {
    const id = await startHld();
    const rt = await stack.manager.open(id);
    const first = recordingPeer("one");
    const second = recordingPeer("two");
    rt?.attach(first);
    rt?.attach(second);

    await stack.manager.discard(id);
    for (const peer of [first, second]) {
      expect(peer.msgs.at(-1)).toEqual({ type: "session.discarded" });
      expect(peer.closed).toBe(true);
    }
  });

  it("closes a socket that reconnects to the discarded round", async () => {
    const id = await startHld();
    const rt = await stack.manager.open(id);
    await stack.manager.discard(id);
    const late = recordingPeer("late");
    rt?.attach(late);
    expect(late.msgs).toEqual([{ type: "session.discarded" }]);
    expect(late.closed).toBe(true);
    expect(await stack.manager.open(id)).toBeNull();
  });

  it("does not bring the folder back when a save arrives afterwards", async () => {
    const id = await startHld();
    const session = (await stack.manager.session(id)) as Session;
    await stack.manager.discard(id);
    await stack.store.save(session);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(await exists(folder(id))).toBe(false);
    expect(stack.manager.history()).toEqual([]);
  });

  it("stops the clock and the interviewer: no checkpoint fires afterwards", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const id = await startHld();
    const rt = await stack.manager.open(id);
    const session = rt?.session as Session;
    await vi.advanceTimersByTimeAsync(1_000);
    const before = session.transcript.length;

    await stack.manager.discard(id);
    // The end of requirements, the extension and time-up all fall inside this span.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(session.transcript).toHaveLength(before);
    expect(session.status).toBe("live");
    expect(await exists(folder(id))).toBe(false);
  });

  it("ignores messages that reach a runtime after it was discarded", async () => {
    const id = await startHld();
    const rt = await stack.manager.open(id);
    const peer = recordingPeer();
    rt?.attach(peer);
    await stack.manager.discard(id);
    const seen = peer.msgs.length;
    await rt?.handle({ type: "chat.send", channel: "interview", clientMsgId: "late", text: "hello?" }, peer);
    await rt?.handle({ type: "board.update", version: 5, elements: [] }, peer);
    expect(peer.msgs).toHaveLength(seen);
    expect(await exists(folder(id))).toBe(false);
  });

  it("discards a round that only exists on disk, such as a paused one from an earlier run", async () => {
    const id = await startHld();
    const session = (await stack.manager.session(id)) as Session;
    await stack.manager.shutdown();
    const saved = { ...session, status: "paused" as const, pauseStartedAt: new Date().toISOString(), pauseReason: "restart" as const };
    await writeFile(join(folder(id), "session.json"), JSON.stringify(saved));
    const fresh = new SessionManager(stack.deps);
    await fresh.init();
    expect(fresh.history().map((h) => h.id)).toEqual([id]);

    await fresh.discard(id);
    expect(await exists(folder(id))).toBe(false);
    expect(fresh.history()).toEqual([]);
    await fresh.shutdown();
  });

  it("treats two discards at once as one", async () => {
    const id = await startHld();
    await expect(Promise.all([stack.manager.discard(id), stack.manager.discard(id)])).resolves.toBeDefined();
    expect(await exists(folder(id))).toBe(false);
  });

  it("answers 404 for an unknown round and for ids that are not session ids", async () => {
    await expect(stack.manager.discard("20261030-0900-c2-url-shortener-zzzz")).rejects.toMatchObject({ status: 404 });
    for (const bad of ["", "..", "../data", "x/../../y", "20261030-0900-c2-url-shortener-ZZZZ"]) {
      await expect(stack.manager.discard(bad), bad).rejects.toMatchObject({ status: 404 });
    }
    expect(await exists(stack.config.dataDir)).toBe(true);
  });
});

describe("refusing while the debrief runs", () => {
  it("answers 409, keeps the folder and the runtime, and allows the discard once the status moves on", async () => {
    const id = await startHld();
    const rt = await stack.manager.open(id);
    const session = rt?.session as Session;
    const peer = recordingPeer();
    rt?.attach(peer);

    session.status = "debriefing";
    await expect(stack.manager.discard(id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/debrief is running/i) });
    expect(await exists(folder(id))).toBe(true);
    expect(stack.manager.history().map((h) => h.id)).toEqual([id]);
    expect(peer.closed).toBe(false);
    expect(await stack.manager.open(id)).toBe(rt);

    session.status = "failed";
    await stack.manager.discard(id);
    expect(await exists(folder(id))).toBe(false);
  });
});

describe("the LLD attempt file", () => {
  it("is deleted when it still holds only its header", async () => {
    const { id, attempt } = await startLld();
    expect(await readFile(attempt, "utf8")).toBe(attemptHeader("Parking Lot", localDate()));

    await stack.manager.discard(id);
    expect(await exists(attempt)).toBe(false);
    expect(await exists(join(stack.study, "lld", "parking-lot"))).toBe(true);
    expect(await exists(folder(id))).toBe(false);
    await expectStudyFilesUntouched();
  });

  it("is kept when the candidate edited it outside the app", async () => {
    const { id, attempt } = await startLld();
    const code = `${attemptHeader("Parking Lot", localDate())}class ParkingLot {};\n`;
    await writeFile(attempt, code);

    await stack.manager.discard(id);
    expect(await readFile(attempt, "utf8")).toBe(code);
    expect(await exists(folder(id))).toBe(false);
  });

  it("is kept when code is still on its way from the browser, because the discard waits for the write", async () => {
    const { id, attempt } = await startLld();
    const rt = await stack.manager.open(id);
    const peer = recordingPeer();
    rt?.attach(peer);
    const code = `${attemptHeader("Parking Lot", localDate())}int main() { return 0; }\n`;
    const sending = rt?.handle({ type: "code.update", version: 1, content: code }, peer);

    await stack.manager.discard(id);
    await sending;
    expect(await readFile(attempt, "utf8")).toBe(code);
    expect(await exists(folder(id))).toBe(false);
  });

  it("is not recreated by the file watcher after the round is gone", async () => {
    const { id, attempt } = await startLld();
    await stack.manager.discard(id);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await exists(attempt)).toBe(false);
  });
});
