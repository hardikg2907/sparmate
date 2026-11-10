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
    await vi.waitFor(() => expect(rt!.session.status).toBe("debriefed"), { timeout: 5_000 });
    rt!.lastActivity = 0;
    sweep(stack.manager);
    expect(await stack.manager.open(id)).not.toBe(rt);
  });
});

describe("a gap round and the gap it practises", () => {
  async function debriefedSource(): Promise<string> {
    const id = await stack.manager.create({ problemId: "c2-url-shortener", mode: "guided" });
    const rt = await stack.manager.open(id);
    const peer = { id: "p", send() {}, close() {} };
    rt!.attach(peer);
    rt!.detach(peer);
    await rt!.handle({ type: "session.end" }, peer);
    await vi.waitFor(() => expect(rt!.session.status).toBe("debriefed"), { timeout: 5_000 });
    return id;
  }
  const gap = { title: "Asking for the scale first", goodLooksLike: "Ask how many requests arrive first." };

  it("links a gap round to its source only when the source is a debriefed round of the problem that holds the gap", async () => {
    const source = await debriefedSource();
    const linked = await stack.manager.create({ problemId: "c2-url-shortener", mode: "guided", focus: { ...gap, sourceSessionId: source } });
    expect((await stack.manager.session(linked))?.focus?.source).toEqual({ sessionId: source, gapTitle: gap.title, step: "requirements" });

    for (const sourceSessionId of ["../../etc/passwd", "20261028-1000-c2-url-shortener-none"]) {
      const id = await stack.manager.create({ problemId: "c2-url-shortener", mode: "guided", focus: { ...gap, sourceSessionId } });
      expect((await stack.manager.session(id))?.focus).toEqual({ title: gap.title, goodLooksLike: gap.goodLooksLike });
    }
    const unknownGap = await stack.manager.create({
      problemId: "c2-url-shortener",
      mode: "guided",
      focus: { title: "A gap it never had", goodLooksLike: "x y", sourceSessionId: source },
    });
    expect((await stack.manager.session(unknownGap))?.focus?.source).toBeUndefined();
    const otherProblem = await stack.manager.create({ problemId: "c2-rate-limiter", mode: "guided", focus: { ...gap, sourceSessionId: source } });
    expect((await stack.manager.session(otherProblem))?.focus?.source).toBeUndefined();
  });

  it("writes the mark through the source's open room and to disk, counts the gap done, and drops it when the gap round is discarded", async () => {
    const source = await debriefedSource();
    const round = await stack.manager.create({ problemId: "c2-url-shortener", mode: "guided", focus: { ...gap, sourceSessionId: source } });
    const link = (await stack.manager.session(round))!.focus!.source!;
    const record = (mark: { sessionId: string; at: string } | null) =>
      (stack.manager as unknown as { recordPractice(s: typeof link, m: typeof mark, r: string): Promise<void> }).recordPractice(link, mark, round);

    await record({ sessionId: round, at: "2026-11-11T10:00:00.000Z" });
    const open = await stack.manager.open(source);
    expect(open?.session.gapPractice).toEqual({ [gap.title]: { sessionId: round, at: "2026-11-11T10:00:00.000Z" } });
    await vi.waitFor(
      async () => {
        const onDisk = JSON.parse(await readFile(join(stack.store.dir(source), "session.json"), "utf8")) as Session;
        expect(onDisk.gapPractice?.[gap.title]?.sessionId).toBe(round);
      },
      { timeout: 8_000 },
    );
    expect(
      stack.manager
        .history()
        .find((h) => h.id === source)
        ?.gaps?.find((g) => g.title === gap.title)?.done,
    ).toBe(true);

    open!.lastActivity = 0;
    (stack.manager as unknown as { sweep(): void }).sweep();
    await stack.manager.discard(round);
    const after = JSON.parse(await readFile(join(stack.store.dir(source), "session.json"), "utf8")) as Session;
    expect(after.gapPractice).toEqual({});
    expect(
      stack.manager
        .history()
        .find((h) => h.id === source)
        ?.gaps?.find((g) => g.title === gap.title)?.done,
    ).toBe(false);
  });
});

describe("a gap practised by two gap rounds", () => {
  it("hands the mark to the other round when the one that holds it is discarded", async () => {
    const id = await stack.manager.create({ problemId: "c2-url-shortener", mode: "guided" });
    const rt = await stack.manager.open(id);
    const peer = { id: "p", send() {}, close() {} };
    rt!.attach(peer);
    rt!.detach(peer);
    await rt!.handle({ type: "session.end" }, peer);
    await vi.waitFor(() => expect(rt!.session.status).toBe("debriefed"), { timeout: 5_000 });
    const focus = { title: "Asking for the scale first", goodLooksLike: "Ask for the load first.", sourceSessionId: id };
    const first = await stack.manager.create({ problemId: "c2-url-shortener", mode: "guided", focus });
    const second = await stack.manager.create({ problemId: "c2-url-shortener", mode: "guided", focus });
    for (const round of [first, second]) {
      const s = (await stack.manager.session(round))!;
      s.stepVerdicts = { requirements: { verdict: "pass", at: 1 } };
      await stack.store.save(s);
    }
    const link = (await stack.manager.session(first))!.focus!.source!;
    const record = (round: string) =>
      (stack.manager as unknown as { recordPractice(s: typeof link, m: { sessionId: string; at: string } | null, r: string): Promise<void> }).recordPractice(
        link,
        { sessionId: round, at: "2026-11-11T10:00:00.000Z" },
        round,
      );
    await record(first);
    await record(second);
    expect(rt!.session.gapPractice?.[focus.title]?.sessionId).toBe(first);
    await stack.manager.discard(first);
    expect(rt!.session.gapPractice?.[focus.title]?.sessionId).toBe(second);
    await stack.manager.discard(second);
    expect(rt!.session.gapPractice?.[focus.title]).toBeUndefined();
  });
});
