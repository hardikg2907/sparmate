import { ChatBlockSchema, MAX_BLOCKS_PER_TURN, sanitizeChatBlock, type ChatBlock } from "../../shared/blocks";
import { pinTargets, stepFrames, stepOfElement } from "../../shared/graph/frames";
import type { Track } from "../../shared/phases";
import { fileLines, stepsOwningCodeRange } from "../../shared/stepCode";
import type { Channel } from "../../shared/types";
import { defineTool, textOutput, type RoomTool, type TurnMeta } from "./driver";

const SILENT_ONLY = /^\s*(?:<silent\s*\/>\s*)+$/i;

/** True when the raw model reply consists solely of `<silent/>` markers, meaning nothing should be spoken or shown. */
export function isSilentReply(rawText: string): boolean {
  return SILENT_ONLY.test(rawText);
}

/**
 * Drops blocks that would over-explain a hint, or frame binary choices before the third rung, when `note_hint` runs
 * after `emit_block` in the same turn.
 */
export function stripDisallowedHintBlocks(blocks: readonly ChatBlock[], level: 1 | 2 | 3): ChatBlock[] {
  return blocks.filter((b) => b.kind !== "diagram" && b.kind !== "kv" && (level === 3 || b.kind !== "options"));
}

export interface EmitBlockContext {
  channel: Channel;
  track: Track;
  pendingCount(): number;
  pushBlock(block: ChatBlock): number;
  turnMeta(): TurnMeta | null;
  hintLevelThisTurn(): 1 | 2 | 3 | null;
  currentPhase(): string;
  isCountOnly(phase: string): boolean;
  countOnlyVerdictThisTurn?(): boolean;
  boardElements(): readonly Record<string, unknown>[];
  readCode(): Promise<string> | string;
  stepCode?: () => Readonly<Record<string, readonly string[]>>;
  /** The role sends its text through the reply tool, so nothing it wrote before this call is on screen yet. */
  repliesThroughTool?: boolean;
}

function findBoardTarget(elements: readonly Record<string, unknown>[], elementId: string): { exists: boolean; step: string | null } {
  const target = pinTargets(elements).find((t) => t.id === elementId);
  if (target) return { exists: true, step: target.step ?? stepOfElement(elements, elementId) };
  for (const [step, frame] of stepFrames(elements).entries()) {
    if (String(frame.id) === elementId) return { exists: true, step };
  }
  return { exists: false, step: null };
}

export function createEmitBlockTool(ctx: EmitBlockContext): RoomTool {
  return defineTool(
    "emit_block",
    "Queue one structured UI block (options, diagram, anchor, callout, or kv) for your reply. The result gives the block a number N; write <block N/> alone on its own line in your reply where the block belongs. A block without a marker, and every options block, shows after your reply. At most 4 blocks per reply. Keep prose concise and do not repeat the block's contents word-for-word.",
    { block: ChatBlockSchema },
    async ({ block: raw }) => {
      const block = sanitizeChatBlock(raw);
      if (ctx.pendingCount() >= MAX_BLOCKS_PER_TURN) {
        return textOutput(`At most ${MAX_BLOCKS_PER_TURN} blocks may be emitted per reply.`, true);
      }

      const meta = ctx.turnMeta();
      const hintRequested = ctx.channel === "interview" && meta?.request === "hint";
      const hintLevel = ctx.channel === "interview" ? ctx.hintLevelThisTurn() : null;
      const isHint = hintRequested || hintLevel !== null;
      const isStuck = ctx.channel === "interview" && meta?.request === "stuck";
      const isClock = ctx.channel === "interview" && meta?.kind === "clock";
      const isClockOffer = isClock && (meta?.checkpoint === "phase_over" || meta?.checkpoint === "overtime") && block.kind === "options";
      // Only an explicit Hint press, an "I'm stuck" press, or a valid clock offer may speak with blocks on a count-only step.
      const skipsCountOnly = hintRequested || isStuck || isClockOffer;

      if (ctx.channel === "interview") {
        // A starter in the composer would put the guide's words into the candidate's answer, which is round evidence.
        if (block.kind === "options" && block.action === "prefill") {
          return textOutput('Options in a round must use action "send"; "prefill" would put your words into the candidate\'s answer.', true);
        }
        if (ctx.countOnlyVerdictThisTurn?.()) {
          return textOutput("Checks of this step give only a count of what is open, so emit no blocks in this reply.", true);
        }
        if (isClock && !isClockOffer) {
          if (meta?.checkpoint === "phase_over" || meta?.checkpoint === "overtime") {
            return textOutput(`"${block.kind}" blocks are not allowed on clock offers. Only "options" may be attached.`, true);
          }
          return textOutput("Blocks are not allowed on this clock turn; only move-on and planned-length offers may attach options.", true);
        }
        if (isHint && (block.kind === "diagram" || block.kind === "kv")) {
          return textOutput(`"${block.kind}" blocks are not allowed on hint replies. Use prose, callout, anchor, or (on H3) options.`, true);
        }
        if (hintRequested && hintLevel === null && block.kind === "options") {
          return textOutput('Call note_hint with level 3 before emitting "options" on a hint reply; options are only allowed on third-rung (H3) hints.', true);
        }
        if (hintLevel !== null && hintLevel < 3 && block.kind === "options") {
          return textOutput(`"options" blocks are only allowed on third-rung (H3) hints, not H${hintLevel}.`, true);
        }
        if (isStuck && (block.kind === "options" || block.kind === "kv")) {
          return textOutput(`"${block.kind}" blocks are not allowed on model-answer ("I'm stuck") replies. Model answers have no quizzes and no tables.`, true);
        }
        if (!skipsCountOnly && ctx.isCountOnly(ctx.currentPhase())) {
          return textOutput("Checks of this step give only a count of what is open, so emit no blocks in this reply.", true);
        }
      }

      if (block.kind === "anchor") {
        if (block.target.kind === "board") {
          const found = findBoardTarget(ctx.boardElements(), block.target.elementId);
          if (!found.exists) {
            return textOutput(
              `Board element "${block.target.elementId}" was not found on the whiteboard. Call view_whiteboard to see valid element IDs before emitting a board anchor.`,
              true,
            );
          }
          // Even when the rail sits on another step, an anchor into a count-only step frame would give away what is missing there.
          if (ctx.channel === "interview" && !skipsCountOnly && found.step && ctx.isCountOnly(found.step)) {
            return textOutput("Checks of that step give only a count of what is open, so do not anchor to elements in it.", true);
          }
        } else {
          if (ctx.track !== "lld") {
            return textOutput("Code anchors are only available in LLD rounds.", true);
          }
          const code = await ctx.readCode();
          if (!code || code.trim() === "") {
            return textOutput("The code file is empty, so code line anchors cannot be attached.", true);
          }
          const lineCount = fileLines(code).length;
          const endLine = block.target.endLine ?? block.target.line;
          if (block.target.line > lineCount || endLine > lineCount) {
            const range = block.target.endLine !== undefined ? `L${block.target.line}-L${block.target.endLine}` : `L${block.target.line}`;
            return textOutput(`Code anchor ${range} is out of range; the file has ${lineCount} line${lineCount === 1 ? "" : "s"}.`, true);
          }
          // Design steps write requirements and nouns into the file, so anchoring their lines from another step would reveal open items.
          if (ctx.channel === "interview" && !skipsCountOnly) {
            const owners = stepsOwningCodeRange(code, block.target.line, endLine, ctx.stepCode?.());
            if (owners.some((step) => ctx.isCountOnly(step))) {
              return textOutput("Checks of that step give only a count of what is open, so do not anchor to code written in it.", true);
            }
          }
        }
      }

      if (ctx.channel === "interview" && ctx.countOnlyVerdictThisTurn?.()) {
        return textOutput("Checks of this step give only a count of what is open, so emit no blocks in this reply.", true);
      }
      // Parallel tool calls can all pass the entry check while awaiting readCode(), so re-verify before queueing.
      if (ctx.pendingCount() >= MAX_BLOCKS_PER_TURN) {
        return textOutput(`At most ${MAX_BLOCKS_PER_TURN} blocks may be emitted per reply.`, true);
      }
      const n = ctx.pushBlock(block);
      const place = block.kind === "options" ? "It shows after your reply." : `Write <block ${n}/> alone on a line where it belongs in your reply.`;
      const queued = `Queued ${block.kind} block ${n} (${ctx.pendingCount()}/${MAX_BLOCKS_PER_TURN}). ${place}`;
      return textOutput(ctx.repliesThroughTool ? queued : `${queued} Any reply text you already wrote is kept, so do not write it again.`);
    },
  );
}
