import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRIEF_STEPS, deriveChecklist, MIN_BRIEF_STEP_ITEMS } from "../../shared/checklist";
import { APP_ROOT } from "./config";
import { parseProblem } from "./problems";

const files = (["hld", "lld"] as const).flatMap((track) =>
  readdirSync(join(APP_ROOT, "content", "problems", track))
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(APP_ROOT, "content", "problems", track, name)),
);

describe("shipped problem checklists", () => {
  it.each(files)("%s gives every step read from the brief at least two items", (file) => {
    const problem = parseProblem(readFileSync(file, "utf8"), file, false);
    const checklist = deriveChecklist(problem.meta.track, problem.sections);
    for (const step of BRIEF_STEPS[problem.meta.track]) {
      expect(checklist[step]?.length ?? 0, step).toBeGreaterThanOrEqual(MIN_BRIEF_STEP_ITEMS);
    }
  });
});
