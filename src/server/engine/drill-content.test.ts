import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DRILL_TYPES } from "../../shared/drills";
import type { Problem } from "../../shared/problem";
import { APP_ROOT } from "./config";
import {
  buildDrill,
  deepDiveEntries,
  drillFits,
  drillsAvailable,
  factOnly,
  interviewerNotesIn,
  matchDeepDive,
  matchTradeoff,
  pickDeepDive,
  pickTradeoff,
  scaleFacts,
  tradeoffEntries,
  variantEntries,
} from "./drill-content";
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
      if (problem.meta.track === "hld") expect(available, problem.meta.id).toEqual(["capacity", "walk", "requirements", "deep_dive", "tradeoff"]);
      else expect(available, problem.meta.id).toEqual(["tradeoff", "lld_skeleton"]);
    }
  });

  it("does not offer an HLD drill on an LLD problem or the reverse", () => {
    expect(drillFits(lld, "capacity")).toBe(false);
    expect(drillFits(hld, "lld_skeleton")).toBe(false);
    expect(buildDrill(lld, "walk")).toBeNull();
    expect(drillFits(hld, "tradeoff")).toBe(true);
    expect(drillFits(lld, "tradeoff")).toBe(true);
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
    for (const problem of [hld, lld]) {
      for (const drill of drillsAvailable(problem)) {
        const built = buildDrill(problem, drill);
        expect(built).not.toBeNull();
        const shown = JSON.stringify(built?.prompt);
        const keyLines = (built?.key ?? "").split("\n").filter((l) => l.trim().length > 60);
        for (const line of keyLines) expect(shown, `${drill}: ${line.slice(0, 40)}`).not.toContain(line.trim());
      }
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

describe("facts a drill shows", () => {
  it.each([
    ["an extensions bullet", "**Extensions:** undo, a second board. Do not mention them until the extension step.", null],
    ["an extensions bullet with no note", "**Extension:** undo.", null],
    ["a sentence that tells the interviewer what to hold back", "**Split types:** equal and exact. Do not mention weighted splits.", "**Split types:** equal and exact."],
    ["a sentence about the candidate", "**Names:** `open`, `close`. The names are the candidate's choice.", "**Names:** `open`, `close`."],
    ["an aside for the interviewer", "**Out of scope:** billing (do not volunteer it), a UI.", "**Out of scope:** billing, a UI."],
    ["an aside in the label", "**Cost (give only if asked):** storage is cheap.", "**Cost:** storage is cheap."],
    [
      "a note about what to accept",
      "**Callers:** code calls `send` directly. If they propose a queue, accept it, but do not require it.",
      "**Callers:** code calls `send` directly.",
    ],
    ["what to say when asked", "**Not now:** undo, replay. If they ask, say so and add nothing.", "**Not now:** undo, replay."],
  ])("drops %s", (_n, bullet, expected) => {
    expect(factOnly(bullet)).toBe(expected);
  });

  it("keeps the label when the sentence it opens is a note", () => {
    expect(factOnly("**Errors:** the candidate picks the style. A rejected call changes nothing.")).toBe("**Errors:** A rejected call changes nothing.");
  });

  it("drops a bullet with nothing left but its label", () => {
    expect(factOnly("**Style:** the candidate picks it.")).toBeNull();
  });

  it("keeps a plain fact, an aside that is part of it, and a rule for the candidate's code", () => {
    const fact = "**Time:** the caller passes minutes in (an int). Do not read the system clock.";
    expect(factOnly(fact)).toBe(fact);
  });

  it("finds no note to the interviewer inside any shipped fact bullet", () => {
    for (const problem of all) {
      for (const line of (problem.sections["Hidden facts"] ?? "").split("\n")) {
        const bullet = /^\s*[-*]\s+(.+)$/.exec(line)?.[1]?.trim();
        if (!bullet) continue;
        expect(factOnly(bullet), problem.meta.id).toBe(bullet);
        // Notes the backstop does not know must stay out of the bullets too, because the briefs are the writer's example.
        expect(bullet, problem.meta.id).not.toMatch(
          /\b(?:if asked|beyond a (?:one-line )?mention|one line (?:each )?is enough|if they (?:ask|add|propose|want)|the candidate|their choice|a good design|is a fine extra|allowed, not required|is the next step|accept (?:it|either|any))\b/i,
        );
      }
    }
  });

  it("never shows a line for the interviewer in a drill", () => {
    const elevator = all.find((p) => p.meta.id === "b3-elevator") as Problem;
    expect(elevator.sections["Hidden facts"]).toContain("For the interviewer:");
    for (const drill of ["lld_skeleton", "tradeoff"] as const) {
      expect(JSON.stringify(buildDrill(elevator, drill)?.prompt.material)).not.toContain("For the interviewer");
    }
  });

  it.each([
    ["a curly apostrophe", "**Replay:** not in scope. Don\u2019t mention replay.", "**Replay:** not in scope."],
    ["a note after an abbreviation", "**Splits:** equal and exact, e.g. three ways. Do not mention weighted splits.", "**Splits:** equal and exact, e.g. three ways."],
    ["a label that is a note", "**Interviewer note:** accept a queue if proposed.", null],
    ["a curveballs label", "**Curveballs:** a hot key later.", null],
    ["a fact after a quoted note", '**Moves:** if they ask, say "Not now." A move is final.', "**Moves:** A move is final."],
    ["a scenario note", "**Lapse:** a hold lapses after its day. Scenarios 1 to 4 check only that.", "**Lapse:** a hold lapses after its day."],
    ["a number held back", "**Load:** 5,000 reads a second. Never reveal the peak of 20,000.", "**Load:** 5,000 reads a second."],
    ["a note in the label", "**Numbers, if asked:** a node takes 5,000 writes.", "**Numbers:** a node takes 5,000 writes."],
    ["a note after etc", "**Channels:** email, SMS, etc. The candidate picks the order.", "**Channels:** email, SMS, etc."],
  ])("drops %s", (_n, bullet, expected) => {
    expect(factOnly(bullet)).toBe(expected);
  });

  it.each([
    "**Scale:** 10,000 writes a second (we do not count retries).",
    "**Riders:** any adult can ride (including volunteer drivers).",
    "**Guests:** guests do not require an account.",
    "**Gate:** a guard can let them in after 10 PM.",
    "**Extension numbers:** 4 digits each.",
    "**Bodies:** Accept only JSON bodies up to 1 MB.",
    "**Refunds:** Give no refund after 30 days.",
    "**Uploads:** images only (checked by file extension).",
    "**Note size:** up to 1 MB.",
  ])("keeps the real fact %s", (bullet) => {
    expect(factOnly(bullet)).toBe(bullet);
  });

  it("drops the indented bullets under a note", () => {
    const sections = { ...lld.sections, "Hidden facts": "- **Extensions:** later.\n  - undo\n  - replay\n- **Moves:** one per turn.\n  - a move is final" };
    const known = buildDrill({ ...lld, sections }, "lld_skeleton")?.prompt.material.find((m) => m.heading === "What you know")?.markdown ?? "";
    expect(known).toBe("- **Moves:** one per turn.\n- a move is final");
  });

  it("shows only facts in the capacity drill", () => {
    const sections = {
      ...hld.sections,
      "Hidden facts": "- **Load:** 5,000 reads a second. Do not mention the 20,000 peak.\n- **Spikes (give only if asked):** 3 times the average.",
    };
    const known = buildDrill({ ...hld, sections }, "capacity")?.prompt.material.find((m) => m.heading === "What you know")?.markdown ?? "";
    expect(known).toBe("- **Load:** 5,000 reads a second.\n- **Spikes:** 3 times the average.");
  });

  it("shows only facts under What you know in the machine coding drills", () => {
    const sections = {
      ...lld.sections,
      "Hidden facts": `${lld.sections["Hidden facts"] ?? ""}\n- **Extensions:** night rates, a second gate. Do not mention them until the extension step.\n- **Spots:** three sizes. The names are the candidate's choice.`,
    };
    const problem = { ...lld, sections };
    for (const drill of ["lld_skeleton", "tradeoff"] as const) {
      const known = buildDrill(problem, drill)?.prompt.material.find((m) => m.heading === "What you know")?.markdown ?? "";
      expect(known, drill).toContain("- **Spots:** three sizes.");
      expect(known, drill).not.toMatch(/Extensions|night rates|candidate/);
    }
  });
});

describe("trade-off content", () => {
  const withSection = (problem: Problem, name: string, text: string): Problem => ({ ...problem, sections: { ...problem.sections, [name]: text } });
  const sectionNames = (problem: Problem) => (problem.sections["Patterns that fit"] ?? "").split("**").filter((_, i) => i % 2 === 1);

  it.each(["c2-url-shortener", "c2-rate-limiter", "c2-chat-system"])("system design: %s has one topic per top-level bullet, each with a clean title", (id) => {
    const problem = all.find((p) => p.meta.id === id) as Problem;
    const entries = tradeoffEntries(problem);
    const bullets = (problem.sections["Accepted alternatives"] ?? "").split("\n").filter((l) => l.startsWith("- **"));
    expect(entries).toHaveLength(bullets.length);
    for (const entry of entries) {
      expect(entry.title.endsWith(".")).toBe(false);
      expect(entry.title).not.toContain("**");
      expect(entry.text.startsWith("- **")).toBe(true);
      expect(entry.text).toContain(entry.title);
    }
    const built = buildDrill(problem, "tradeoff");
    expect(built?.prompt.task).toBe(
      `The topic is "${entries[0]?.title}". Say what you would choose for this problem, give the reason from its requirements, and say what would make you choose differently.`,
    );
    expect(built?.key).toBe(entries[0]?.text);
    expect(built?.prompt.topic).toBe(entries[0]?.title);
    expect(built?.prompt.minutes).toBe(15);
  });

  it("keeps sub-bullets with their entry and reads the shipped URL Shortener titles", () => {
    const entries = tradeoffEntries(hld);
    expect(entries.map((e) => e.title)).toEqual(["Code generation", "Storage", "301 versus 302", "CDN caching of redirects"]);
    expect(entries[0]?.text).toContain("  - A key generation service that pre-creates codes");
    expect(entries[0]?.text).not.toContain("Postgres with replicas");
    expect(entries[2]?.text.startsWith("- **301 versus 302.**")).toBe(true);
  });

  it("picks the entry that best matches the gap, and rotates with no match", () => {
    const storage = buildDrill(hld, "tradeoff", { gapTitle: "Storage choice made without a reason" });
    expect(storage?.prompt.topic).toBe("Storage");
    const codes = buildDrill(hld, "tradeoff", { gapTitle: "Code generation scheme was never justified" });
    expect(codes?.prompt.topic).toBe("Code generation");
    const rotated = [0, 1, 2, 3, 4].map((rotation) => buildDrill(hld, "tradeoff", { gapTitle: "Zzzz qqqq", rotation })?.prompt.topic);
    expect(rotated).toEqual(["Code generation", "Storage", "301 versus 302", "CDN caching of redirects", "Code generation"]);
  });

  it("rebuilds the same topic and key from the saved title, whatever the rotation", () => {
    const first = buildDrill(hld, "tradeoff", { rotation: 2 });
    for (const rotation of [0, 1, 3]) expect(buildDrill(hld, "tradeoff", { rotation, topic: first?.prompt.topic })?.key).toBe(first?.key);
  });

  it("a problem fits with one entry and needs no title match with the gap", () => {
    const one = withSection(hld, "Accepted alternatives", "- **Only choice.** Either is fine.");
    expect(drillFits(one, "tradeoff")).toBe(true);
    expect(buildDrill(one, "tradeoff", { gapTitle: "Nothing in common" })?.prompt.topic).toBe("Only choice");
    expect(drillFits(withSection(hld, "Accepted alternatives", ""), "tradeoff")).toBe(false);
    expect(drillFits(withSection(hld, "Accepted alternatives", "Plain words with no bullets."), "tradeoff")).toBe(false);
    expect(drillFits(withSection(lld, "Patterns that fit", ""), "tradeoff")).toBe(false);
  });

  it("skips a bullet with no bold lead, and ends an entry at the next top-level bullet", () => {
    const text = ["- No lead here.", "  - and a note", "- **First.** One.", "  - sub a", "", "  - sub b", "- plain again", "  - orphan", "* **Second:** Two."].join("\n");
    const entries = tradeoffEntries(withSection(hld, "Accepted alternatives", text));
    expect(entries.map((e) => e.title)).toEqual(["First", "Second"]);
    expect(entries[0]?.text).toBe("- **First.** One.\n  - sub a\n\n  - sub b");
    expect(entries[1]?.text).toBe("* **Second:** Two.");
  });

  it("caps the entries and their lengths, and stays fast on a long odd line", () => {
    const many = Array.from({ length: 60 }, (_, i) => `- **Entry ${i}.** ${"x".repeat(9000)}`).join("\n");
    const entries = tradeoffEntries(withSection(hld, "Accepted alternatives", many));
    expect(entries.length).toBeLessThanOrEqual(30);
    for (const e of entries) expect(e.text.length).toBeLessThanOrEqual(6000);
    const started = Date.now();
    tradeoffEntries(withSection(hld, "Accepted alternatives", `- **${"a. ".repeat(20000)}`));
    tradeoffEntries(withSection(hld, "Accepted alternatives", `- ****${" ".repeat(30000)}`));
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("matchTradeoff and pickTradeoff handle no entries and no match", () => {
    expect(matchTradeoff([], "anything")).toBeNull();
    expect(pickTradeoff([], "anything")).toBeNull();
    const entries = tradeoffEntries(hld);
    expect(matchTradeoff(entries, "Zzzz qqqq")).toBeNull();
    expect(pickTradeoff(entries, "Zzzz qqqq", -3)?.title).toBe("CDN caching of redirects");
  });

  it.each(["b3-parking-lot", "b3-vending-machine", "b3-lru-cache"])("machine coding: %s asks for the patterns without naming one", (id) => {
    const problem = all.find((p) => p.meta.id === id) as Problem;
    const built = buildDrill(problem, "tradeoff");
    expect(built?.prompt.task).toBe("Name the design patterns you would use in this problem and the ones you would leave out, each with the reason from the requirements.");
    expect(built?.prompt.topic).toBeUndefined();
    expect(built?.key).toBe((problem.sections["Patterns that fit"] ?? "").trim());
    const shown = JSON.stringify(built?.prompt).toLowerCase();
    const names = sectionNames(problem).map((n) => n.replace(/[:.]+$/, "").toLowerCase());
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(shown, name).not.toContain(name);
    for (const word of ["strategy", "observer", "singleton", "factory", "state pattern"]) expect(shown, word).not.toContain(word);
  });

  it("machine coding shows the problem and its facts, and keys on the whole section for every shipped brief", () => {
    for (const problem of all.filter((p) => p.meta.track === "lld")) {
      const built = buildDrill(problem, "tradeoff");
      expect(
        built?.prompt.material.map((m) => m.heading),
        problem.meta.id,
      ).toEqual(["The problem", "What you know"]);
      expect(built?.prompt.material[1]?.markdown, problem.meta.id).toBe(buildDrill(problem, "lld_skeleton")?.prompt.material[1]?.markdown);
      expect(built?.key, problem.meta.id).toBe((problem.sections["Patterns that fit"] ?? "").trim());
    }
  });

  it("the system design variant names the alternative the change touches, and keys on the section plus the expected answer", () => {
    const entry = variantEntries(hld)[0];
    const built = buildDrill(hld, "tradeoff", { variant: entry?.id ?? "" });
    expect(built?.prompt.topic).toBe("CDN caching of redirects");
    expect(built?.prompt.task).toBe(
      'Your choice was about "CDN caching of redirects". The situation changed as below. Say whether you keep that choice or change it, and defend it.',
    );
    expect(built?.prompt.answerHint).toBe("Say whether you keep the choice or change it, and give the reason from the change.");
    expect(built?.prompt.variant).toEqual({ id: entry?.id, title: entry?.title });
    expect(built?.key).toBe(`${(hld.sections["Accepted alternatives"] ?? "").trim()}\n\nAfter the change, a strong answer covers:\n${entry?.expect}`);
    expect(built?.prompt.material.map((m) => m.heading)).toEqual(["The problem", "What changed"]);
    expect(built?.prompt.material.at(-1)).toEqual({ heading: "What changed", markdown: entry?.question });
    expect(JSON.stringify(built?.prompt)).not.toContain(entry?.expect ?? "?");
  });

  it("the system design variant falls back to the first alternative when no title shares a word with the change", () => {
    const odd = withSection(hld, "Curveballs", '1. **Zzzz change:** "Qqqq wwww eeee?" Expect: something.');
    const entry = variantEntries(odd)[0];
    expect(buildDrill(odd, "tradeoff", { variant: entry?.id ?? "" })?.prompt.topic).toBe("Code generation");
  });

  it("the machine coding variant asks which patterns the new requirement adds or drops, with the facts shown", () => {
    const entry = variantEntries(lld)[0];
    const built = buildDrill(lld, "tradeoff", { variant: entry?.id ?? "" });
    expect(built?.prompt.task).toBe("The requirement below is new. Say which patterns you would use or drop now, each with the reason.");
    expect(built?.prompt.answerHint).toBe("Name the patterns you would use or drop after the new requirement, each with the reason.");
    expect(built?.prompt.topic).toBeUndefined();
    expect(built?.prompt.material.map((m) => m.heading)).toEqual(["The problem", "What you know", "What changed"]);
    expect(built?.key).toBe(`${(lld.sections["Patterns that fit"] ?? "").trim()}\n\nAfter the change, a strong answer covers:\n${entry?.expect}`);
    expect(JSON.stringify(built?.prompt)).not.toContain(entry?.expect ?? "?");
  });

  it("does not offer a catch-all bullet as a topic", () => {
    const text = ["- **Smaller choices.** Relay, webhooks.", "- **Other choices: queue and store.** Mixed.", "- **Message broker.** Kafka or SQS."].join("\n");
    expect(tradeoffEntries(withSection(hld, "Accepted alternatives", text)).map((e) => e.title)).toEqual(["Message broker"]);
  });

  it("matches a trade-off by the title only: common words and the entry text never decide", () => {
    const entries = tradeoffEntries(
      withSection(
        hld,
        "Accepted alternatives",
        ["- **Message broker.** Fine without a reason, an option, a choice or a design that is picked.", "- **Storage engine.** Explain the reason without fuss."].join("\n"),
      ),
    );
    expect(matchTradeoff(entries, "Picked the design without a reason")).toBeNull();
    expect(matchTradeoff(entries, "Option and choice explained without a reason")).toBeNull();
    expect(matchTradeoff(entries, "No storage reasoning")?.title).toBe("Storage engine");
    // The reason a gap matters is not read at all.
    expect(buildDrill(hld, "tradeoff", { gapTitle: "Chose something", hint: "storage", rotation: 1 })?.prompt.topic).toBe("Storage");
  });

  it("rotates on the count it is given when no title matches", () => {
    const topics = [0, 1].map((rotation) => buildDrill(hld, "tradeoff", { gapTitle: "Chose something without a reason", rotation })?.prompt.topic);
    expect(topics).toEqual(["Code generation", "Storage"]);
  });
});

describe("deep dive for the real URL Shortener gaps", () => {
  it("matches redirect and click gaps to the entry whose title names them", () => {
    const entries = deepDiveEntries(hld);
    expect(pickDeepDive(entries, "Making redirects fast under a viral link")?.title).toBe("Fast, highly available redirects");
    expect(pickDeepDive(entries, "Batching click counts off the redirect path")?.title).toBe("Counting clicks without slowing redirects");
  });

  it("lets the gap title beat a long reason that shares a word with another title", () => {
    const entries = deepDiveEntries(hld);
    const reason = "Short expiry for spiky traffic makes a viral key expire about 1,800 times an hour and each expiry sends a burst to the database.";
    expect(pickDeepDive(entries, "Fast redirects for a viral link", reason)?.title).toBe("Fast, highly available redirects");
  });

  it("uses the entry's text to rank entries whose titles match, never to admit one", () => {
    const entries = [
      { title: "Alpha cache", text: "plain notes about the layout." },
      { title: "Beta cache", text: "It uses a bloom filter to skip lookups. A filter removes most misses." },
      { title: "Gamma", text: "A bloom filter also fits here. Bloom filters are cheap." },
    ];
    expect(matchDeepDive(entries, "Cache bloom filters")?.title).toBe("Beta cache");
    expect(matchDeepDive(entries, "Bloom filters")).toBeNull();
  });

  it("does not admit an unrelated gap through words in a long entry text", () => {
    const entries = [
      {
        title: "Choosing the algorithm and what it costs",
        text: "Compare fixed windows with token buckets. A bucket tracks tokens per client. Each request takes one token, and a driver for the cell lookup is not needed here. Sizing the store follows from the client count.",
      },
      {
        title: "Redis slow or down",
        text: "When the store is slow, fail open for most clients. The lookup adds latency. Cell phones on a slow network retry, and a driver of load is the retry storm.",
      },
    ];
    expect(matchDeepDive(entries, "Geohash cell sizing for driver lookup", "Cells too large return too many drivers, so a lookup is slow.")).toBeNull();
  });

  it("matches none of three shipped briefs for a gap about another topic", () => {
    const gap = "Geohash cell sizing for driver lookup";
    const hint = "Cells that are too large return too many drivers, and a lookup that scans them is slow.";
    for (const id of ["c2-rate-limiter", "c2-url-shortener", "c2-chat-system"]) {
      const entries = deepDiveEntries(all.find((p) => p.meta.id === id) as Problem);
      expect(entries.length, id).toBeGreaterThan(0);
      expect(matchDeepDive(entries, gap, hint), id).toBeNull();
    }
  });

  it("reads only a bounded part of a very long Deep dives section, and a heading with no title is not an entry", () => {
    const long = `### Real\nbody\n### \n${"x".repeat(200000)}\n### Late\nlate`;
    const entries = deepDiveEntries(stubBrief("hld", { "Deep dives": long }));
    expect(entries.map((e) => e.title)).toEqual(["Real"]);
    const started = Date.now();
    deepDiveEntries(stubBrief("hld", { "Deep dives": `### ${" ".repeat(300000)}a` }));
    expect(Date.now() - started).toBeLessThan(500);
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
  it("returns null when no title word is shared, where the pick falls back to the rotation", () => {
    expect(matchDeepDive(entries, "Zzzz qqqq", "Nothing here")).toBeNull();
    expect(matchDeepDive(entries, "redirects are slow")?.title).toBe("Fast, highly available redirects");
    expect(pickDeepDive(entries, "Zzzz qqqq", "", 1)?.title).toBe("Fast, highly available redirects");
  });
  it("never admits an entry through the reason alone", () => {
    expect(matchDeepDive(entries, "Zzzz", "unique codes")).toBeNull();
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

  it("reads the curveballs of a system design brief", () => {
    const entries = variantEntries(hld);
    expect(entries.map((e) => e.id)).toEqual(["hot-link", "cache-failure", "global-latency"]);
    expect(entries[0]?.title).toBe("Hot link");
    expect(entries[0]?.question).toContain("A celebrity posts one of our links");
    expect(entries[0]?.expect).toContain("in-process cache");
    const limiter = variantEntries(all.find((p) => p.meta.id === "c2-rate-limiter") as Problem);
    expect(limiter.map((e) => e.id)).toEqual(["hot-client", "shard-failure", "second-region"]);
  });

  it("reads the extensions of a machine coding brief", () => {
    expect(variantEntries(lld).map((e) => e.id)).toEqual(["electric-vehicle-charging", "weekend-and-night-rates", "display-boards"]);
  });

  it("skips an entry marked as one the candidate has already met", () => {
    const brief = stubBrief("hld", {
      Curveballs: [
        "1. **Seen one (already seen):** What now? Expect: a plan.",
        "2. **Old one (used in an earlier session):** What now? Expect: a plan.",
        "3. **Fresh one:** What now? Expect: a plan.",
      ].join("\n"),
    });
    expect(variantEntries(brief).map((e) => e.id)).toEqual(["fresh-one"]);
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

  it("drops a closing note from the title and skips an entry whose title says Expect", () => {
    const brief = stubBrief("hld", {
      Curveballs: [
        "1. **Dispense failure (close to the maintenance mode they saw):** What now? Expect: a plan.",
        "2. **Nested (a (b)):** Two? Expect: b.",
        "3. **(Only a note):** Three? Expect: c.",
        "4. **Expect the unexpected:** Four? Expect: d.",
      ].join("\n"),
    });
    expect(variantEntries(brief).map((e) => [e.id, e.title])).toEqual([
      ["dispense-failure", "Dispense failure"],
      ["nested", "Nested"],
      ["only-a-note", "(Only a note)"],
    ]);
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

describe("shipped variant questions", () => {
  it("variant questions hold no interviewer notes", () => {
    for (const problem of all) {
      for (const entry of variantEntries(problem)) {
        expect(interviewerNotesIn(entry.question), `${problem.meta.id} ${entry.id}`).toEqual([]);
      }
    }
  });
});

describe("interviewerNotesIn", () => {
  it("finds each note phrase in any case and passes a clean question", () => {
    expect(interviewerNotesIn("What does The Candidate do? Pick another. They saw it.")).toEqual(["the candidate", "pick another", "they saw"]);
    expect(interviewerNotesIn("Redis is down at peak. What breaks first?")).toEqual([]);
    for (const phrase of ["the candidate", "is also accepted", "are accepted", "pick another", "state this when", "they saw"]) {
      expect(interviewerNotesIn(`x ${phrase.toUpperCase()} y`)).toEqual([phrase]);
    }
  });
});

describe("buildDrill with a variant", () => {
  const hot = "hot-link";
  const kinds: [(typeof DRILL_TYPES)[number], string][] = [
    ["capacity", "Work out the numbers that matter now"],
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
    expect(built?.prompt.variant).toEqual({ id: entry?.id, title: entry?.title });
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
    expect(a?.prompt.topic).toBe("Hot link");
    expect(b?.key).toBe(a?.key);
  });

  it("builds the normal drill for a variant id the brief does not have", () => {
    const normal = buildDrill(hld, "walk");
    const built = buildDrill(hld, "walk", { variant: "no-such-entry" });
    expect(built).toEqual(normal);
    expect(built?.prompt.variant).toBeUndefined();
  });
});
