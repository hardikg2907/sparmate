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

  it("queues a drill per gap that has one, due the day after the debrief", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    expect(queueGapDrills(draft, history, problems())).toBe(true);
    expect(draft.items.map((i) => [i.drill, i.dueOn, i.passes, i.status])).toEqual([
      ["capacity", "2026-10-31", 0, "open"],
      ["deep_dive", "2026-10-31", 0, "open"],
    ]);
  });

  it("takes the day from the end time in local time, so a late debrief falls due the next local day", async () => {
    await stack.deps.problems.reload();
    const late = round({ endedAt: new Date(2026, 9, 30, 23, 50).toISOString() });
    const draft = emptyState();
    queueGapDrills(draft, [late], problems());
    expect(draft.items[0]?.dueOn).toBe("2026-10-31");
    const after = round({ id: "20261031-0001-c2-url-shortener-abcd", endedAt: new Date(2026, 9, 31, 0, 10).toISOString() });
    const next = emptyState();
    queueGapDrills(next, [after], problems());
    expect(next.items[0]?.dueOn).toBe("2026-11-01");
  });

  it("queues each gap once, and never from a round that is not debriefed", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    queueGapDrills(draft, history, problems());
    expect(queueGapDrills(draft, history, problems())).toBe(false);
    expect(draft.items).toHaveLength(2);
    const open = emptyState();
    expect(queueGapDrills(open, [round({ status: "live" }), round({ id: "x", status: "failed" })], problems())).toBe(false);
  });

  it("does not queue a second open drill for the same gap on the same problem", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    queueGapDrills(draft, [round(), round({ id: "20261101-0900-c2-url-shortener-zzzz" })], problems());
    expect(draft.items).toHaveLength(2);
  });

  it("queues drills from a gap-practice round too", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    queueGapDrills(draft, [round({ focus: true, mode: "guided" })], problems());
    expect(draft.items.length).toBeGreaterThan(0);
  });

  it("skips a gap whose problem no longer loads", () => {
    const draft = emptyState();
    expect(queueGapDrills(draft, history, new Map())).toBe(false);
  });

  it("uses the judge's drill, then the keywords, and queues nothing when none fits", async () => {
    await stack.deps.problems.reload();
    const draft = emptyState();
    queueGapDrills(draft, [round({ gaps: [{ title: "Totally unrelated words", goodLooksLike: "Be calm.", severity: "low", done: false, drill: "walk" }] })], problems());
    expect(draft.items.map((i) => i.drill)).toEqual(["walk"]);
    const none = emptyState();
    queueGapDrills(none, [round({ gaps: [{ title: "Totally unrelated words", goodLooksLike: "Be calm.", severity: "low", done: false }] })], problems());
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
    expect(playableProblems(all, [{ problemId: "b" }]).map((p) => p.meta.id)).toEqual(["b", "mine"]);
    expect(playableProblems(all, [])).toHaveLength(1);
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
    expect(summary.queue[0]?.task).toContain("Write one line each for");
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
