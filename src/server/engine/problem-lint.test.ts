import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROOT } from "./config";
import { extraItems, extrasHireBarClashes, hireBarItems } from "./problem-lint";
import { parseProblem } from "./problems";

const REQUIREMENTS = [
  "Core:",
  "1. Send a message to a group. *Ask: Who can send?*",
  "",
  "Extras (credit when they name one, never a gap):",
  "- No duplicate messages on screen: at-least-once delivery plus dedup.",
  "- Online status and last seen in one-to-one chats.",
].join("\n");

function levelBar(hire: string[]): string {
  return ["Hire bar must show:", ...hire.map((h) => `- ${h}`), "", "Stretch signal:", "- Raises the reconnect storm."].join("\n");
}

describe("extraItems and hireBarItems", () => {
  it("reads the Extras bullets and stops the hire bar at the stretch list", () => {
    expect(extraItems(REQUIREMENTS)).toHaveLength(2);
    const items = hireBarItems(levelBar(["One.", "Two", "Three."]));
    expect(items).toEqual(["One.", "Two", "Three."]);
  });

  it("returns nothing when a section has no list", () => {
    expect(extraItems("Core:\n1. Only core.")).toEqual([]);
    expect(hireBarItems("No hire bar here.")).toEqual([]);
  });
});

describe("extrasHireBarClashes", () => {
  it("flags a hire-bar item that restates an Extra", () => {
    const clashes = extrasHireBarClashes({
      "Expected requirements": REQUIREMENTS,
      "Level bar": levelBar(["No duplicate messages on screen: at-least-once delivery with dedup on the phone."]),
    });
    expect(clashes).toHaveLength(1);
    expect(clashes[0]?.extra).toContain("No duplicate messages");
  });

  it("accepts the same item when it applies only when asked", () => {
    const clashes = extrasHireBarClashes({
      "Expected requirements": REQUIREMENTS,
      "Level bar": levelBar(["When asked, no duplicate messages on screen: at-least-once delivery with dedup."]),
    });
    expect(clashes).toEqual([]);
  });

  it("ignores a hire-bar item that shares only a few words", () => {
    const clashes = extrasHireBarClashes({
      "Expected requirements": REQUIREMENTS,
      "Level bar": levelBar(["Server-assigned order per conversation, never the phone's clock."]),
    });
    expect(clashes).toEqual([]);
  });
});

describe("shipped problem briefs", () => {
  const dir = join(APP_ROOT, "content", "problems");
  const files = ["hld", "lld"].flatMap((track) =>
    readdirSync(join(dir, track))
      .filter((n) => n.endsWith(".md"))
      .map((n) => join(dir, track, n)),
  );

  it.each(files)("%s has no hire-bar item that only an Extra covers", (file) => {
    const problem = parseProblem(readFileSync(file, "utf8"), file, false);
    expect(extrasHireBarClashes(problem.sections)).toEqual([]);
  });
});
