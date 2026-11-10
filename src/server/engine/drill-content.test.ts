import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DRILL_TYPES } from "../../shared/drills";
import type { Problem } from "../../shared/problem";
import { APP_ROOT } from "./config";
import { buildDrill, deepDiveEntries, drillFits, drillsAvailable, matchDeepDive, pickDeepDive, scaleFacts, variantEntries } from "./drill-content";
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

  it("requirements sprint says nobody answers the questions in a drill", () => {
    const built = buildDrill(hld, "requirements");
    expect(built?.prompt.task).toBe(
      "Nobody answers here, so write each question with the answer or number you would assume. Split the requirements into what it does and how well it must do it, with the scale as numbers.",
    );
    expect(built?.prompt.answerHint).toContain("answer or number you would assume");
  });

  it("deep dive rebuilds the same topic from its title, whatever the rotation", () => {
    const first = buildDrill(hld, "deep_dive", { rotation: 0 });
    const topic = first?.prompt.topic ?? "";
    for (const rotation of [0, 1, 2, 3]) expect(buildDrill(hld, "deep_dive", { rotation, topic })?.key).toBe(first?.key);
    expect(buildDrill(hld, "deep_dive", { rotation: 1, topic: "No such topic" })?.prompt.topic).toBe(buildDrill(hld, "deep_dive", { rotation: 1 })?.prompt.topic);
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

describe("matchDeepDive", () => {
  const entries = [
    { title: "Generating unique short codes", text: "a" },
    { title: "Fast, highly available redirects", text: "b" },
  ];
  it("returns null when no word is shared, where the pick falls back to the rotation", () => {
    expect(matchDeepDive(entries, "Zzzz qqqq", "Nothing here")).toBeNull();
    expect(matchDeepDive(entries, "redirects are slow")?.title).toBe("Fast, highly available redirects");
    expect(pickDeepDive(entries, "Zzzz qqqq", "", 1)?.title).toBe("Fast, highly available redirects");
  });
  it("uses the reason when the title shares nothing", () => {
    expect(matchDeepDive(entries, "Zzzz", "unique codes")?.title).toBe("Generating unique short codes");
  });
});

function stubBrief(track: "hld" | "lld", sections: Record<string, string>): Problem {
  return { meta: { id: "stub-brief", track }, sections, body: "", file: "", custom: true } as unknown as Problem;
}

describe("variantEntries", () => {
  it("parses every shipped brief into at least one clean entry", () => {
    for (const problem of all) {
      const entries = variantEntries(problem);
      expect(entries.length, problem.meta.id).toBeGreaterThan(0);
      for (const entry of entries) {
        for (const text of [entry.title, entry.question]) {
          expect(text.toLowerCase(), `${problem.meta.id} ${entry.id}`).not.toContain("already seen");
          expect(text.toLowerCase(), `${problem.meta.id} ${entry.id}`).not.toContain("past session");
        }
        expect(entry.question, `${problem.meta.id} ${entry.id}`).not.toContain("Expect");
        expect(entry.expect.length).toBeGreaterThan(0);
        expect(entry.id).toMatch(/^[a-z0-9][a-z0-9-]{0,79}$/);
      }
      expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    }
    expect(all.filter((p) => p.meta.track === "hld")).toHaveLength(12);
    expect(all.filter((p) => p.meta.track === "lld")).toHaveLength(9);
  });

  it("reads the curveballs of a system design brief and skips a seen entry", () => {
    const entries = variantEntries(hld);
    expect(entries.map((e) => e.id)).toEqual(["hot-link-10x-load-on-one-key", "cache-failure", "global-latency"]);
    expect(entries[0]?.title).toBe("Hot link (10x load on one key)");
    expect(entries[0]?.question).toContain("A celebrity posts one of our links");
    expect(entries[0]?.expect).toContain("in-process cache");
    const limiter = variantEntries(all.find((p) => p.meta.id === "c2-rate-limiter") as Problem);
    expect(limiter.map((e) => e.id)).toEqual(["shard-failure", "second-region"]);
  });

  it("reads the extensions of a machine coding brief and skips the seen display boards", () => {
    expect(variantEntries(lld).map((e) => e.id)).toEqual(["electric-vehicle-charging", "weekend-and-night-rates"]);
  });

  it("keeps sub-bullet facts in the question and the checks in the key", () => {
    const lru = variantEntries(all.find((p) => p.meta.id === "b3-lru-cache") as Problem)[0];
    expect(lru?.question).toContain("What changes?");
    expect(lru?.question).toContain("Facts:");
    expect(lru?.question.trimEnd().endsWith("-")).toBe(false);
    expect(lru?.expect).toContain("Same:");
  });

  it("ignores notes before the first item, entries with no Expect: and entries with no bold title", () => {
    const brief = stubBrief("hld", {
      Curveballs: [
        "Use one. Expect: this note is for the interviewer.",
        "1. **Real one:** What now? Expect: a good answer.",
        "2. **No marker:** Just a question.",
        "3. A plain item with no title. Expect: nothing.",
        "4. **Used before (already used):** Question. Expect: x.",
      ].join("\n"),
    });
    expect(variantEntries(brief).map((e) => e.title)).toEqual(["Real one"]);
  });

  it("returns nothing when the section is missing and caps the entry count and the lengths", () => {
    expect(variantEntries(stubBrief("hld", {}))).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `${i + 1}. **Entry ${i}:** ${"q".repeat(5000)} Expect: ${"e".repeat(9000)}`).join("\n");
    const entries = variantEntries(stubBrief("hld", { Curveballs: many }));
    expect(entries.length).toBeLessThanOrEqual(8);
    expect(entries.every((e) => e.question.length <= 1500 && e.expect.length <= 4000 && e.title.length <= 120)).toBe(true);
  });

  it("stays fast on a huge odd line and gives one entry for repeated titles", () => {
    const odd = `1. **${"a".repeat(100000)}\n${" ".repeat(200000)}`;
    const started = Date.now();
    expect(variantEntries(stubBrief("hld", { Curveballs: odd }))).toEqual([]);
    expect(Date.now() - started).toBeLessThan(500);
    const twice = stubBrief("hld", { Curveballs: "1. **Same:** One? Expect: a.\n2. **Same!** Two? Expect: b." });
    expect(variantEntries(twice)).toHaveLength(1);
  });
});

describe("buildDrill with a variant", () => {
  const hot = "hot-link-10x-load-on-one-key";
  const kinds: [(typeof DRILL_TYPES)[number], string][] = [
    ["capacity", "Redo only the numbers that change"],
    ["walk", "after the change below"],
    ["requirements", "The interviewer adds the change below"],
    ["deep_dive", "what breaks first"],
    ["lld_skeleton", "The requirement below is new"],
  ];

  it.each(kinds)("%s: adds the What changed block, the tag, the task and the extra key", (drill, task) => {
    const problem = drill === "lld_skeleton" ? lld : hld;
    const entry = variantEntries(problem)[0];
    const normal = buildDrill(problem, drill);
    const built = buildDrill(problem, drill, { variant: entry?.id ?? "" });
    expect(built?.prompt.task).toContain(task);
    expect(built?.prompt.variant).toEqual({ title: entry?.title });
    expect(built?.prompt.material.at(-1)).toEqual({ heading: "What changed", markdown: entry?.question });
    if (drill !== "deep_dive") expect(built?.key.startsWith(normal?.key ?? "?")).toBe(true);
    expect(built?.key).toContain("After the change, a strong answer covers:\n");
    expect(built?.key).toContain(entry?.expect ?? "?");
    expect(built?.changed).toBe(entry?.question);
    expect(JSON.stringify(built?.prompt)).not.toContain(entry?.expect ?? "?");
    expect(built?.prompt.material.map((m) => m.heading)).not.toContain("The topic");
  });

  it("names the changed entry as the deep-dive topic and rebuilds the same key", () => {
    const a = buildDrill(hld, "deep_dive", { variant: hot, gapTitle: "Anything", rotation: 3 });
    const b = buildDrill(hld, "deep_dive", { variant: hot, topic: a?.prompt.topic });
    expect(a?.prompt.topic).toBe("Hot link (10x load on one key)");
    expect(b?.key).toBe(a?.key);
  });

  it("builds the normal drill for a variant id the brief does not have", () => {
    const normal = buildDrill(hld, "walk");
    const built = buildDrill(hld, "walk", { variant: "no-such-entry" });
    expect(built).toEqual(normal);
    expect(built?.prompt.variant).toBeUndefined();
  });
});
