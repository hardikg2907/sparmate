import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DRILL_TYPES } from "../../shared/drills";
import type { Problem } from "../../shared/problem";
import { APP_ROOT } from "./config";
import { buildDrill, deepDiveEntries, drillFits, drillsAvailable, pickDeepDive, scaleFacts } from "./drill-content";
import { memoryLogger } from "./log";
import { ProblemCatalog } from "./problems";

let hld: Problem;
let lld: Problem;
let all: Problem[];

beforeAll(async () => {
  const catalog = new ProblemCatalog([{ dir: join(APP_ROOT, "content", "problems"), custom: false, recursive: true }], memoryLogger());
  all = await catalog.reload();
  hld = catalog.get("c2-url-shortener") as Problem;
  lld = catalog.get("b3-parking-lot") as Problem;
});

describe("drill content from the shipped briefs", () => {
  it("builds every HLD drill for every shipped HLD problem, and the LLD skeleton for every LLD problem", () => {
    for (const problem of all) {
      const available = drillsAvailable(problem);
      for (const drill of available) {
        const built = buildDrill(problem, drill);
        expect(built?.key.length, `${problem.meta.id} ${drill}`).toBeGreaterThan(40);
        expect(built?.prompt.task.length).toBeGreaterThan(10);
      }
      if (problem.meta.track === "hld") expect(available, problem.meta.id).toEqual(["capacity", "walk", "requirements", "deep_dive"]);
      else expect(available, problem.meta.id).toEqual(["lld_skeleton"]);
    }
  });

  it("does not offer an HLD drill on an LLD problem or the reverse", () => {
    expect(drillFits(lld, "capacity")).toBe(false);
    expect(drillFits(hld, "lld_skeleton")).toBe(false);
    expect(buildDrill(lld, "walk")).toBeNull();
  });

  it("capacity math prompts with the numeric facts and keys on the Capacity math section", () => {
    const built = buildDrill(hld, "capacity");
    expect(built?.prompt.material.map((m) => m.heading)).toEqual(["The problem", "What you know"]);
    expect(built?.prompt.material[1]?.markdown).toContain("100 million");
    expect(built?.prompt.material[0]?.markdown).not.toMatch(/Where would you like to start/);
    expect(built?.key).toBe(hld.sections["Capacity math"]);
    expect(built?.prompt.task).toContain("which means");
    expect(built?.prompt.task).toContain("only the numbers that decide something");
    expect(scaleFacts(hld).every((f) => /\d/.test(f))).toBe(true);
  });

  it("never shows the answer key in the prompt", () => {
    for (const drill of DRILL_TYPES) {
      const problem = drill === "lld_skeleton" ? lld : hld;
      const built = buildDrill(problem, drill);
      expect(built).not.toBeNull();
      const shown = JSON.stringify(built?.prompt);
      const keyLines = (built?.key ?? "").split("\n").filter((l) => l.trim().length > 60);
      for (const line of keyLines) expect(shown, `${drill}: ${line.slice(0, 40)}`).not.toContain(line.trim());
    }
  });

  it("walk a request names the request from the reference design and keys on it", () => {
    const built = buildDrill(hld, "walk");
    expect(built?.prompt.task).toContain("Walk one redirect");
    expect(built?.key).toBe(hld.sections["Reference design"]);
  });

  it("requirements sprint shows only the opening prompt and keys on the expected requirements and the held-back facts", () => {
    const built = buildDrill(hld, "requirements");
    expect(built?.prompt.material).toHaveLength(1);
    expect(built?.key).toContain("Create a short link");
    expect(built?.key).toContain("100 million");
  });

  it("deep dive keys on one entry with its levels, matched to the gap", () => {
    const built = buildDrill(hld, "deep_dive", { gapTitle: "Counting clicks slows down every redirect" });
    expect(built?.prompt.task).toContain("Counting clicks without slowing redirects");
    expect(built?.key).toContain("**Bad:**");
    expect(built?.key).toContain("**Good:**");
    expect(built?.key).not.toContain("Generating unique short codes");
  });

  it("deep dive rotates through the entries for a free drill with no gap", () => {
    const tasks = new Set([0, 1, 2, 3].map((rotation) => buildDrill(hld, "deep_dive", { rotation })?.prompt.task));
    expect(tasks.size).toBe(deepDiveEntries(hld).length);
  });

  it("LLD skeleton prompts with the facts and keys on the entities and behaviour", () => {
    const built = buildDrill(lld, "lld_skeleton");
    expect(built?.prompt.material.map((m) => m.heading)).toEqual(["The problem", "What you know"]);
    expect(built?.key).toContain("`Ticket`");
    expect(built?.key).toContain("enter(type, time)");
    expect(built?.prompt.minutes).toBe(15);
  });
});

describe("deep dive for the real URL Shortener gaps", () => {
  it("matches caching and hot keys to the redirects entry and click counting to the clicks entry", () => {
    const entries = deepDiveEntries(hld);
    expect(pickDeepDive(entries, "Caching a viral link: TTLs, hot keys and stampede")?.title).toBe("Fast, highly available redirects");
    expect(pickDeepDive(entries, "Batching click counts off the redirect path")?.title).toBe("Counting clicks without slowing redirects");
  });

  it("lets the gap title beat a long reason that shares a word with another title", () => {
    const entries = deepDiveEntries(hld);
    const reason = "Short TTLs for spiky traffic make a viral key expire about 1,800 times an hour and each expiry sends a burst to the database.";
    expect(pickDeepDive(entries, "Caching a viral link: TTLs, hot keys and stampede", reason)?.title).toBe("Fast, highly available redirects");
  });

  it("reads the whole entry, not only its title", () => {
    const entries = [
      { title: "Alpha", text: "uses a bloom filter to skip lookups" },
      { title: "Beta", text: "plain" },
    ];
    expect(pickDeepDive(entries, "bloom filters")?.title).toBe("Alpha");
  });

  it("builds the same topic for the hero as the drill page when no word matches", () => {
    const a = buildDrill(hld, "deep_dive", { gapTitle: "Zzzz qqqq", rotation: 2 });
    const b = buildDrill(hld, "deep_dive", { gapTitle: "Zzzz qqqq", rotation: 2 });
    expect(a?.prompt.topic).toBeDefined();
    expect(a?.prompt.topic).toBe(b?.prompt.topic);
    expect(buildDrill(hld, "deep_dive", { rotation: 0 })?.prompt.topic).not.toBe(buildDrill(hld, "deep_dive", { rotation: 1 })?.prompt.topic);
  });
});

describe("pickDeepDive", () => {
  const entries = [
    { title: "Generating unique short codes", text: "a" },
    { title: "Fast, highly available redirects", text: "b" },
  ];
  it("prefers the entry that shares words with the hint", () => {
    expect(pickDeepDive(entries, "redirects are slow under load")?.title).toBe("Fast, highly available redirects");
  });
  it("falls back to the rotation and handles no entries", () => {
    expect(pickDeepDive(entries, "", "", 1)?.title).toBe("Fast, highly available redirects");
    expect(pickDeepDive(entries, "", "", 2)?.title).toBe("Generating unique short codes");
    expect(pickDeepDive([], "x")).toBeNull();
  });
});
