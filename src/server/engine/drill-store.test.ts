import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrillStateSchema, DrillStore, emptyState } from "./drill-store";
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

describe("DrillStore", () => {
  it("starts empty when the file is missing", async () => {
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    expect(store.snapshot()).toEqual(emptyState());
  });

  it("loads a valid file", async () => {
    await writeFile(path, JSON.stringify({ version: 1, items: [item], attempts: [] }));
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    expect(store.snapshot().items).toEqual([item]);
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
    ["an unknown key", { version: 1, items: [], attempts: [], extra: 1 }],
    ["a wrong version", { version: 2, items: [], attempts: [] }],
    ["an item with a bad id", { version: 1, items: [{ ...item, id: "../x" }], attempts: [] }],
    ["an item with an unknown drill", { version: 1, items: [{ ...item, drill: "juggling" }], attempts: [] }],
    ["an item with four passes", { version: 1, items: [{ ...item, passes: 4 }], attempts: [] }],
    ["a bad due day", { version: 1, items: [{ ...item, dueOn: "tomorrow" }], attempts: [] }],
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
      draft.items.push(item);
      return { save: true, value: null };
    });
    const again = new DrillStore(path, memoryLogger());
    await again.load();
    expect(again.snapshot().items).toEqual([item]);
  });

  it("does not write when a change says not to, and keeps the old state when the draft is invalid", async () => {
    const store = new DrillStore(path, memoryLogger());
    await store.load();
    await store.update(() => ({ save: false, value: null }));
    await expect(readFile(path, "utf8")).rejects.toThrow();
    await expect(
      store.update((draft) => {
        draft.items.push({ ...item, passes: 9 });
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
          draft.items.push({ ...item, id: `000000000000000${n}` });
          return { save: true, value: null };
        }),
      ),
    );
    expect(store.snapshot().items.map((i) => i.id)).toEqual(["0000000000000001", "0000000000000002", "0000000000000003"]);
  });
});
