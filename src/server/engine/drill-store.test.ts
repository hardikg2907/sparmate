import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttemptBodySchema, DrillStateSchema, DrillStore, emptyState, migrateV1, type AttemptBody, type DrillStateV1 } from "./drill-store";
import { memoryLogger } from "./log";

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "drill-store-"));
  path = join(dir, "drills.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const item = {
  id: "0123456789abcdef",
  sessionId: "20261030-0900-c2-url-shortener-abcd",
  problemId: "c2-url-shortener",
  gapTitle: "Capacity math",
  gapHint: "End each number with a decision.",
  drill: "capacity" as const,
  createdOn: "2026-10-31",
  dueOn: "2026-10-31",
  passes: 0,
  status: "open" as const,
};
const itemV2 = { ...item, originProblemId: item.problemId, variant: null, readyOn: [] as string[] };

const itemV1 = { ...item, passes: 2 };
const attemptV1 = (n: number, verdict: "pass" | "not_yet") => ({
  at: `2026-11-0${n}T09:00:00.000Z`,
  day: `2026-11-0${n}`,
  drill: "capacity" as const,
  problemId: "c2-url-shortener",
  drillId: n === 1 ? item.id : null,
  verdict,
});
const stateV1: DrillStateV1 = { version: 1, backfilledOn: "2026-11-01", items: [itemV1], attempts: [attemptV1(1, "pass"), attemptV1(2, "not_yet")] };

const BODY: AttemptBody = {
  version: 1,
  id: "aaaaaaaaaaaaaaaa",
  drill: "capacity",
  problemId: "c2-url-shortener",
  problemTitle: "URL Shortener",
  task: "Turn the numbers into decisions.",
  topic: null,
  answers: [{ at: "2026-11-03T10:00:00.000Z", text: "Reads are 4000 per second, so a cache." }],
  turns: [],
  grades: [
    {
      at: "2026-11-03T10:01:00.000Z",
      outcome: "ready",
      scores: [],
      wentWell: [],
      improve: ["Tie the last number to a decision."],
      yourLine: "Reads are 4000 per second",
      strong: "A cache sits in front.",
    },
  ],
};

describe("DrillStore", () => {
  it("starts empty when the file is missing", async () => {
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    expect(store.snapshot()).toEqual(emptyState());
  });

  it("loads a file saved before the marker existed, and one with the marker", async () => {
    await writeFile(path, JSON.stringify({ version: 2, items: [itemV2], attempts: [] }));
    const old = new DrillStore(path, memoryLogger());
    await old.load();
    expect(old.snapshot().backfilledOn).toBeUndefined();
    expect(old.snapshot().items).toHaveLength(1);
    await writeFile(path, JSON.stringify({ version: 2, backfilledOn: "2026-11-01", items: [], attempts: [] }));
    const marked = new DrillStore(path, memoryLogger());
    await marked.load();
    expect(marked.snapshot().backfilledOn).toBe("2026-11-01");
  });

  it("loads a valid file", async () => {
    await writeFile(path, JSON.stringify({ version: 2, items: [itemV2], attempts: [] }));
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    expect(store.snapshot().items).toEqual([itemV2]);
  });

  it("starts empty on a file that is not JSON, keeps a copy and does not throw", async () => {
    await writeFile(path, "{not json");
    const log = memoryLogger();
    const store = new DrillStore(path, log);
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.snapshot()).toEqual(emptyState());
    expect(await readFile(`${path}.bad`, "utf8")).toBe("{not json");
    expect(log.lines.some((l) => l.startsWith("WARN"))).toBe(true);
  });

  it.each([
    ["an unknown key", { version: 2, items: [], attempts: [], extra: 1 }],
    ["a wrong version", { version: 3, items: [], attempts: [] }],
    ["an item with a bad id", { version: 2, items: [{ ...itemV2, id: "../x" }], attempts: [] }],
    ["an item with an unknown drill", { version: 2, items: [{ ...itemV2, drill: "juggling" }], attempts: [] }],
    ["an item with four passes", { version: 2, items: [{ ...itemV2, passes: 4 }], attempts: [] }],
    ["an item with 51 ready problems", { version: 2, items: [{ ...itemV2, readyOn: Array.from({ length: 51 }, (_, n) => `p${n}`) }], attempts: [] }],
    ["a bad due day", { version: 2, items: [{ ...itemV2, dueOn: "tomorrow" }], attempts: [] }],
    ["a first-format file with an unknown key", { version: 1, items: [], attempts: [], extra: 1 }],
    ["a first-format item with a bad id", { version: 1, items: [{ ...itemV1, id: "../x" }], attempts: [] }],
  ])("starts empty on a file with %s", async (_name, body) => {
    expect(DrillStateSchema.safeParse(body).success).toBe(false);
    await writeFile(path, JSON.stringify(body));
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    expect(store.snapshot()).toEqual(emptyState());
  });

  it("saves a change and reloads it", async () => {
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    await store.update((draft) => {
      draft.items.push(itemV2);
      return { save: true, value: null };
    });
    const again = new DrillStore(path, memoryLogger());
    await again.load();
    expect(again.snapshot().items).toEqual([itemV2]);
  });

  it("saves the item state kept on an attempt row, and rejects unknown or oversized values in it", async () => {
    const row = {
      id: "aaaaaaaaaaaaaaaa",
      at: "2026-11-03T10:00:00.000Z",
      day: "2026-11-03",
      drill: "capacity" as const,
      problemId: "c2-url-shortener",
      variant: null,
      drillId: item.id,
      status: "done" as const,
      outcome: "needs_work" as const,
      firstOutcome: null,
      revised: false,
      scores: [{ id: "math", score: 1 }],
      seconds: 30,
      legacy: false,
    };
    const state = (attempt: object) => ({ version: 2, items: [], attempts: [attempt] });
    const kept = { ...row, itemBefore: { passes: 1, readyOn: ["c2-url-shortener"] } };
    expect(DrillStateSchema.safeParse(state(row)).success).toBe(true);
    expect(DrillStateSchema.safeParse(state(kept)).success).toBe(true);
    expect(DrillStateSchema.safeParse(state({ ...row, itemBefore: { passes: 1, readyOn: [], extra: 1 } })).success).toBe(false);
    expect(DrillStateSchema.safeParse(state({ ...row, itemBefore: { passes: 4, readyOn: [] } })).success).toBe(false);
    expect(DrillStateSchema.safeParse(state({ ...row, itemBefore: { passes: 1, readyOn: Array.from({ length: 51 }, () => "p") } })).success).toBe(false);
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    await store.update((draft) => {
      draft.attempts.push(kept);
      return { save: true, value: null };
    });
    const again = new DrillStore(path, memoryLogger());
    await again.load();
    expect(again.snapshot().attempts[0]?.itemBefore).toEqual({ passes: 1, readyOn: ["c2-url-shortener"] });
  });

  it("accepts a variant id and proof keys, and rejects a variant that is not a slug or a key that is too long", () => {
    const state = (over: object) => ({ version: 2, items: [{ ...itemV2, ...over }], attempts: [] });
    expect(DrillStateSchema.safeParse(state({ variant: "hot-link-10x", readyOn: ["c2-url-shortener", "c2-url-shortener#hot-link-10x"] })).success).toBe(true);
    for (const variant of ["Hot Link", "../etc", "a/b", "x".repeat(81), ""]) expect(DrillStateSchema.safeParse(state({ variant })).success, variant).toBe(false);
    expect(DrillStateSchema.safeParse(state({ readyOn: ["p".repeat(182)] })).success).toBe(false);
  });

  it("saves the changed-constraint question with an attempt body and caps it", async () => {
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    await store.writeBody({ ...BODY, changed: "Users in Asia see 400 ms redirects." });
    expect((await store.readBody(BODY.id))?.changed).toBe("Users in Asia see 400 ms redirects.");
    await expect(store.writeBody({ ...BODY, changed: "x".repeat(2001) })).rejects.toThrow();
  });

  it("does not write when a change says not to, and keeps the old state when the draft is invalid", async () => {
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    await store.update(() => ({ save: false, value: null }));
    await expect(readFile(path, "utf8")).rejects.toThrow();
    await expect(
      store.update((draft) => {
        draft.items.push({ ...itemV2, passes: 9 });
        return { save: true, value: null };
      }),
    ).rejects.toThrow();
    expect(store.snapshot().items).toEqual([]);
  });

  it("runs changes one after another", async () => {
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    await Promise.all(
      [1, 2, 3].map((n) =>
        store.update((draft) => {
          draft.items.push({ ...itemV2, id: `000000000000000${n}` });
          return { save: true, value: null };
        }),
      ),
    );
    expect(store.snapshot().items.map((i) => i.id)).toEqual(["0000000000000001", "0000000000000002", "0000000000000003"]);
  });

  it("keeps a file that matches neither format as .bad", async () => {
    const text = JSON.stringify({ version: 3, items: [], attempts: [] });
    await writeFile(path, text);
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    expect(await readFile(`${path}.bad`, "utf8")).toBe(text);
  });
});

describe("migrating the first file format", () => {
  it("fills the new item and attempt fields", () => {
    const v2 = migrateV1(stateV1);
    expect(v2.version).toBe(2);
    expect(v2.backfilledOn).toBe("2026-11-01");
    expect(v2.items).toEqual([{ ...itemV1, originProblemId: item.problemId, variant: null, readyOn: [item.problemId] }]);
    expect(migrateV1({ version: 1, items: [{ ...item, passes: 0 }], attempts: [] }).items[0]?.readyOn).toEqual([]);
    expect(v2.attempts.map((a) => [a.status, a.outcome, a.legacy, a.drillId])).toEqual([
      ["done", "ready", true, item.id],
      ["done", "needs_work", true, null],
    ]);
    for (const a of v2.attempts) {
      expect(a).toMatchObject({ firstOutcome: null, revised: false, scores: [], seconds: null, variant: null });
      expect(a.id).toMatch(/^[a-f0-9]{16}$/);
    }
    expect(new Set(v2.attempts.map((a) => a.id)).size).toBe(2);
    expect(migrateV1(stateV1)).toEqual(v2);
  });

  it("converts a file on load, keeps the original once and writes version 2", async () => {
    const original = JSON.stringify(stateV1, null, 2);
    await writeFile(path, original);
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    expect(store.snapshot().items).toHaveLength(1);
    expect(store.snapshot().attempts).toHaveLength(2);
    expect(await readFile(join(dir, "drills.v1.json"), "utf8")).toBe(original);
    const saved = DrillStateSchema.parse(JSON.parse(await readFile(path, "utf8")));
    expect(saved).toEqual(store.snapshot());
    expect(saved.version).toBe(2);
  });

  it("never overwrites an existing kept copy", async () => {
    await writeFile(join(dir, "drills.v1.json"), "first copy");
    await writeFile(path, JSON.stringify(stateV1));
    await new DrillStore(path, memoryLogger()).load();
    expect(await readFile(join(dir, "drills.v1.json"), "utf8")).toBe("first copy");
  });

  it("loads a version 2 file unchanged and writes no copy", async () => {
    const v2 = migrateV1(stateV1);
    const text = `${JSON.stringify(v2, null, 2)}\n`;
    await writeFile(path, text);
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    expect(store.snapshot()).toEqual(v2);
    expect(await readFile(path, "utf8")).toBe(text);
    await expect(readFile(join(dir, "drills.v1.json"), "utf8")).rejects.toThrow();
  });

  it("starts with the converted state when the writes fail", async () => {
    // A folder where the kept copy belongs makes both the read and the write fail.
    await mkdir(join(dir, "drills.v1.json"));
    await writeFile(path, JSON.stringify(stateV1));
    const log = memoryLogger();
    const store = new DrillStore(path, log);
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.snapshot().attempts).toHaveLength(2);
    expect(log.lines.some((l) => l.startsWith("WARN"))).toBe(true);
    expect(JSON.parse(await readFile(path, "utf8")).version).toBe(1);
  });
});

describe("attempt body files", () => {
  it("round-trips a body into a private folder", async () => {
    const store = new DrillStore(path, memoryLogger());
    await store.writeBody(BODY);
    expect(await store.readBody(BODY.id)).toEqual(BODY);
    expect(AttemptBodySchema.safeParse(JSON.parse(await readFile(join(dir, "drill-attempts", `${BODY.id}.json`), "utf8"))).success).toBe(true);
    expect((await stat(join(dir, "drill-attempts"))).mode & 0o777).toBe(0o700);
  });

  it("rejects an id that is not 16 hex characters before it builds a path", async () => {
    const store = new DrillStore(path, memoryLogger());
    for (const id of ["../drills", "AAAAAAAAAAAAAAAA", "aaaa", "aaaaaaaaaaaaaaaa/../x", ""]) {
      await expect(store.writeBody({ ...BODY, id })).rejects.toThrow();
      await expect(store.readBody(id)).resolves.toBeNull();
    }
  });

  it("returns null for a missing file, and for one with bad content, without throwing", async () => {
    const log = memoryLogger();
    const store = new DrillStore(path, log);
    await expect(store.readBody("bbbbbbbbbbbbbbbb")).resolves.toBeNull();
    await store.writeBody(BODY);
    const file = join(dir, "drill-attempts", `${BODY.id}.json`);
    await writeFile(file, "{not json");
    await expect(store.readBody(BODY.id)).resolves.toBeNull();
    await writeFile(file, JSON.stringify({ ...BODY, extra: 1 }));
    await expect(store.readBody(BODY.id)).resolves.toBeNull();
    await writeFile(file, JSON.stringify({ ...BODY, id: "cccccccccccccccc" }));
    await expect(store.readBody(BODY.id)).resolves.toBeNull();
    expect(log.lines.filter((l) => l.startsWith("WARN")).length).toBe(3);
  });

  it("refuses a body that breaks a bound", async () => {
    const store = new DrillStore(path, memoryLogger());
    await expect(store.writeBody({ ...BODY, answers: [BODY.answers[0]!, BODY.answers[0]!, BODY.answers[0]!] })).rejects.toThrow();
    await expect(store.writeBody({ ...BODY, answers: [{ at: "x", text: "y".repeat(8001) }] })).rejects.toThrow();
    await expect(store.writeBody({ ...BODY, turns: Array.from({ length: 9 }, () => ({ role: "grader" as const, at: "x", text: "y" })) })).rejects.toThrow();
  });
});
