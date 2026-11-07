import { describe, expect, it } from "vitest";
import { HLD_PHASES, LLD_PHASES } from "./phases";
import { deriveChecklist, plainLabel } from "./checklist";

const HLD_BRIEF = {
  "Expected requirements": "1. Create a short link\n2. Redirect adds under 50 ms at p99\n3. Links expire",
  "Capacity math": "- **Writes:** 40 per second.\n- **Reads:** 400 per second.\n- **Storage:** 5 TB.",
  "API and entities":
    "External API:\n- `POST /urls` with a long URL returns a code.\n- `GET /{code}` redirects.\n\nCore entities:\n- `Link {code, url}` is the source of truth.",
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
    expect(labels("capacity")).toEqual(["Writes", "Reads", "Storage"]);
    expect(labels("api")).toEqual(["POST /urls", "GET /{code}", "Entity Link"]);
    expect(labels("design")).toEqual(["Walk one redirect through every box", "Walk one create through every box"]);
    expect(labels("deep_dives")).toEqual(["Generating unique short codes", "Fast redirects"]);
    expect(list.api?.[0]?.id).toBe("api-1");
  });

  it("never names the curveball before it is delivered", () => {
    const wrap = deriveChecklist("hld", HLD_BRIEF).wrap_up?.map((i) => i.label).join(" ") ?? "";
    expect(wrap).not.toMatch(/celebrity|Redis is down|Asia/i);
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
    expect(long.length).toBeLessThanOrEqual(90);
    expect(long.endsWith("…")).toBe(true);
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
    const lld = ["Core:", "1. Entry returns a ticket, or rejects when nothing fits. *Ask: What if the lot is full?*", "2. Exit computes the fee.", "", "Extras:", "- Reservations."].join("\n");
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
    const items = deriveChecklist("hld", { "Expected requirements": ["1. Keep *Ask: a* thing *emphasised*", "2. Empty ask. *Ask:*", "3. Plain question? *Ask: Why?*"].join("\n") }).requirements ?? [];
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
