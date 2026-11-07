import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({ armed: null as null | { file: string; edited: string } }));

// The edit lands right after the hash check has read the file and before the replay reads it again.
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    readFile: (async (path: Parameters<typeof real.readFile>[0], ...rest: unknown[]) => {
      const text = await (real.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
      if (hook.armed && String(path).endsWith(hook.armed.file)) {
        const { edited } = hook.armed;
        hook.armed = null;
        await real.writeFile(path as string, edited, "utf8");
      }
      return text;
    }) as typeof real.readFile,
  };
});

import type { BookkeepingOp } from "../../shared/types";
import { type TempStudyRoot, makeStudyRoot } from "./__fixtures__/studyRoot";
import { applyProposal, planProposal } from "./bookkeeping";

const guard = { findViolations: () => [], redact: (t: string) => t, size: () => 0 };
let ctx: TempStudyRoot;
beforeEach(async () => {
  ctx = await makeStudyRoot();
});
afterEach(async () => {
  hook.armed = null;
  await ctx.cleanup();
});

describe("a file that changes between the hash check and the replay", () => {
  it("makes the draft stale instead of editing text the user never saw", async () => {
    const op: BookkeepingOp = {
      kind: "tracker_add_subbullet",
      section: "### C2. Classic HLD Problems",
      parentBullet: "URL Shortener",
      text: "Gap from the draft",
    };
    const proposal = await planProposal(ctx.root, "s", [op], guard);
    expect(proposal.ops[0]!.blocked).toBeNull();

    const edited = `${await ctx.read("TRACKER.md")}| 2026-10-31 | typed in an editor | x | y |\n`;
    hook.armed = { file: "TRACKER.md", edited };
    const result = await applyProposal(ctx.root, proposal, ["op-1"], guard);

    expect(hook.armed).toBeNull();
    expect(result.applied).toEqual([]);
    expect(result.proposal.status).toBe("stale");
    expect(result.failed).toEqual([{ opId: "op-1", reason: expect.stringMatching(/draft again/i) }]);
    expect(await ctx.read("TRACKER.md")).toBe(edited);
  });
});
