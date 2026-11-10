import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DRILL_TYPES, localDay } from "../../shared/drills";
import type { Problem } from "../../shared/problem";
import type { SessionHistoryItem } from "../../shared/types";
import { makeStack, type Stack } from "./__fixtures__/stack";
import { DrillStore, emptyState } from "./drill-store";
import { DrillService, drillItemId, playableProblems, queueGapDrills } from "./drills";
import { createFakeDriver } from "./fake-driver";
import { HttpError } from "./sessions";

let stack: Stack;
let history: SessionHistoryItem[];
let clock: Date;
let service: DrillService;
let store: DrillStore;

const SESSION = "20261030-0900-c2-url-shortener-abcd";

function round(over: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  return {
    id: SESSION,
    problemId: "c2-url-shortener",
    title: "URL Shortener",
    track: "hld",
    mode: "interview",
    createdAt: new Date(2026, 9, 30, 9, 0).toISOString(),
    endedAt: new Date(2026, 9, 30, 9, 45).toISOString(),
    status: "debriefed",
    verdict: "lean_no_hire",
    pause: null,
    notesSaved: false,
    gaps: [
      { title: "Capacity math that changes the design", goodLooksLike: "Each number ends with a decision.", severity: "high", done: false },
      { title: "Communication was hard to follow", goodLooksLike: "Speak in short steps.", severity: "low", done: false },
      { title: "Cache stampede on a viral link", goodLooksLike: "Coalesce misses.", severity: "medium", done: false, drill: "deep_dive" },
    ],
    ...over,
  };
}

const ANSWER_READY =
  "Writes are about forty per second on average, which means one primary database handles them easily.\nReads reach four thousand per second, which means a cache in front of the database.\nStorage is about three terabytes, which means one large primary with replicas.";
const target = { drill: "capacity" as const, problemId: "c2-url-shortener" };

beforeEach(async () => {
  stack = await makeStack();
  history = [round()];
  clock = new Date(2026, 10, 3, 10, 0);
  store = new DrillStore(join(stack.data, "drills.json"), stack.log);
  await store.load();
  service = new DrillService({
    store,
    history: () => history,
    problems: stack.deps.problems,
    driver: createFakeDriver({ chunkDelayMs: 0 }),
    settings: stack.settings,
    prompts: stack.deps.prompts,
    guard: stack.deps.guard,
    log: stack.log,
    now: () => clock,
  });
});
afterEach(() => stack.cleanup());

describe("queueGapDrills", () => {
  const problems = () => new Map(stack.deps.problems.list().map((p) => [p.meta.id, p] as const));

  it("queues a drill per gap that has one, and none for a gap about pacing", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    expect(queueGapDrills(draft, history, problems(), "2026-10-30")).toBe(true);
    expect(draft.items.map((i) => [i.drill, i.dueOn, i.passes, i.status])).toEqual([
      ["capacity", "2026-10-31", 0, "open"],
      ["deep_dive", "2026-10-31", 0, "open"],
    ]);
    expect(draft.items.every((i) => i.originProblemId === i.problemId && i.variant === null && i.readyOn.length === 0)).toBe(true);
  });

  it("falls due the local day after the debrief, even for a late-evening or just-after-midnight debrief", async () => {
    await stack.deps.problems.reload();
    const late = round({ endedAt: new Date(2026, 9, 30, 23, 50).toISOString() });
    const draft = emptyState();
    queueGapDrills(draft, [late], problems(), "2026-10-30");
    expect(draft.items[0]?.dueOn).toBe("2026-10-31");
    const after = round({ id: "20261031-0001-c2-url-shortener-abcd", endedAt: new Date(2026, 9, 31, 0, 10).toISOString() });
    const next = emptyState();
    queueGapDrills(next, [after], problems(), "2026-10-31");
    expect(next.items[0]?.dueOn).toBe("2026-11-01");
  });

  it("looks back 14 days on the first build only: a candidate away for 20 days still gets every new debrief", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    // First build on 2026-10-01 with nothing played yet.
    expect(queueGapDrills(draft, [], problems(), "2026-10-01")).toBe(false);
    expect(draft.backfilledOn).toBe("2026-10-01");
    // A debrief on 2026-10-30 is seen only on 2026-11-19, which is 20 days later.
    const fresh = round({ endedAt: new Date(2026, 9, 30, 9, 45).toISOString() });
    expect(queueGapDrills(draft, [fresh], problems(), "2026-11-19")).toBe(true);
    expect(draft.items.map((i) => i.dueOn)).toEqual(["2026-11-19", "2026-11-19"]);
    expect(draft.items.every((i) => i.createdOn === "2026-10-31")).toBe(true);
  });

  it("does not queue a round that ended before the first build and fell outside its window", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    queueGapDrills(draft, [round({ endedAt: new Date(2026, 8, 1).toISOString() })], problems(), "2026-11-10");
    expect(draft.items).toEqual([]);
    expect(queueGapDrills(draft, [round({ endedAt: new Date(2026, 8, 1).toISOString() })], problems(), "2026-11-20")).toBe(false);
    expect(draft.items).toEqual([]);
  });

  it("loads a file saved before the marker: it counts as built, and takes its marker from its oldest drill", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    queueGapDrills(draft, history, problems(), "2026-10-30");
    delete draft.backfilledOn;
    const before = draft.items.length;
    const older = round({ id: "20260901-0900-c2-url-shortener-oldd", endedAt: new Date(2026, 8, 1).toISOString() });
    expect(queueGapDrills(draft, [...history, older], problems(), "2026-11-20")).toBe(false);
    expect(draft.backfilledOn).toBe("2026-10-31");
    expect(draft.items).toHaveLength(before);
  });

  it("never back-fills a drill with a due day before the day it is queued", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    queueGapDrills(draft, history, problems(), "2026-11-05");
    expect(draft.items.map((i) => i.dueOn)).toEqual(["2026-11-05", "2026-11-05"]);
    expect(draft.items.every((i) => i.createdOn === "2026-10-31")).toBe(true);
  });

  it("queues nothing from a debrief more than 14 days old, and does from one exactly 14 days old", async () => {
    await stack.deps.problems.reload();
    const old = emptyState();
    expect(queueGapDrills(old, history, problems(), "2026-11-14")).toBe(false);
    expect(old.items).toEqual([]);
    const edge = emptyState();
    expect(queueGapDrills(edge, history, problems(), "2026-11-13")).toBe(true);
    expect(edge.items.every((i) => i.dueOn === "2026-11-13")).toBe(true);
  });

  it("queues each gap once, and never from a round that is not debriefed", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    queueGapDrills(draft, history, problems(), "2026-11-03");
    expect(queueGapDrills(draft, history, problems(), "2026-11-03")).toBe(false);
    expect(draft.items).toHaveLength(2);
    const open = emptyState();
    expect(queueGapDrills(open, [round({ status: "live" }), round({ id: "x", status: "failed" })], problems(), "2026-11-03")).toBe(false);
  });

  it("does not queue a second open drill for the same gap on the same problem", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    queueGapDrills(draft, [round(), round({ id: "20261101-0900-c2-url-shortener-zzzz" })], problems(), "2026-11-03");
    expect(draft.items).toHaveLength(2);
  });

  it("queues drills from a gap-practice round too", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    queueGapDrills(draft, [round({ focus: true, mode: "guided" })], problems(), "2026-11-03");
    expect(draft.items.length).toBeGreaterThan(0);
  });

  it("skips a gap whose problem no longer loads", () => {
    const draft = emptyState();
    expect(queueGapDrills(draft, history, new Map(), "2026-11-03")).toBe(false);
  });

  it("uses the judge's drill, then the keywords, and queues nothing when none fits", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    queueGapDrills(
      draft,
      [round({ gaps: [{ title: "Totally unrelated words", goodLooksLike: "Be calm.", severity: "low", done: false, drill: "walk" }] })],
      problems(),
      "2026-11-03",
    );
    expect(draft.items.map((i) => i.drill)).toEqual(["walk"]);
    const none = emptyState();
    queueGapDrills(none, [round({ gaps: [{ title: "Totally unrelated words", goodLooksLike: "Be calm.", severity: "low", done: false }] })], problems(), "2026-11-03");
    expect(none.items).toEqual([]);
  });

  it("makes a stable, path-safe id", () => {
    expect(drillItemId("s", "g")).toMatch(/^[a-f0-9]{16}$/);
    expect(drillItemId("s", "g")).toBe(drillItemId("s", "g"));
    expect(drillItemId("s", "g")).not.toBe(drillItemId("s", "h"));
  });
});

describe("which problems a drill may use", () => {
  const stubs = (ids: string[], custom: string[] = []) =>
    [...ids.map((id) => ({ meta: { id }, custom: false })), ...custom.map((id) => ({ meta: { id }, custom: true }))] as unknown as Problem[];

  it("allows played problems and custom problems only", () => {
    const all = stubs(["a", "b", "c"], ["mine"]);
    expect(playableProblems(all, [{ problemId: "b", status: "debriefed" }]).map((p) => p.meta.id)).toEqual(["b", "mine"]);
    expect(playableProblems(all, [])).toHaveLength(1);
  });

  it("counts a finished round and never a live or paused one, so its hidden facts stay hidden", () => {
    const all = stubs(["a", "b", "c", "d", "e"]);
    const ids = (statuses: SessionHistoryItem["status"][]) =>
      playableProblems(
        all,
        statuses.map((status, i) => ({ problemId: "abcde"[i] ?? "a", status })),
      ).map((p) => p.meta.id);
    expect(ids(["live", "paused"])).toEqual([]);
    expect(ids(["ended", "debriefing", "debriefed", "failed", "live"])).toEqual(["a", "b", "c", "d"]);
  });

  it("offers nothing for a problem whose only round is paused", async () => {
    history = [round({ status: "paused", gaps: [] })];
    const summary = await service.summary();
    expect(summary.problems).toEqual([]);
    await expect(service.prompt(target)).rejects.toMatchObject({ status: 404 });
  });

  it("offers nothing from the library before a round exists", async () => {
    history = [];
    const summary = await service.summary();
    expect(summary.problems).toEqual([]);
    expect(summary.queue).toEqual([]);
    await expect(service.prompt(target)).rejects.toMatchObject({ status: 404 });
  });

  it("offers only the problem that was played, with the drills it supports", async () => {
    const summary = await service.summary();
    expect(summary.problems.map((p) => p.id)).toEqual(["c2-url-shortener"]);
    expect(summary.problems[0]?.drills).toEqual(["capacity", "walk", "requirements", "deep_dive"]);
    await expect(service.prompt({ drill: "capacity", problemId: "c2-rate-limiter" })).rejects.toMatchObject({ status: 404 });
  });

  it("includes a custom problem with no round", async () => {
    history = [];
    const example = stack.deps.problems.example("hld") as Problem;
    await mkdir(join(stack.data, "custom-problems"), { recursive: true });
    const body = `---\nid: my-custom-hld\ntrack: hld\ntitle: My custom design\ndifficulty: medium\ntags: []\ntracker: null\nnotesFile: notes/my-custom-hld.md\n---\n\n${example.body}\n`;
    await writeFile(join(stack.data, "custom-problems", "my-custom-hld.md"), body);
    const summary = await service.summary();
    expect(summary.problems.map((p) => p.id)).toEqual(["my-custom-hld"]);
    const prompt = await service.prompt({ drill: "walk", problemId: "my-custom-hld" });
    expect(prompt.problem.title).toBe("My custom design");
  });

  it("rejects a drill of the wrong track", async () => {
    await expect(service.prompt({ drill: "lld_skeleton", problemId: "c2-url-shortener" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("summary", () => {
  it("lists due drills first and counts the due ones", async () => {
    const summary = await service.summary();
    expect(summary.today).toBe("2026-11-03");
    expect(summary.dueCount).toBe(2);
    expect(summary.queue.map((r) => [r.title, r.due])).toEqual([
      ["Capacity math", true],
      ["Pick a deep dive", true],
    ]);
    expect(summary.queue[0]?.task).toContain("only the numbers that decide something");
    expect(summary.queue[0]?.passes).toBe(0);
  });

  it("shows a drill before its day as not due", async () => {
    clock = new Date(2026, 9, 30, 20, 0);
    const summary = await service.summary();
    expect(summary.dueCount).toBe(0);
    expect(summary.queue.every((r) => !r.due)).toBe(true);
  });

  it("writes the schedule to disk once and keeps it between summaries", async () => {
    await service.summary();
    clock = new Date(2026, 10, 4, 9, 0);
    const again = await service.summary();
    expect(again.queue).toHaveLength(2);
    expect(store.snapshot().items).toHaveLength(2);
  });
});

describe("running a drill", () => {
  it("returns the prompt for a free drill without the answer key", async () => {
    const prompt = await service.prompt(target);
    expect(prompt.title).toBe("Capacity math");
    expect(JSON.stringify(prompt)).not.toContain("single primary database handles writes with room to spare");
  });

  it("a ready result on a queued drill moves it out 3 days, then 7, and the third closes it", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    expect(queued).toBeDefined();
    const t = { ...target, drillId: queued?.id };

    const first = await service.submit(t, ANSWER_READY);
    expect(first).toMatchObject({ outcome: "ready", readyCount: 1, closed: false, nextDueOn: "2026-11-06" });
    expect(first.next?.drill).toBe("deep_dive");

    clock = new Date(2026, 10, 6, 9, 0);
    const second = await service.submit(t, ANSWER_READY);
    expect(second).toMatchObject({ readyCount: 2, nextDueOn: "2026-11-13" });

    clock = new Date(2026, 10, 13, 9, 0);
    const third = await service.submit(t, ANSWER_READY);
    expect(third).toMatchObject({ readyCount: 3, closed: true, nextDueOn: null });
    expect(new Set(store.snapshot().items.find((i) => i.id === queued?.id)?.readyOn).size).toBe(3);
    expect((await service.summary()).queue.map((r) => r.drill)).toEqual(["deep_dive"]);
    await expect(service.submit(t, ANSWER_READY)).rejects.toMatchObject({ status: 404 });
  });

  it("a needs-work result resets the count and brings the drill back tomorrow", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    const t = { ...target, drillId: queued?.id };
    await service.submit(t, ANSWER_READY);
    clock = new Date(2026, 10, 6, 23, 30);
    const failed = await service.submit(t, "It is a big system.");
    expect(failed).toMatchObject({ outcome: "needs_work", readyCount: 0, closed: false, nextDueOn: "2026-11-07" });
    const row = (await service.summary()).queue.find((r) => r.id === queued?.id);
    expect(row).toMatchObject({ passes: 0, dueOn: "2026-11-07" });
  });

  it("a free drill that matches a queued one counts for it", async () => {
    const result = await service.submit(target, ANSWER_READY);
    expect(result.readyCount).toBe(1);
    const row = (await service.summary()).queue.find((r) => r.drill === "capacity");
    expect(row).toMatchObject({ passes: 1, dueOn: "2026-11-06", due: false });
  });

  it("a free drill with no queued match changes no schedule", async () => {
    const before = store.snapshot();
    await service.summary();
    const queuedBefore = store.snapshot().items;
    const result = await service.submit(
      { drill: "walk", problemId: "c2-url-shortener" },
      "The request goes to the load balancer, then the redirect service, then the cache, then the database.",
    );
    expect(result.readyCount).toBeNull();
    expect(result.nextDueOn).toBeNull();
    expect(store.snapshot().items).toEqual(queuedBefore);
    expect(before.items).toEqual([]);
    expect(store.snapshot().attempts).toHaveLength(1);
  });

  it("an attempt before the drill's day is logged and changes nothing, so a gap cannot close in one day", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    const t = { ...target, drillId: queued?.id };
    await service.submit(t, ANSWER_READY);
    const after = (await service.summary()).queue.find((r) => r.id === queued?.id);
    expect(after).toMatchObject({ passes: 1, dueOn: "2026-11-06", due: false });
    for (const again of [t, target]) {
      const early = await service.submit(again, ANSWER_READY);
      expect(early).toMatchObject({ outcome: "ready", readyCount: null, closed: false, nextDueOn: null });
    }
    expect((await service.summary()).queue.find((r) => r.id === queued?.id)).toMatchObject({ passes: 1, dueOn: "2026-11-06" });
    expect(store.snapshot().attempts).toHaveLength(3);
    expect(store.snapshot().attempts.filter((a) => a.drillId !== null)).toHaveLength(1);
  });

  it("a free drill counts for a queued one only when that one is due", async () => {
    clock = new Date(2026, 9, 30, 20, 0);
    const early = await service.submit(target, ANSWER_READY);
    expect(early.readyCount).toBeNull();
    expect((await service.summary()).queue.find((r) => r.drill === "capacity")).toMatchObject({ passes: 0, dueOn: "2026-10-31" });
    clock = new Date(2026, 9, 31, 8, 0);
    expect((await service.submit(target, ANSWER_READY)).readyCount).toBe(1);
  });

  it("rejects a second submit for a drill that is still being graded", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    const t = { ...target, drillId: queued?.id };
    const [a, b] = await Promise.allSettled([service.submit(t, ANSWER_READY), service.submit(t, ANSWER_READY)]);
    const statuses = [a, b].map((r) => (r.status === "rejected" ? (r.reason as HttpError).status : 200));
    expect(statuses.sort()).toEqual([200, 409]);
    expect((await service.summary()).queue.find((r) => r.id === queued?.id)?.passes).toBe(1);
    // The guard lifts once the grading ends.
    clock = new Date(2026, 10, 6, 9, 0);
    await expect(service.submit(t, ANSWER_READY)).resolves.toMatchObject({ readyCount: 2 });
  });

  it("refuses a blank answer with a clear message", async () => {
    await expect(service.submit(target, "  \n ")).rejects.toMatchObject({ status: 400, message: "Write an answer first." });
    expect(store.snapshot().attempts).toEqual([]);
  });

  it("shows the gap and the topic on a queued deep dive, with the topic the drill page uses", async () => {
    history = [
      round({
        gaps: [
          {
            title: "Batching click counts off the redirect path",
            goodLooksLike: "Consume events in batches.",
            whyItMatters: "One UPDATE per click locks a hot row.",
            severity: "high",
            done: false,
          },
        ],
      }),
    ];
    const row = (await service.summary()).queue[0];
    expect(row).toMatchObject({ drill: "deep_dive", gapTitle: "Batching click counts off the redirect path", topic: "Counting clicks without slowing redirects" });
    const prompt = await service.prompt({ drill: "deep_dive", problemId: "c2-url-shortener", drillId: row?.id });
    expect(prompt.topic).toBe(row?.topic);
    expect(prompt.task).toBe(row?.task);
  });

  it("records attempts for the week stats, free ones included", async () => {
    await service.submit({ drill: "walk", problemId: "c2-url-shortener" }, "load balancer then redirect service then cache then database then queue");
    await service.submit(target, ANSWER_READY);
    const summary = await service.summary();
    expect(summary.week.attempted).toBe(2);
    expect(summary.week.ready).toBeGreaterThanOrEqual(1);
    expect(store.snapshot().attempts.every((a) => a.day === localDay(clock))).toBe(true);
  });

  it("rejects a queued id that does not match the drill or problem", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    await expect(service.submit({ drill: "walk", problemId: "c2-url-shortener", drillId: queued?.id }, "x")).rejects.toMatchObject({ status: 404 });
    await expect(service.prompt({ ...target, drillId: "ffffffffffffffff" })).rejects.toBeInstanceOf(HttpError);
  });

  it("saves every attempt in full: the index row, the body file and the time taken", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    const result = await service.submit({ ...target, drillId: queued?.id }, ANSWER_READY, 95);
    expect(result.attemptId).toMatch(/^[a-f0-9]{16}$/);
    const row = store.snapshot().attempts[0];
    expect(row).toMatchObject({
      id: result.attemptId,
      status: "done",
      outcome: "ready",
      drillId: queued?.id,
      seconds: 95,
      legacy: false,
      variant: null,
      firstOutcome: null,
      revised: false,
      itemBefore: { passes: 0, readyOn: [] },
    });
    expect(row?.scores.map((x) => x.id)).toEqual(["picks_numbers", "math", "decisions", "assumptions"]);
    const body = await store.readBody(result.attemptId);
    expect(body).toMatchObject({
      id: result.attemptId,
      drill: "capacity",
      problemId: "c2-url-shortener",
      problemTitle: "URL Shortener",
      topic: null,
      turns: [],
    });
    expect(body?.answers).toEqual([{ at: row?.at, text: ANSWER_READY }]);
    expect(body?.grades).toHaveLength(1);
    expect(body?.grades[0]).toMatchObject({ outcome: "ready", scores: row?.scores, wentWell: result.wentWell, improve: result.improve, yourLine: result.yourLine });
    expect(body?.grades[0]?.strong.length).toBeGreaterThan(0);
    const free = await service.submit({ drill: "walk", problemId: "c2-url-shortener" }, "It is a big system.");
    expect(store.snapshot().attempts.find((a) => a.id === free.attemptId)).toMatchObject({ seconds: null, drillId: null });
  });

  it("stores a thin answer as needs_work", async () => {
    const result = await service.submit(target, "It is a big system.");
    expect(result.outcome).toBe("needs_work");
    expect(store.snapshot().attempts[0]?.outcome).toBe("needs_work");
    expect((await store.readBody(result.attemptId))?.grades[0]?.outcome).toBe("needs_work");
  });

  it("opens the attempt before the grader runs, and removes the row when the grader fails", async () => {
    let seen: ReturnType<DrillStore["snapshot"]>["attempts"] = [];
    let usage: unknown;
    const real = createFakeDriver({ chunkDelayMs: 0 });
    const spy = new DrillService({
      store,
      history: () => history,
      problems: stack.deps.problems,
      driver: {
        ...real,
        kind: "fake",
        startConversation: real.startConversation.bind(real),
        runOnce: async (setup) => {
          seen = store.snapshot().attempts;
          usage = setup.usage;
          return real.runOnce(setup);
        },
      },
      settings: stack.settings,
      prompts: stack.deps.prompts,
      guard: stack.deps.guard,
      log: stack.log,
      now: () => clock,
    });
    const result = await spy.submit(target, ANSWER_READY);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: result.attemptId, status: "open", outcome: null, seconds: null });
    expect(usage).toMatchObject({ sessionId: null, problemId: "c2-url-shortener", mode: null, drillAttemptId: result.attemptId, drillKind: "capacity" });
  });

  it("tells the candidate to retry when the grader fails, and records nothing", async () => {
    const failing = new DrillService({
      store,
      history: () => history,
      problems: stack.deps.problems,
      driver: {
        kind: "fake",
        startConversation: () => {
          throw new Error("unused");
        },
        runOnce: async () => {
          throw new Error("model is down");
        },
      },
      settings: stack.settings,
      prompts: stack.deps.prompts,
      guard: stack.deps.guard,
      log: stack.log,
      now: () => clock,
    });
    await expect(failing.submit(target, ANSWER_READY)).rejects.toMatchObject({ status: 502 });
    expect(store.snapshot().attempts).toEqual([]);
    const onDisk = JSON.parse(await readFile(join(stack.data, "drills.json"), "utf8")) as { attempts: unknown[] };
    expect(onDisk.attempts).toEqual([]);
  });

  it("remembers the proofs that gave a ready result, and forgets them when the count starts again", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    const t = { ...target, drillId: queued?.id };
    const readyOn = () => store.snapshot().items.find((i) => i.id === queued?.id)?.readyOn;
    expect(readyOn()).toEqual([]);
    await service.submit(t, ANSWER_READY);
    expect(readyOn()).toEqual(["c2-url-shortener"]);
    // An early attempt is practice and changes nothing.
    await service.submit(t, ANSWER_READY);
    expect(readyOn()).toEqual(["c2-url-shortener"]);
    clock = new Date(2026, 10, 6, 9, 0);
    await service.submit(t, ANSWER_READY);
    expect(readyOn()).toHaveLength(2);
    expect(readyOn()?.[0]).toBe("c2-url-shortener");
    expect(readyOn()?.[1]).toMatch(/^c2-url-shortener#[a-z0-9-]+$/);
    clock = new Date(2026, 10, 13, 9, 0);
    await service.submit({ ...target, drillId: (await service.summary()).queue.find((r) => r.drill === "deep_dive")?.id, drill: "deep_dive" }, "x");
    expect(readyOn()).toHaveLength(2);
    const item = store.snapshot().items.find((i) => i.id === queued?.id);
    expect(item?.passes).toBe(2);
    await service.submit(t, "It is a big system.");
    expect(readyOn()).toEqual([]);
    expect(store.snapshot().items.find((i) => i.id === queued?.id)).toMatchObject({ passes: 0, originProblemId: "c2-url-shortener" });
  });

  it("builds every drill kind on the problems it fits", async () => {
    history = [round(), round({ id: "20261030-1000-b3-parking-lot-abcd", problemId: "b3-parking-lot", track: "lld", gaps: [] })];
    for (const drill of DRILL_TYPES) {
      const problemId = drill === "lld_skeleton" ? "b3-parking-lot" : "c2-url-shortener";
      const prompt = await service.prompt({ drill, problemId });
      expect(prompt.minutes).toBe(drill === "deep_dive" || drill === "lld_skeleton" ? 15 : 10);
    }
  });
});

describe("revising a drill", () => {
  const THIN = "It is a big system.";
  const PARTLY = "The primary handles it.";

  async function queuedTarget() {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    return { ...target, drillId: queued?.id };
  }
  const itemOf = (id: string | undefined) => store.snapshot().items.find((i) => i.id === id);

  it("grades one revision, keeps the first scores and counts the better outcome", async () => {
    const t = await queuedTarget();
    const first = await service.submit(t, THIN, 40);
    expect(first).toMatchObject({ outcome: "needs_work", canRevise: true, revised: false, firstOutcome: null, readyCount: 0, nextDueOn: "2026-11-04" });
    const firstScores = store.snapshot().attempts[0]?.scores;

    const final = await service.revise(first.attemptId, ANSWER_READY, 55);
    expect(final).toMatchObject({ outcome: "ready", firstOutcome: "needs_work", revised: true, canRevise: false, readyCount: 1, closed: false, nextDueOn: "2026-11-05" });

    const row = store.snapshot().attempts[0];
    expect(row).toMatchObject({ outcome: "ready", firstOutcome: "needs_work", revised: true, seconds: 95 });
    expect(row?.scores).toEqual(firstScores);
    expect(itemOf(t.drillId)).toMatchObject({ passes: 1, dueOn: "2026-11-05", status: "open", readyOn: ["c2-url-shortener"] });

    const body = await store.readBody(first.attemptId);
    expect(body?.answers.map((a) => a.text)).toEqual([THIN, ANSWER_READY]);
    expect(body?.grades.map((g) => g.outcome)).toEqual(["needs_work", "ready"]);
  });

  it("never sends the strong line to the browser", async () => {
    const first = await service.submit(target, THIN);
    const final = await service.revise(first.attemptId, ANSWER_READY);
    const strong = (await store.readBody(first.attemptId))?.grades[0]?.strong ?? "";
    expect(strong.length).toBeGreaterThan(10);
    for (const result of [first, final]) {
      expect(Object.keys(result)).not.toContain("strong");
      expect(JSON.stringify(result)).not.toContain(strong);
    }
  });

  it("keeps the schedule when the revision is not better", async () => {
    const t = await queuedTarget();
    const first = await service.submit(t, PARTLY);
    expect(first).toMatchObject({ outcome: "getting_there", readyCount: 0, nextDueOn: "2026-11-05" });
    const before = itemOf(t.drillId);
    const final = await service.revise(first.attemptId, THIN);
    expect(final).toMatchObject({ outcome: "getting_there", firstOutcome: "getting_there", revised: true, nextDueOn: "2026-11-05" });
    expect(itemOf(t.drillId)).toEqual(before);
    expect(store.snapshot().attempts[0]).toMatchObject({ outcome: "getting_there", revised: true });
  });

  it("a ready result after a revision never closes the drill: the count stops at 2", async () => {
    const t = await queuedTarget();
    await service.submit(t, ANSWER_READY);
    clock = new Date(2026, 10, 6, 9, 0);
    await service.submit(t, ANSWER_READY);
    clock = new Date(2026, 10, 13, 9, 0);
    const first = await service.submit(t, PARTLY);
    expect(itemOf(t.drillId)).toMatchObject({ passes: 2, dueOn: "2026-11-15" });
    const final = await service.revise(first.attemptId, ANSWER_READY);
    expect(final).toMatchObject({ outcome: "ready", readyCount: 2, closed: false, nextDueOn: "2026-11-15" });
    expect(itemOf(t.drillId)).toMatchObject({ passes: 2, status: "open" });
  });

  it("a better revision restores the count and the ready list from the state before the attempt", async () => {
    const t = await queuedTarget();
    await service.submit(t, ANSWER_READY);
    clock = new Date(2026, 10, 6, 9, 0);
    const first = await service.submit(t, THIN);
    expect(itemOf(t.drillId)).toMatchObject({ passes: 0, readyOn: [], dueOn: "2026-11-07" });
    const final = await service.revise(first.attemptId, PARTLY);
    expect(final).toMatchObject({ outcome: "getting_there", readyCount: 1, nextDueOn: "2026-11-08" });
    expect(itemOf(t.drillId)).toMatchObject({ passes: 1, readyOn: ["c2-url-shortener"], dueOn: "2026-11-08", status: "open" });
  });

  it("a free drill that matched no queued one can be revised and changes no schedule", async () => {
    const free = { drill: "walk" as const, problemId: "c2-url-shortener" };
    const first = await service.submit(free, THIN);
    const itemsBefore = store.snapshot().items;
    const final = await service.revise(first.attemptId, "The load balancer sends the request to the redirect service, then the cache, then the database.");
    expect(final.revised).toBe(true);
    expect(final.readyCount).toBeNull();
    expect(final.nextDueOn).toBeNull();
    expect(store.snapshot().items).toEqual(itemsBefore);
  });

  it("clamps the total time to the schema maximum", async () => {
    const first = await service.submit(target, THIN, 7000);
    await service.revise(first.attemptId, ANSWER_READY, 7000);
    expect(store.snapshot().attempts[0]?.seconds).toBe(7200);
  });

  describe("refusals", () => {
    const pushRow = (id: string, over: Partial<ReturnType<DrillStore["snapshot"]>["attempts"][number]>) =>
      store.update((draft) => {
        draft.attempts.push({
          id,
          at: clock.toISOString(),
          day: localDay(clock),
          drill: "capacity",
          problemId: "c2-url-shortener",
          variant: null,
          drillId: null,
          status: "done",
          outcome: "needs_work",
          firstOutcome: null,
          revised: false,
          scores: [],
          seconds: null,
          legacy: false,
          ...over,
        });
        return { save: true, value: null };
      });

    it("404 for an unknown or malformed id", async () => {
      await expect(service.revise("0123456789abcdef", ANSWER_READY)).rejects.toMatchObject({ status: 404 });
      await expect(service.revise("../../outside", ANSWER_READY)).rejects.toMatchObject({ status: 404 });
    });

    it("400 for a blank answer", async () => {
      const first = await service.submit(target, THIN);
      await expect(service.revise(first.attemptId, "  ")).rejects.toMatchObject({ status: 400 });
    });

    it("409 for a legacy row", async () => {
      await pushRow("aaaaaaaaaaaaaaaa", { legacy: true });
      await expect(service.revise("aaaaaaaaaaaaaaaa", ANSWER_READY)).rejects.toMatchObject({ status: 409 });
    });

    it("409 for an attempt that is still open", async () => {
      await pushRow("bbbbbbbbbbbbbbbb", { status: "open", outcome: null });
      await expect(service.revise("bbbbbbbbbbbbbbbb", ANSWER_READY)).rejects.toMatchObject({ status: 409 });
    });

    it("409 for an attempt that was already revised", async () => {
      const first = await service.submit(target, THIN);
      await service.revise(first.attemptId, PARTLY);
      await expect(service.revise(first.attemptId, ANSWER_READY)).rejects.toMatchObject({ status: 409 });
    });

    it("409 for an attempt that is already ready", async () => {
      const first = await service.submit(target, ANSWER_READY);
      expect(first.canRevise).toBe(false);
      await expect(service.revise(first.attemptId, ANSWER_READY)).rejects.toMatchObject({ status: 409 });
    });

    it("409 on another day", async () => {
      const first = await service.submit(target, THIN);
      clock = new Date(2026, 10, 4, 9, 0);
      await expect(service.revise(first.attemptId, ANSWER_READY)).rejects.toMatchObject({ status: 409 });
      expect(store.snapshot().attempts[0]).toMatchObject({ revised: false, outcome: "needs_work" });
    });

    it("409 for a second revision sent while the first is being graded", async () => {
      const first = await service.submit(target, THIN);
      const [a, b] = await Promise.allSettled([service.revise(first.attemptId, ANSWER_READY), service.revise(first.attemptId, ANSWER_READY)]);
      const statuses = [a, b].map((r) => (r.status === "rejected" ? (r.reason as HttpError).status : 200));
      expect(statuses.sort()).toEqual([200, 409]);
    });
  });

  it("leaves everything as it was when the grader fails", async () => {
    const t = await queuedTarget();
    const first = await service.submit(t, THIN);
    const before = store.snapshot();
    const bodyBefore = await store.readBody(first.attemptId);
    const failing = new DrillService({
      store,
      history: () => history,
      problems: stack.deps.problems,
      driver: {
        kind: "fake",
        startConversation: () => {
          throw new Error("unused");
        },
        runOnce: async () => {
          throw new Error("model is down");
        },
      },
      settings: stack.settings,
      prompts: stack.deps.prompts,
      guard: stack.deps.guard,
      log: stack.log,
      now: () => clock,
    });
    await expect(failing.revise(first.attemptId, ANSWER_READY)).rejects.toMatchObject({ status: 502 });
    expect(store.snapshot()).toEqual(before);
    expect(await store.readBody(first.attemptId)).toEqual(bodyBefore);
    await expect(service.revise(first.attemptId, ANSWER_READY)).resolves.toMatchObject({ outcome: "ready" });
  });

  it("grades the revision against the same deep dive and passes the attempt id to usage", async () => {
    history = [
      round({
        gaps: [
          {
            title: "Batching click counts off the redirect path",
            goodLooksLike: "Consume events in batches.",
            whyItMatters: "One UPDATE per click locks a hot row.",
            severity: "high",
            done: false,
          },
        ],
      }),
    ];
    const real = createFakeDriver({ chunkDelayMs: 0 });
    const keys: string[] = [];
    const usage: unknown[] = [];
    const spy = new DrillService({
      store,
      history: () => history,
      problems: stack.deps.problems,
      driver: {
        ...real,
        kind: "fake",
        startConversation: real.startConversation.bind(real),
        runOnce: async (setup) => {
          keys.push(setup.fake?.drill?.key ?? "");
          usage.push(setup.usage);
          return real.runOnce(setup);
        },
      },
      settings: stack.settings,
      prompts: stack.deps.prompts,
      guard: stack.deps.guard,
      log: stack.log,
      now: () => clock,
    });
    const row = (await spy.summary()).queue[0];
    const first = await spy.submit({ drill: "deep_dive", problemId: "c2-url-shortener", drillId: row?.id }, THIN);
    // The first attempt moved the rotation on, so a rebuild without the saved topic could pick another dive.
    await spy.revise(first.attemptId, "Batch the click events and write the counts once a second, because one row per click makes a hot row.");
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(usage[1]).toMatchObject({ drillAttemptId: first.attemptId, drillKind: "deep_dive" });
  });
});

describe("repeating a drill on another problem", () => {
  const RATE = "20261031-0900-c2-rate-limiter-abcd";
  const played = (over: Partial<SessionHistoryItem> = {}) => round({ id: RATE, problemId: "c2-rate-limiter", title: "Rate Limiter", gaps: [], ...over });
  const queuedCapacity = async () => (await service.summary()).queue.find((r) => r.drill === "capacity");
  const itemOf = (id: string | undefined) => store.snapshot().items.find((i) => i.id === id);
  // The scripted grader scores by the words of the key, so a rate limiter answer repeats the brief's own capacity lines.
  const rateAnswer = () => (stack.deps.problems.get("c2-rate-limiter") as Problem).sections["Capacity math"] ?? "";

  function spyOn(keys: string[], before?: () => Promise<void>): DrillService {
    const real = createFakeDriver({ chunkDelayMs: 0 });
    return new DrillService({
      store,
      history: () => history,
      problems: stack.deps.problems,
      driver: {
        ...real,
        kind: "fake",
        startConversation: real.startConversation.bind(real),
        runOnce: async (setup) => {
          keys.push(setup.fake?.drill?.key ?? "");
          await before?.();
          return real.runOnce(setup);
        },
      },
      settings: stack.settings,
      prompts: stack.deps.prompts,
      guard: stack.deps.guard,
      log: stack.log,
      now: () => clock,
    });
  }

  it("saves another problem on the item with the schedule, and the row, prompt and submit read it", async () => {
    history = [round(), played()];
    const first = await queuedCapacity();
    expect(first).toMatchObject({ problemId: "c2-url-shortener", problemTitle: "URL Shortener", originProblemTitle: "URL Shortener", variantTitle: null });
    await service.submit({ ...target, drillId: first?.id }, ANSWER_READY);
    expect(itemOf(first?.id)).toMatchObject({ problemId: "c2-rate-limiter", variant: null, originProblemId: "c2-url-shortener", passes: 1, dueOn: "2026-11-06" });
    const row = await queuedCapacity();
    expect(row).toMatchObject({ problemId: "c2-rate-limiter", problemTitle: "Rate Limiter", originProblemTitle: "URL Shortener", variantTitle: null });
    const prompt = await service.prompt({ drill: "capacity", problemId: "c2-rate-limiter", drillId: first?.id });
    expect(prompt.problem.id).toBe("c2-rate-limiter");
    clock = new Date(2026, 10, 6, 9, 0);
    await service.submit({ drill: "capacity", problemId: "c2-rate-limiter", drillId: first?.id }, rateAnswer());
    expect(store.snapshot().attempts.at(-1)).toMatchObject({ problemId: "c2-rate-limiter", variant: null, drillId: first?.id });
    expect(itemOf(first?.id)).toMatchObject({ problemId: "c2-url-shortener", variant: null, readyOn: ["c2-url-shortener", "c2-rate-limiter"] });
  });

  it("closes on the third ready result once two problems gave ready results", async () => {
    history = [round(), played()];
    const first = await queuedCapacity();
    let last: Awaited<ReturnType<DrillService["submit"]>> | undefined;
    for (const day of [new Date(2026, 10, 3, 10), new Date(2026, 10, 6, 10), new Date(2026, 10, 13, 10)]) {
      clock = day;
      const row = (await service.summary()).queue.find((r) => r.id === first?.id);
      last = await service.submit({ drill: "capacity", problemId: row?.problemId ?? "", drillId: first?.id }, row?.problemId === "c2-rate-limiter" ? rateAnswer() : ANSWER_READY);
    }
    expect(last).toMatchObject({ readyCount: 3, closed: true });
    expect(itemOf(first?.id)?.status).toBe("closed");
  });

  it("asks a changed constraint when only one problem is playable, and sends the question", async () => {
    const first = await queuedCapacity();
    const t = { ...target, drillId: first?.id };
    await service.submit(t, ANSWER_READY);
    expect(itemOf(first?.id)).toMatchObject({ problemId: "c2-url-shortener", variant: "global-latency" });
    expect(await queuedCapacity()).toMatchObject({ problemId: "c2-url-shortener", variantTitle: "Global latency", originProblemTitle: "URL Shortener" });
    const prompt = await service.prompt(t);
    expect(prompt.variant).toEqual({ title: "Global latency" });
    expect(prompt.material.at(-1)?.heading).toBe("What changed");
    expect(prompt.material.at(-1)?.markdown).toContain("Asia see 400 ms redirects");
    expect(prompt.task).toContain("The load changed as below");
  });

  it("keeps the changed-constraint answer key out of every response and out of the saved body", async () => {
    const first = await queuedCapacity();
    const t = { ...target, drillId: first?.id };
    const one = await service.submit(t, ANSWER_READY);
    clock = new Date(2026, 10, 6, 9, 0);
    const prompt = await service.prompt(t);
    const second = await service.submit(t, "The primary handles it.");
    const revised = await service.revise(second.attemptId, ANSWER_READY);
    const summary = await service.summary();
    const body = JSON.stringify(await store.readBody(second.attemptId));
    for (const text of [prompt, one, second, revised, summary, JSON.parse(body)].map((x) => JSON.stringify(x))) {
      expect(text).not.toContain("regional caches and read replicas");
      expect(text).not.toContain("range allocation");
    }
    expect(JSON.parse(body)).toMatchObject({ changed: expect.stringContaining("Asia") as string });
    expect(store.snapshot().attempts.find((a) => a.id === second.attemptId)).toMatchObject({ variant: "global-latency", revised: true });
  });

  it("grades the first try and the revision on the same variant key", async () => {
    const keys: string[] = [];
    const spy = spyOn(keys);
    const first = (await spy.summary()).queue.find((r) => r.drill === "capacity");
    const t = { ...target, drillId: first?.id };
    await spy.submit(t, ANSWER_READY);
    clock = new Date(2026, 10, 6, 9, 0);
    const second = await spy.submit(t, "It is a big system.");
    await spy.revise(second.attemptId, ANSWER_READY);
    expect(keys).toHaveLength(3);
    expect(keys[0]).not.toContain("After the change");
    expect(keys[1]).toContain("After the change, a strong answer covers:\n");
    expect(keys[1]).toContain("regional caches and read replicas");
    expect(keys[2]).toBe(keys[1]);
  });

  it("answers 409 for a queued drill whose problem moved, and 404 for one that is not open", async () => {
    history = [round(), played()];
    const first = await queuedCapacity();
    await service.submit({ ...target, drillId: first?.id }, ANSWER_READY);
    const stale = { ...target, drillId: first?.id };
    await expect(service.prompt(stale)).rejects.toMatchObject({ status: 409, message: "This drill moved to another problem. Open it again from Practice." });
    await expect(service.submit(stale, ANSWER_READY)).rejects.toMatchObject({ status: 409 });
    await expect(service.prompt({ ...stale, drillId: "ffffffffffffffff" })).rejects.toMatchObject({ status: 404 });
  });

  it("takes the variant from the item, never from the request", async () => {
    const first = await queuedCapacity();
    await service.submit({ ...target, drillId: first?.id }, ANSWER_READY);
    const bad = { ...target, drillId: first?.id, variant: "cache-failure" } as typeof target;
    expect((await service.prompt(bad)).variant?.title).toBe("Global latency");
  });

  it("counts a free drill for a due item only when it matches the saved pick", async () => {
    history = [round(), played()];
    const first = await queuedCapacity();
    await service.submit({ ...target, drillId: first?.id }, ANSWER_READY);
    clock = new Date(2026, 10, 6, 9, 0);
    const wrong = await service.submit(target, ANSWER_READY);
    expect(wrong.readyCount).toBeNull();
    expect(itemOf(first?.id)?.passes).toBe(1);
    const right = await service.submit({ drill: "capacity", problemId: "c2-rate-limiter" }, rateAnswer());
    expect(right.readyCount).toBe(2);
  });

  it("never counts a free drill for an item whose pick is a changed constraint", async () => {
    const first = await queuedCapacity();
    await service.submit({ ...target, drillId: first?.id }, ANSWER_READY);
    clock = new Date(2026, 10, 6, 9, 0);
    const free = await service.submit(target, ANSWER_READY);
    expect(free).toMatchObject({ readyCount: null, nextDueOn: null });
    expect(itemOf(first?.id)).toMatchObject({ passes: 1, variant: "global-latency" });
    expect(store.snapshot().attempts.at(-1)?.variant).toBeNull();
    expect((await service.prompt(target)).variant).toBeUndefined();
  });

  it("picks again on the next read when the saved problem is no longer playable", async () => {
    history = [round(), played()];
    const first = await queuedCapacity();
    await service.submit({ ...target, drillId: first?.id }, ANSWER_READY);
    expect(itemOf(first?.id)?.problemId).toBe("c2-rate-limiter");
    history = [round()];
    expect((await queuedCapacity())?.problemId).toBe("c2-url-shortener");
    expect(itemOf(first?.id)).toMatchObject({ problemId: "c2-url-shortener", variant: "global-latency" });
    await expect(service.prompt({ drill: "capacity", problemId: "c2-rate-limiter", drillId: first?.id })).rejects.toMatchObject({ status: 409 });
  });

  it("does not count an attempt whose item moved while the grader worked", async () => {
    history = [round(), played()];
    const first = await queuedCapacity();
    const moving = spyOn([], async () => {
      await store.update((draft) => {
        const item = draft.items.find((i) => i.id === first?.id);
        if (item) item.problemId = "c2-rate-limiter";
        return { save: true, value: null };
      });
    });
    const result = await moving.submit({ ...target, drillId: first?.id }, ANSWER_READY);
    expect(result.readyCount).toBeNull();
    expect(itemOf(first?.id)).toMatchObject({ passes: 0, problemId: "c2-rate-limiter" });
    expect(store.snapshot().attempts[0]?.drillId).toBeNull();
  });
});
