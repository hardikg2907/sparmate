import { mkdir, writeFile } from "node:fs/promises";
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

const ANSWER_PASS =
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

  it("a pass on a queued drill moves it out 3 days, then 7, and the third closes it", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    expect(queued).toBeDefined();
    const t = { ...target, drillId: queued?.id };

    const first = await service.submit(t, ANSWER_PASS);
    expect(first).toMatchObject({ verdict: "pass", passesInRow: 1, closed: false, nextDueOn: "2026-11-06" });
    expect(first.next?.drill).toBe("deep_dive");

    clock = new Date(2026, 10, 6, 9, 0);
    const second = await service.submit(t, ANSWER_PASS);
    expect(second).toMatchObject({ passesInRow: 2, nextDueOn: "2026-11-13" });

    clock = new Date(2026, 10, 13, 9, 0);
    const third = await service.submit(t, ANSWER_PASS);
    expect(third).toMatchObject({ passesInRow: 3, closed: true, nextDueOn: null });
    expect((await service.summary()).queue.map((r) => r.drill)).toEqual(["deep_dive"]);
    await expect(service.submit(t, ANSWER_PASS)).rejects.toMatchObject({ status: 404 });
  });

  it("a Not yet resets the count and brings the drill back tomorrow", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    const t = { ...target, drillId: queued?.id };
    await service.submit(t, ANSWER_PASS);
    clock = new Date(2026, 10, 6, 23, 30);
    const failed = await service.submit(t, "It is a big system.");
    expect(failed).toMatchObject({ verdict: "not_yet", passesInRow: 0, closed: false, nextDueOn: "2026-11-07" });
    const row = (await service.summary()).queue.find((r) => r.id === queued?.id);
    expect(row).toMatchObject({ passes: 0, dueOn: "2026-11-07" });
  });

  it("a free drill that matches a queued one counts for it", async () => {
    const result = await service.submit(target, ANSWER_PASS);
    expect(result.passesInRow).toBe(1);
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
    expect(result.passesInRow).toBeNull();
    expect(result.nextDueOn).toBeNull();
    expect(store.snapshot().items).toEqual(queuedBefore);
    expect(before.items).toEqual([]);
    expect(store.snapshot().attempts).toHaveLength(1);
  });

  it("an attempt before the drill's day is logged and changes nothing, so a gap cannot close in one day", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    const t = { ...target, drillId: queued?.id };
    await service.submit(t, ANSWER_PASS);
    const after = (await service.summary()).queue.find((r) => r.id === queued?.id);
    expect(after).toMatchObject({ passes: 1, dueOn: "2026-11-06", due: false });
    for (const again of [t, target]) {
      const early = await service.submit(again, ANSWER_PASS);
      expect(early).toMatchObject({ verdict: "pass", passesInRow: null, closed: false, nextDueOn: null });
    }
    expect((await service.summary()).queue.find((r) => r.id === queued?.id)).toMatchObject({ passes: 1, dueOn: "2026-11-06" });
    expect(store.snapshot().attempts).toHaveLength(3);
    expect(store.snapshot().attempts.filter((a) => a.drillId !== null)).toHaveLength(1);
  });

  it("a free drill counts for a queued one only when that one is due", async () => {
    clock = new Date(2026, 9, 30, 20, 0);
    const early = await service.submit(target, ANSWER_PASS);
    expect(early.passesInRow).toBeNull();
    expect((await service.summary()).queue.find((r) => r.drill === "capacity")).toMatchObject({ passes: 0, dueOn: "2026-10-31" });
    clock = new Date(2026, 9, 31, 8, 0);
    expect((await service.submit(target, ANSWER_PASS)).passesInRow).toBe(1);
  });

  it("rejects a second submit for a drill that is still being graded", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    const t = { ...target, drillId: queued?.id };
    const [a, b] = await Promise.allSettled([service.submit(t, ANSWER_PASS), service.submit(t, ANSWER_PASS)]);
    const statuses = [a, b].map((r) => (r.status === "rejected" ? (r.reason as HttpError).status : 200));
    expect(statuses.sort()).toEqual([200, 409]);
    expect((await service.summary()).queue.find((r) => r.id === queued?.id)?.passes).toBe(1);
    // The guard lifts once the grading ends.
    clock = new Date(2026, 10, 6, 9, 0);
    await expect(service.submit(t, ANSWER_PASS)).resolves.toMatchObject({ passesInRow: 2 });
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
    await service.submit(target, ANSWER_PASS);
    const summary = await service.summary();
    expect(summary.week.attempted).toBe(2);
    expect(summary.week.passed).toBeGreaterThanOrEqual(1);
    expect(store.snapshot().attempts.every((a) => a.day === localDay(clock))).toBe(true);
  });

  it("rejects a queued id that does not match the drill or problem", async () => {
    const queued = (await service.summary()).queue.find((r) => r.drill === "capacity");
    await expect(service.submit({ drill: "walk", problemId: "c2-url-shortener", drillId: queued?.id }, "x")).rejects.toMatchObject({ status: 404 });
    await expect(service.prompt({ ...target, drillId: "ffffffffffffffff" })).rejects.toBeInstanceOf(HttpError);
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
    await expect(failing.submit(target, ANSWER_PASS)).rejects.toMatchObject({ status: 502 });
    expect(store.snapshot().attempts).toEqual([]);
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
