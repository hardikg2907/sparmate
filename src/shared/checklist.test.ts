import { describe, expect, it } from "vitest";
import { HLD_PHASES, LLD_PHASES, phasePlan } from "./phases";
import { deriveChecklist, firstSentence, plainLabel } from "./checklist";

const HLD_BRIEF = {
  "Expected requirements": "1. Create a short link\n2. Redirect adds under 50 ms at p99\n3. Links expire",
  "Capacity math": "- **Writes:** 40 per second.\n- **Reads:** 400 per second.\n- **Storage:** 5 TB.",
  "API and entities": "External API:\n- `POST /urls` with a long URL returns a code.\n- `GET /{code}` redirects.\n\nCore entities:\n- `Link {code, url}` is the source of truth.",
  "Reference design": "Walk one redirect: client, CDN, service, cache.\nWalk one create: client, service, database.",
  "Deep dives": "### Generating unique short codes\ntext\n### Fast redirects\ntext",
};

const LLD_BRIEF = {
  "Expected requirements": "1. Entry returns a ticket\n2. Exit computes the fee",
  "Entities and relationships": "- `VehicleType` is an enum.\n- `Spot` holds a size.\n- `Ticket` records entry.",
  "Behaviour and states": "- `enter(type, time)` assigns a spot.\n- `exit(ticketId, time)` frees it.",
  "Demo scenarios": "1. A car enters at minute 0: spot 2.\n2. A truck enters: rejected.\n3. The car exits at minute 130: fee 150.",
};

describe("deriveChecklist", () => {
  it("reads each HLD step from the brief section that holds its answer", () => {
    const list = deriveChecklist("hld", HLD_BRIEF);
    expect(Object.keys(list)).toEqual(HLD_PHASES.map((ph) => ph.id));
    const labels = (phase: string) => list[phase]?.map((i) => i.label);
    expect(labels("requirements")).toEqual(["Create a short link", "Redirect adds under 50 ms at p99", "Links expire"]);
    expect(labels("entities")).toEqual(["Link"]);
    expect(labels("api")).toEqual(["POST /urls", "GET /{code}"]);
    expect(labels("design")).toEqual(["Walk one redirect through every box", "Walk one create through every box"]);
    expect(labels("deep_dives")).toEqual(["Generating unique short codes", "Fast redirects", "The curveball handled"]);
    expect(list.api?.[0]?.id).toBe("api-1");
  });

  it("never names the curveball before it is delivered", () => {
    const dives =
      deriveChecklist("hld", HLD_BRIEF)
        .deep_dives?.map((i) => i.label)
        .join(" ") ?? "";
    expect(dives).not.toMatch(/celebrity|Redis is down|Asia/i);
  });

  it("reads LLD entities and behaviour from their sections and splits the demo scenarios", () => {
    const list = deriveChecklist("lld", LLD_BRIEF);
    expect(Object.keys(list)).toEqual(LLD_PHASES.map((ph) => ph.id));
    expect(list.entities?.map((i) => i.label)).toEqual(["VehicleType", "Spot", "Ticket"]);
    expect(list.behaviour?.map((i) => i.label)).toEqual(["enter(type, time)", "exit(ticketId, time)"]);
    expect(list.thin_slice).toHaveLength(1);
    expect(list.thin_slice?.[0]?.label).toMatch(/^Demo: A car enters at minute 0/);
    expect(list.fill_out?.length).toBe(2);
  });

  it("falls back to the step's goal when the brief has nothing for a step", () => {
    const list = deriveChecklist("hld", { "Expected requirements": "No numbered lines here." });
    expect(list.requirements).toEqual([{ id: "requirements-1", label: plainLabel(HLD_PHASES[0]!.goal) }]);
  });

  it("strips Markdown and cuts long labels at a word", () => {
    expect(plainLabel("**Writes:** `POST /x` and [a link](https://example.com).")).toBe("Writes: POST /x and a link");
    const long = plainLabel("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(140);
    expect(long.endsWith("…")).toBe(true);
  });

  it("does not split first sentence on question mark inside code spans or unclosed braces", () => {
    const s = firstSentence("Driver to server: `location { lat, lon, ts, rideId? }` every 4 seconds. More details follow.");
    expect(s).toBe("Driver to server: location { lat, lon, ts, rideId? } every 4 seconds");

    const list = deriveChecklist("hld", {
      ...HLD_BRIEF,
      "API and entities": [
        "External API:",
        "- `POST /seeds` with URLs.",
        "- `fetched { url, etag? }` is published for every fetch. The indexer reads the events.",
        "",
        "Core entities:",
        "- `Host { hostId }` is stored.",
      ].join("\n"),
    });
    const labels = list.api?.map((i) => i.label) ?? [];
    expect(labels.some((l) => l.includes("etag?"))).toBe(true);
    expect(labels.some((l) => l.endsWith("{") || l.endsWith("etag?"))).toBe(false);
  });

  it("cuts long labels at a natural clause boundary without cutting inside brackets or code spans", () => {
    const markdown =
      "Redirect replies name the right node: MOVED node when ownership changed for good (update routes on client), ASK node during a migration (one-off fetch, do not update routes).";
    const label = plainLabel(markdown);
    expect(label.endsWith("…")).toBe(true);
    expect(label).not.toMatch(/\([^)]*…/);
    expect(label).not.toMatch(/\{[^}]*…/);
    expect(label).toBe("Redirect replies name the right node: MOVED node when ownership changed for good (update routes on client)…");
  });

  it("extracts multiple endpoints and groups related messages within the item cap", () => {
    const list = deriveChecklist("hld", {
      ...HLD_BRIEF,
      "API and entities": [
        "External API:",
        "- `POST /conversations` with members.",
        "- `POST /conversations/{id}/members` and `DELETE /conversations/{id}/members/{userId}` (admins) return 204.",
        "- `GET /conversations/{id}/messages?beforeSeq=&limit=50` returns messages.",
        "- `PUT /me/push-token` registers device.",
        "",
        "Live connection:",
        "- Phone to server: `send { clientMsgId, conversationId, body }`. Reply: `sent`.",
        "- Phone to server: `ack { conversationId, seq }` (phone holds up to `seq`), `read { conversationId, seq }`, `watch { userId }` and `unwatch { userId }`, and `ping` every 30 seconds.",
        "- Server to phone: `message { id }`, `receipt { seq }`, `presence { online }`.",
        "",
        "Core entities:",
        "- `Conversation { conversationId }`",
        "- `Member { conversationId, userId }`",
        "- `Message { conversationId, seq }`",
        "- `Inbox { userId, conversationId }`",
        "- `SentLog { senderId, clientMsgId }`",
      ].join("\n"),
    });
    const labels = list.api?.map((i) => i.label) ?? [];
    expect(labels).toContain("POST /conversations/{id}/members");
    expect(labels).toContain("DELETE /conversations/{id}/members/{userId}");
    expect(labels.some((l) => l.includes("read") && l.includes("watch") && l.includes("unwatch"))).toBe(true);
    expect(labels).not.toContain("SentLog");
    expect(list.entities?.map((i) => i.label)).toContain("SentLog");
    expect(labels.length).toBeLessThanOrEqual(12);
  });

  it("reads table rows and numbered lists in behaviour while ignoring interviewer questions", () => {
    const list = deriveChecklist("lld", {
      ...LLD_BRIEF,
      "Behaviour and states": [
        "A machine has two states.",
        "```",
        " method          | IDLE | SLOT_SELECTED",
        " ----------------|------|-----------------------------------------",
        " selectSlot(id)  | bad  | same",
        " insertMoney(d)  | none | check",
        " restock(...)    | ok   | busy",
        " loadMoney(...)  | ok   | busy",
        "```",
        "",
        "The completion check, in this order:",
        "1. move the order's pieces INTO the stock",
        "2. makeChange(paid - price) from the stock",
        "3a. success -> quantity--, dispense, return the change",
        "3b. failure -> take the pieces back OUT of the stock, return them, NO_EXACT_CHANGE",
        "",
        "- `makeChange` walks the stock.",
        "",
        "Questions to ask once the code runs:",
        '- "What does your win check cost on a 1,000 by 1,000 board with K = 5?"',
        '- "What happens if K is 4 on a 5 by 5 board?"',
      ].join("\n"),
    });
    const labels = list.behaviour?.map((i) => i.label) ?? [];
    expect(labels).toContain("selectSlot(id)");
    expect(labels).toContain("insertMoney(d)");
    expect(labels).toContain("restock(...)");
    expect(labels).toContain("loadMoney(...)");
    expect(labels).toContain("The completion check, in this order");
    expect(labels.some((l) => l.includes("INTO the stock") || l.includes("3a") || l.includes("->"))).toBe(false);
    expect(labels.some((l) => l.includes("What does your win check cost"))).toBe(false);
  });

  it("extracts all entity names sharing a single bullet", () => {
    const list = deriveChecklist("lld", {
      ...LLD_BRIEF,
      "Entities and relationships": [
        "- `SeatCategory` (enum class): REGULAR, PREMIUM.",
        "- `City`, `Theatre`, `Screen`, `Movie`: plain data linked by ids.",
        "- `Show`: movie id.",
        "- Not stored: free-seat lists.",
      ].join("\n"),
    });
    const labels = list.entities?.map((i) => i.label) ?? [];
    expect(labels).toEqual(["SeatCategory", "City", "Theatre", "Screen", "Movie", "Show"]);
  });

  it("uses scenario titles for demo labels and preserves uniqueness across identical titles", () => {
    const list = deriveChecklist("lld", {
      ...LLD_BRIEF,
      "Demo scenarios": [
        "1. **Ride, with a tie.** Press hall call (5, UP). All three cars are 5 floors away, so pick car 1.",
        "2. **Ride, with a tie.** A duplicate scenario title with different description.",
        "3. A plain scenario title without bold. Second sentence explaining the scenario.",
      ].join("\n"),
    });
    const thin = list.thin_slice?.map((i) => i.label) ?? [];
    const fill = list.fill_out?.map((i) => i.label) ?? [];
    expect(thin).toEqual(["Demo: Ride, with a tie"]);
    expect(fill).toEqual(["Demo: Ride, with a tie (2)", "Demo: A plain scenario title without bold"]);
  });
});

describe("deriveChecklist with questions", () => {
  const hld = [
    "Core, functional:",
    "1. Create a short link for a long URL, with an optional alias. *Ask: What can a user do when creating a link?*",
    "2. Redirect a short link; an expired link stops redirecting. *Ask: What happens when someone opens a short link?*",
    "",
    "Core, non-functional:",
    "1. A redirect adds under 50 ms at p99. *Ask: How fast must a redirect be?*",
    "",
    "Extras (credit when he names one, never a gap):",
    "- A total click count per link.",
    "- Link previews.",
  ].join("\n");

  it("strips the ask from the label and keeps it as the question", () => {
    const items = deriveChecklist("hld", { "Expected requirements": hld }).requirements ?? [];
    expect(items).toEqual([
      { id: "requirements-1", label: "Create a short link for a long URL, with an optional alias", ask: "What can a user do when creating a link?" },
      { id: "requirements-2", label: "Redirect a short link; an expired link stops redirecting", ask: "What happens when someone opens a short link?" },
      { id: "requirements-3", label: "A redirect adds under 50 ms at p99", ask: "How fast must a redirect be?" },
    ]);
  });

  it("never turns an Extras bullet into a checklist item", () => {
    const labels = (deriveChecklist("hld", { "Expected requirements": hld }).requirements ?? []).map((i) => i.label).join("|");
    expect(labels).not.toMatch(/click count|previews/);
  });

  it("reads the LLD clarify step the same way", () => {
    const lld = [
      "Core:",
      "1. Entry returns a ticket, or rejects when nothing fits. *Ask: What if the lot is full?*",
      "2. Exit computes the fee.",
      "",
      "Extras:",
      "- Reservations.",
    ].join("\n");
    const items = deriveChecklist("lld", { "Expected requirements": lld }).clarify ?? [];
    expect(items).toEqual([
      { id: "clarify-1", label: "Entry returns a ticket, or rejects when nothing fits", ask: "What if the lot is full?" },
      { id: "clarify-2", label: "Exit computes the fee" },
    ]);
    expect("ask" in (items[1] ?? {})).toBe(false);
  });

  it("parses an old brief with no ask suffix and sets no ask key", () => {
    const old = ["1. Redirect adds under 50 ms at p99", "2. **Availability:** 99.99% for `redirects`"].join("\n");
    const items = deriveChecklist("hld", { "Expected requirements": old }).requirements ?? [];
    expect(items.map((i) => i.label)).toEqual(["Redirect adds under 50 ms at p99", "Availability: 99.99% for redirects"]);
    expect(items.some((i) => "ask" in i)).toBe(false);
  });

  it("leaves a line alone when the italic tail is not a well-formed ask", () => {
    const items =
      deriveChecklist("hld", { "Expected requirements": ["1. Keep *Ask: a* thing *emphasised*", "2. Empty ask. *Ask:*", "3. Plain question? *Ask: Why?*"].join("\n") })
        .requirements ?? [];
    expect(items.map((i) => i.ask)).toEqual([undefined, undefined, "Why?"]);
  });

  it("cuts a long question at a word and survives a huge line quickly", () => {
    const long = `1. Thing. *Ask: ${"word ".repeat(80)}?*`;
    const items = deriveChecklist("hld", { "Expected requirements": long }).requirements ?? [];
    expect((items[0]?.ask ?? "").length).toBeLessThanOrEqual(160);
    const start = Date.now();
    deriveChecklist("hld", { "Expected requirements": `1. ${"*Ask: ".repeat(200_000)}` });
    expect(Date.now() - start).toBeLessThan(500);
  });
});

const behaviourLabels = (text: string) => deriveChecklist("lld", { ...LLD_BRIEF, "Behaviour and states": text }).behaviour?.map((i) => i.label) ?? [];

describe("behaviour items", () => {
  it("keeps one item per method when a table row, a bullet and a bare name repeat it", () => {
    const labels = behaviourLabels(
      [
        "```",
        " cancel()        | nothing | return the pieces",
        " makeChange(amount) | a | b",
        "```",
        "- `cancel`",
        "- `makeChange(paid - price)` from the stock",
        "- `MakeChange`",
      ].join("\n"),
    );
    expect(labels.filter((l) => /^cancel\b/i.test(l))).toHaveLength(1);
    expect(labels.filter((l) => /^makeChange/i.test(l))).toEqual(["makeChange(paid - price)"]);
    expect(labels).toContain("cancel()");
  });

  it("states a bare method name as a sentence so the label says what it does", () => {
    const labels = behaviourLabels("- `makeChange` walks the stock from the largest piece down. It writes the stock last.");
    expect(labels).toEqual(["makeChange walks the stock from the largest piece down"]);
  });

  it("turns a numbered procedure inside a code block into one item named by the sentence before the block", () => {
    const labels = behaviourLabels(
      [
        "The completion check, in this order:",
        "",
        "```",
        " paid < price ?   -> wait",
        " 1. move the order's pieces INTO the stock",
        " 2. makeChange(paid - price) from the stock",
        " 3a. success -> quantity--, dispense, return the change",
        " 3b. failure -> take the pieces back OUT of the stock, return them, NO_EXACT_CHANGE",
        " drop the order, state = IDLE",
        "```",
        "- Greedy fails on some stock mixes.",
      ].join("\n"),
    );
    expect(labels).toEqual(["The completion check, in this order", "Greedy fails on some stock mixes"]);
  });

  it("names a numbered procedure by the heading above it and keeps lists apart", () => {
    const labels = behaviourLabels(
      ["### Booking flow", "1. hold the seats", "2. take payment", "", "- `release(booking)` frees them.", "", "Cleanup:", "1. drop the hold", "2. free the seats"].join("\n"),
    );
    expect(labels).toEqual(["Booking flow", "release(booking)", "Cleanup"]);
  });

  it("still reads a single numbered line as its own item", () => {
    expect(behaviourLabels("1. `reset()` clears the board.")).toEqual(["reset()"]);
  });

  it("names an unnamed procedure by its steps so it is never empty", () => {
    const labels = behaviourLabels(["1. validate the input", "2. write the row"].join("\n"));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(/^Steps in order: validate the input/);
  });
});

describe("label cuts and limits", () => {
  it("drops a long shape to the words before its colon rather than cutting inside the braces", () => {
    const shape = `A post: \`{ ${"field, ".repeat(40)}}\`. More text.`;
    const list = deriveChecklist("hld", { ...HLD_BRIEF, "API and entities": `External API:\n- ${shape}` });
    expect(list.api?.[0]?.label).toBe("A post");
  });

  it("names a long event by its name instead of cutting its field list", () => {
    const event = `\`fetched { ${"field, ".repeat(40)}}\` is published for every fetch.`;
    const list = deriveChecklist("hld", { ...HLD_BRIEF, "API and entities": `Event contracts:\n- ${event}` });
    expect(list.api?.[0]?.label).toBe("fetched");
  });

  it("keeps API endpoints and entity names in their own steps", () => {
    const endpoints = Array.from({ length: 10 }, (_, i) => `- \`GET /r${i}\` returns it.`);
    const entities = ["Alpha", "Beta", "Gamma", "Delta"].map((n) => `- \`${n} { id }\``);
    const list = deriveChecklist("hld", { ...HLD_BRIEF, "API and entities": ["External API:", ...endpoints, "", "Core entities:", ...entities].join("\n") });
    const labels = list.api?.map((i) => i.label) ?? [];
    expect(labels).toHaveLength(10);
    expect(labels.every((l) => l.startsWith("GET"))).toBe(true);
    expect(list.entities?.map((i) => i.label)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
  });

  it("folds items past the limit into one last item instead of dropping them", () => {
    const dives = Array.from({ length: 13 }, (_, i) => `### Item${i + 1}\ntext`).join("\n");
    const labels = deriveChecklist("hld", { ...HLD_BRIEF, "Deep dives": dives }).deep_dives?.map((i) => i.label) ?? [];
    expect(labels).toHaveLength(12);
    expect(labels[11]).toBe("Also: Item12; Item13; The curveball handled");
    expect(labels[10]).toBe("Item11");
  });

  it("joins a bare continuation scenario title with its next sentence", () => {
    const list = deriveChecklist("lld", {
      ...LLD_BRIEF,
      "Demo scenarios": ["1. First run. Details.", "2. Continues 1. `go(2)` returns id 2. More."].join("\n"),
    });
    expect(list.fill_out?.map((i) => i.label)).toEqual(["Demo: Continues 1: go(2) returns id 2"]);
  });
});

describe("HLD entities, API and deep dives", () => {
  it("splits a brief with External API and Core entities into the two steps", () => {
    const list = deriveChecklist("hld", {
      ...HLD_BRIEF,
      "API and entities": [
        "External API:",
        "- `POST /urls` with `{ longUrl }` returns `201`.",
        "- `GET /{code}` returns `302`.",
        "",
        "Core entities:",
        "- `Link { code, longUrl }`",
        "- `ClickCount { code, clicks }`",
      ].join("\n"),
    });
    expect(list.api?.map((i) => i.label)).toEqual(["POST /urls", "GET /{code}"]);
    expect(list.entities?.map((i) => i.label)).toEqual(["Link", "ClickCount"]);
    expect(list.entities?.[0]?.id).toBe("entities-1");
  });

  it("counts bullets before any External API line as API", () => {
    const list = deriveChecklist("hld", {
      ...HLD_BRIEF,
      "API and entities": [
        "Real-time API, one socket per phone:",
        "- `send { id, body }` returns `sent`.",
        "- `GET /history` returns `200`.",
        "",
        "Core entities:",
        "- `Conversation { id }`",
      ].join("\n"),
    });
    expect(list.api?.map((i) => i.label)).toEqual(["send { id, body }", "GET /history"]);
    expect(list.entities?.map((i) => i.label)).toEqual(["Conversation"]);
  });

  it("falls back to the goals when the section lists no entities", () => {
    const list = deriveChecklist("hld", { ...HLD_BRIEF, "API and entities": "External API:\n- `GET /a` returns it." });
    expect(list.entities).toEqual([{ id: "entities-1", label: plainLabel(HLD_PHASES[1]!.goal) }]);
  });

  it("shares items among entity names past the limit, so none is dropped", () => {
    const names = Array.from({ length: 14 }, (_, i) => `Entity${String.fromCharCode(65 + i)}`);
    const list = deriveChecklist("hld", {
      ...HLD_BRIEF,
      "API and entities": ["External API:", "- `GET /a` returns it.", "", "Core entities:", ...names.map((n) => `- \`${n} { id }\``)].join("\n"),
    });
    const labels = list.entities?.map((i) => i.label) ?? [];
    expect(labels.length).toBeLessThan(names.length);
    for (const n of names) expect(labels.join(" ")).toContain(n);
  });

  it("ends the deep dives with the curveball item", () => {
    const labels = deriveChecklist("hld", HLD_BRIEF).deep_dives?.map((i) => i.label) ?? [];
    expect(labels.at(-1)).toBe("The curveball handled");
    expect(deriveChecklist("hld", { "Expected requirements": "1. x" }).deep_dives?.map((i) => i.label)).toEqual(["The curveball handled"]);
  });
});

describe("phasePlan for HLD", () => {
  it("uses the base minutes at 45 minutes", () => {
    expect(phasePlan("hld", 45).map((p) => [p.id, p.minutes])).toEqual([
      ["requirements", 5],
      ["entities", 2],
      ["api", 5],
      ["design", 13],
      ["deep_dives", 20],
    ]);
  });

  it("scales the steps at 60 minutes to a plan that adds up to 60", () => {
    expect(phasePlan("hld", 60).map((p) => [p.id, p.minutes])).toEqual([
      ["requirements", 7],
      ["entities", 2],
      ["api", 7],
      ["design", 17],
      ["deep_dives", 27],
    ]);
  });
});
