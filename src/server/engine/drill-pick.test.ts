import { describe, expect, it } from "vitest";
import type { DrillAttempt, DrillItem, DrillType } from "../../shared/drills";
import type { Problem } from "../../shared/problem";
import { migrateV1 } from "./drill-store";
import { canVaryFrom, isPickValid, pickNext, pickPool, repickStale } from "./drill-pick";
import { playableProblems } from "./drills";

const CURVEBALLS = (names: string[]) => names.map((n, i) => `${i + 1}. **${n}:** What now for ${n}? Expect: a plan for ${n}.`).join("\n");

function brief(id: string, over: { track?: "hld" | "lld"; curveballs?: string[]; deepDives?: string[]; walk?: boolean; custom?: boolean } = {}): Problem {
  const track = over.track ?? "hld";
  const sections: Record<string, string> = {};
  if (over.walk !== false) sections["Reference design"] = "Walk one request. A box, then another box.";
  if (over.deepDives) sections["Deep dives"] = over.deepDives.map((t) => `### ${t}\n- **Good:** something that works`).join("\n");
  const variants = over.curveballs ?? ["Spike", "Outage"];
  if (variants.length > 0) sections[track === "lld" ? "Extensions" : "Curveballs"] = `Use one.\n${CURVEBALLS(variants)}`;
  return { meta: { id, track, title: id }, sections, body: "", file: "", custom: over.custom ?? true } as unknown as Problem;
}

const mapOf = (...problems: Problem[]) => new Map(problems.map((p) => [p.meta.id, p] as const));

function item(over: Partial<DrillItem> = {}): DrillItem {
  return {
    id: "aaaaaaaaaaaaaaaa",
    sessionId: "s",
    problemId: "a",
    originProblemId: "a",
    variant: null,
    readyOn: [],
    gapTitle: "Walking one request",
    gapHint: "",
    drill: "walk",
    createdOn: "2026-11-01",
    dueOn: "2026-11-01",
    passes: 0,
    status: "open",
    ...over,
  };
}

function done(problemId: string, over: Partial<DrillAttempt> = {}): DrillAttempt {
  return {
    id: "bbbbbbbbbbbbbbbb",
    at: "2026-11-01T10:00:00.000Z",
    day: "2026-11-01",
    drill: "walk" as DrillType,
    problemId,
    variant: null,
    drillId: "aaaaaaaaaaaaaaaa",
    status: "done",
    outcome: "ready",
    firstOutcome: null,
    revised: false,
    scores: [],
    seconds: null,
    legacy: false,
    ...over,
  };
}

describe("pickPool", () => {
  it("holds the playable problems of the track that have the material for the kind", () => {
    const problems = mapOf(brief("a"), brief("b"), brief("no-walk", { walk: false }), brief("lld-one", { track: "lld" }));
    expect(
      pickPool(item(), problems)
        .map((p) => p.meta.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("needs a deep dive whose title shares a word with the gap's title", () => {
    const problems = mapOf(brief("a", { deepDives: ["Caching redirects"] }), brief("b", { deepDives: ["Sharding the counter"] }), brief("c"));
    const gap = item({ drill: "deep_dive", gapTitle: "Cache stampede on a viral link", gapHint: "Coalesce misses." });
    expect(pickPool(gap, problems).map((p) => p.meta.id)).toEqual(["a"]);
    expect(pickPool({ ...gap, gapTitle: "Zzzz", gapHint: "qqqq" }, problems)).toEqual([]);
  });

  it("never holds an unplayed library problem", () => {
    const library = { ...brief("lib", {}), custom: false } as Problem;
    const played = { ...brief("played", {}), custom: false } as Problem;
    const playable = new Map(playableProblems([library, played, brief("mine")], [{ problemId: "played", status: "debriefed" }]).map((p) => [p.meta.id, p] as const));
    expect(
      pickPool(item(), playable)
        .map((p) => p.meta.id)
        .sort(),
    ).toEqual(["mine", "played"]);
    expect(pickNext(item({ originProblemId: "lib", problemId: "lib" }), playable, [done("played")])?.problemId).not.toBe("lib");
  });
});

describe("pickNext", () => {
  it("starts on the origin problem", () => {
    const problems = mapOf(brief("a"), brief("b"));
    expect(pickNext(item({ originProblemId: "b", problemId: "b" }), problems, [])).toEqual({ problemId: "b", variant: null });
  });

  it("never repeats the problem of the last counted attempt while another fits", () => {
    const problems = mapOf(brief("a"), brief("b"), brief("c"));
    for (const last of ["a", "b", "c"]) {
      expect(pickNext(item(), problems, [done(last)])?.problemId).not.toBe(last);
    }
  });

  it("takes a problem the item never used before any it used", () => {
    const problems = mapOf(brief("a"), brief("b"), brief("c"));
    expect(pickNext(item(), problems, [done("a")])).toEqual({ problemId: "b", variant: null });
    expect(pickNext(item(), problems, [done("a"), done("b")])).toEqual({ problemId: "c", variant: null });
  });

  it("then takes the one used longest ago", () => {
    const problems = mapOf(brief("a"), brief("b"), brief("c"));
    const history = [done("a"), done("b"), done("c")];
    expect(pickNext(item(), problems, history)?.problemId).toBe("a");
    expect(pickNext(item(), problems, [...history, done("a")])?.problemId).toBe("b");
  });

  it("breaks a tie between unused problems on the fewest finished attempts of the kind, then the id", () => {
    const problems = mapOf(brief("a"), brief("b"), brief("c"));
    const others = { drillId: "cccccccccccccccc" };
    expect(pickNext(item(), problems, [done("a"), done("b", others), done("b", others), done("c", others)])?.problemId).toBe("c");
    expect(pickNext(item(), problems, [done("a")])?.problemId).toBe("b");
    const open = done("b", { status: "open", outcome: null });
    expect(pickNext(item(), problems, [done("a"), open, open])?.problemId).toBe("b");
    const otherKind = done("b", { drill: "capacity", ...others });
    expect(pickNext(item(), problems, [done("a"), otherKind, otherKind])?.problemId).toBe("b");
  });

  it("ignores attempts that counted for another item or for none", () => {
    const problems = mapOf(brief("a"), brief("b"));
    expect(pickNext(item(), problems, [done("b", { drillId: "cccccccccccccccc" }), done("b", { drillId: null })])).toEqual({ problemId: "a", variant: null });
  });

  it("stays on the problem with a changed constraint when the pool holds only that problem", () => {
    const problems = mapOf(brief("a", { curveballs: ["Spike", "Outage", "Region"] }));
    const first = pickNext(item(), problems, [done("a")]);
    expect(first).toEqual({ problemId: "a", variant: "region" });
    const second = pickNext(item(), problems, [done("a"), done("a", { variant: "region" })]);
    expect(second).toEqual({ problemId: "a", variant: "outage" });
    const third = pickNext(item(), problems, [done("a"), done("a", { variant: "region" }), done("a", { variant: "outage" })]);
    expect(third).toEqual({ problemId: "a", variant: "spike" });
    const again = pickNext(item(), problems, [done("a", { variant: "region" }), done("a", { variant: "outage" }), done("a", { variant: "spike" })]);
    expect(again).toEqual({ problemId: "a", variant: null });
  });

  it("alternates the plain problem and its one changed constraint, never the proof of the last attempt", () => {
    const problems = mapOf(brief("a", { curveballs: ["Spike"] }));
    expect(pickNext(item(), problems, [done("a")])).toEqual({ problemId: "a", variant: "spike" });
    expect(pickNext(item(), problems, [done("a"), done("a", { variant: "spike" })])).toEqual({ problemId: "a", variant: null });
    expect(pickNext(item(), problems, [done("a"), done("a", { variant: "spike" }), done("a")])).toEqual({ problemId: "a", variant: "spike" });
  });

  it("counts the proofs per problem and ignores attempts on other problems", () => {
    const problems = mapOf(brief("a", { curveballs: ["Spike", "Outage"] }));
    const other = done("zzz", { variant: "outage" });
    expect(pickNext(item(), problems, [other, other, done("a")])).toEqual({ problemId: "a", variant: "outage" });
  });

  it("prefers a capacity variant whose question holds a number", () => {
    const base = brief("a", { curveballs: [] });
    const withNumber = {
      ...base,
      sections: {
        ...base.sections,
        "Capacity math": "x",
        "Hidden facts": "- 5 per second",
        Curveballs: "1. **Wordy:** Is it slow? Expect: yes.\n2. **Numbers:** Load is 10x. Expect: more shards.\n3. **Also wordy:** What now? Expect: plan.",
      },
    } as Problem;
    expect(pickNext(item({ drill: "capacity" }), mapOf(withNumber), [done("a", { drill: "capacity" })])).toEqual({ problemId: "a", variant: "numbers" });
    const noNumber = {
      ...withNumber,
      sections: { ...withNumber.sections, Curveballs: "1. **Wordy:** Is it slow? Expect: yes.\n2. **Plain:** What now? Expect: plan." },
    } as Problem;
    expect(pickNext(item({ drill: "capacity" }), mapOf(noNumber), [done("a", { drill: "capacity" })])).toEqual({ problemId: "a", variant: "plain" });
  });

  it("repeats the same problem when the brief has no usable variant", () => {
    const problems = mapOf(brief("a", { curveballs: [] }));
    expect(pickNext(item(), problems, [done("a")])).toEqual({ problemId: "a", variant: null });
    expect(canVaryFrom(pickNext(item(), problems, [done("a")]), ["a"])).toBe(false);
  });

  it("repeats the plain problem for a deep dive whose topic no changed constraint fits", () => {
    const problems = mapOf(brief("a", { deepDives: ["Zzz"] }));
    const gap = item({ drill: "deep_dive", gapTitle: "Cache stampede" });
    expect(pickNext(gap, problems, [])).toEqual({ problemId: "a", variant: null });
    expect(pickNext(gap, problems, [done("a", { drill: "deep_dive" })])).toEqual({ problemId: "a", variant: null });
  });

  it("alternates a deep dive only between the changed constraints that fit its topic", () => {
    const problems = mapOf(brief("a", { deepDives: ["Spike handling"], curveballs: ["Spike", "Outage"] }));
    const gap = item({ drill: "deep_dive", gapTitle: "Spike handling under load" });
    expect(pickNext(gap, problems, [done("a", { drill: "deep_dive" })])).toEqual({ problemId: "a", variant: "spike" });
    expect(pickNext(gap, problems, [done("a", { drill: "deep_dive" }), done("a", { drill: "deep_dive", variant: "spike" })])).toEqual({ problemId: "a", variant: null });
  });

  it("keeps a pick that an open conversation still uses, and re-picks it once that ends", () => {
    const problems = mapOf(brief("a", { deepDives: ["Spike handling"], curveballs: ["Spike", "Outage"] }));
    const gap = item({ drill: "deep_dive", gapTitle: "Spike handling under load", problemId: "a", variant: "outage" });
    const open = done("a", { drill: "deep_dive", variant: "outage", status: "open" });
    const items = [{ ...gap }];
    expect(repickStale(items, [open], problems)).toBe(false);
    expect(items[0]?.variant).toBe("outage");
    expect(repickStale(items, [{ ...open, status: "done" }], problems)).toBe(true);
    expect(items[0]?.variant).not.toBe("outage");
  });

  it("re-picks a saved deep-dive variant that no longer fits the topic", () => {
    const problems = mapOf(brief("a", { deepDives: ["Spike handling"], curveballs: ["Spike", "Outage"] }));
    const gap = item({ drill: "deep_dive", gapTitle: "Spike handling under load", problemId: "a", variant: "outage" });
    expect(isPickValid(gap, problems)).toBe(false);
    expect(isPickValid({ ...gap, variant: "spike" }, problems)).toBe(true);
  });

  it("returns null when no playable problem fits at all", () => {
    expect(pickNext(item(), new Map(), [])).toBeNull();
    expect(pickNext(item(), mapOf(brief("a", { walk: false })), [done("a")])).toBeNull();
  });

  it("can vary only when the next pick asks a proof not yet earned", () => {
    expect(canVaryFrom({ problemId: "b", variant: null }, ["a"])).toBe(true);
    expect(canVaryFrom({ problemId: "a", variant: "x" }, ["a"])).toBe(true);
    expect(canVaryFrom({ problemId: "a", variant: "x" }, ["a", "a#x"])).toBe(false);
    expect(canVaryFrom({ problemId: "a", variant: null }, ["a"])).toBe(false);
    expect(canVaryFrom(null, ["a"])).toBe(false);
  });
});

describe("saved picks that go stale", () => {
  it("picks again when the saved problem is no longer playable", () => {
    const items = [item({ problemId: "gone", originProblemId: "a" })];
    expect(repickStale(items, [], mapOf(brief("a"), brief("b")))).toBe(true);
    expect(items[0]).toMatchObject({ problemId: "a", variant: null });
  });

  it("picks again when the saved problem no longer fits the drill", () => {
    const items = [item({ problemId: "a" })];
    expect(repickStale(items, [done("a")], mapOf(brief("a", { walk: false }), brief("b")))).toBe(true);
    expect(items[0]?.problemId).toBe("b");
  });

  it("picks again when the saved variant is no longer in the brief, and leaves a valid pick and a closed item alone", () => {
    const stale = item({ variant: "removed" });
    const fine = item({ id: "dddddddddddddddd", variant: "spike" });
    const closed = item({ id: "eeeeeeeeeeeeeeee", problemId: "gone", status: "closed" });
    const items = [stale, fine, closed];
    expect(repickStale(items, [], mapOf(brief("a")))).toBe(true);
    expect(stale.variant).toBeNull();
    expect(fine.variant).toBe("spike");
    expect(closed.problemId).toBe("gone");
    expect(repickStale(items, [], mapOf(brief("a")))).toBe(false);
  });

  it("moves an item off the proof of its last counted attempt when another can be offered", () => {
    const migrated = migrateV1({
      version: 1,
      items: [
        {
          id: "aaaaaaaaaaaaaaaa",
          sessionId: "s",
          problemId: "a",
          gapTitle: "Walking one request",
          gapHint: "",
          drill: "walk",
          createdOn: "2026-11-01",
          dueOn: "2026-11-01",
          passes: 1,
          status: "open",
        },
      ],
      attempts: [{ at: "2026-11-01T10:00:00.000Z", day: "2026-11-01", drill: "walk", problemId: "a", drillId: "aaaaaaaaaaaaaaaa", verdict: "pass" }],
    } as unknown as Parameters<typeof migrateV1>[0]);
    const problems = mapOf(brief("a"), brief("b"));
    expect(migrated.items[0]).toMatchObject({ problemId: "a", variant: null });
    expect(repickStale(migrated.items, migrated.attempts, problems)).toBe(true);
    expect(migrated.items[0]?.problemId).toBe("b");
    expect(repickStale(migrated.items, migrated.attempts, problems)).toBe(false);
  });

  it("leaves a pick on the last proof when nothing else can be offered", () => {
    const single = mapOf(brief("a", { curveballs: [] }));
    const items = [item()];
    expect(repickStale(items, [done("a")], single)).toBe(false);
    expect(items[0]).toMatchObject({ problemId: "a", variant: null });
  });

  it("keeps an item as it is when nothing playable fits", () => {
    const items = [item({ problemId: "gone" })];
    expect(repickStale(items, [], new Map())).toBe(false);
    expect(items[0]?.problemId).toBe("gone");
    expect(isPickValid(items[0] as DrillItem, new Map())).toBe(false);
  });
});
