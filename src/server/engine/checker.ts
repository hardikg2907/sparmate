import { z } from "zod";
import { quoteIn } from "../../shared/quotes";
import { unnumberedCode } from "../../shared/stepCode";
import type { ChecklistItem, StepCheck, StepCheckItem, TranscriptEntry } from "../../shared/types";
import { formatClock } from "./clock";
import { transcriptLines } from "./envelope";

/** Enough for any attempt file; a runaway paste must not blow up a call that runs at every pause. */
const MAX_CODE_CHARS = 60_000;

const MAX_DETAIL = 120;
const MAX_QUOTE = 300;

export const CheckerOutputSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(40).describe("The checklist item id, exactly as given."),
        state: z.enum(["covered", "partial", "missing"]),
        source: z
          .enum(["chat", "board", "code", "notes", "none"])
          .describe("Where the evidence is: his chat lines, the board, his code, or his written answer. 'none' when missing."),
        quote: z.string().max(MAX_QUOTE).describe("His exact words from that source, copied verbatim. Empty only for a drawing seen in the image."),
        detail: z.string().max(200).describe("For a partial item, what it still lacks in a few plain words. Empty otherwise."),
      }),
    )
    .max(24),
});
export type CheckerOutput = z.infer<typeof CheckerOutputSchema>;

export interface CheckerEvidence {
  stepLabel: string;
  goal: string;
  items: readonly ChecklistItem[];
  /** The step's interview chat, every visit, hidden and phase entries left out. */
  chat: readonly TranscriptEntry[];
  /** The step frame's text form, or "" when the step has no frame on the board. */
  boardText: string;
  /**
   * The code this step reads, as numbered lines that keep their place in the file: for a design step only the lines
   * he wrote during it, for a build step the whole file. "" when there are none, and always in a design round.
   */
  codeText: string;
  /** His written answer for this step, or "" when he wrote none. */
  notesText: string;
  imageAttached: boolean;
}

export function checkerMessage(e: CheckerEvidence): string {
  return [
    `<step>${e.stepLabel}</step>`,
    `<goal>${e.goal}</goal>`,
    "<checklist>",
    ...e.items.map((i) => `- ${i.id}: ${i.label}`),
    "</checklist>",
    "<chat>",
    transcriptLines(e.chat, "interview") || "(nothing was said in this step)",
    "</chat>",
    ...(e.boardText ? ["<frame>", e.boardText, "</frame>"] : []),
    ...(e.codeText ? ["<code>", e.codeText.slice(0, MAX_CODE_CHARS), "</code>"] : []),
    ...(e.notesText ? ["<written_answer>", e.notesText, "</written_answer>"] : []),
    e.imageAttached ? "An image of the step's frame is attached." : "No image is attached.",
    "Return one entry for every checklist item.",
  ].join("\n");
}

/** A stable fingerprint of what the checker would read, so an unchanged step is not checked twice. */
export function evidenceKey(e: Pick<CheckerEvidence, "chat" | "boardText" | "codeText" | "notesText">): string {
  const lines = e.chat.filter((c) => c.role === "candidate" && !c.fromOption).map((c) => `${c.id}`);
  return JSON.stringify([lines, e.boardText, e.codeText, e.notesText]);
}

const RANK: Record<StepCheckItem["state"], number> = { missing: 0, partial: 1, covered: 2 };

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Turns the checker's answer into what the app stores. Model output is untrusted, so every claim must carry a quote
 * that is really in the step's chat, the frame text, the step's code or his written answer; a claim that cannot be found counts as not
 * covered, and the time shown next to a chat claim comes from the matched line, never from the model. Given the
 * previous check, coverage only rises: what he said cannot be unsaid, and a routine check that misses a point it saw
 * before must not take it away. Given none, the result stands alone, which is how a re-read clears a wrong tick.
 */
export function mergeCheck(previous: StepCheck | undefined, output: CheckerOutput, evidence: CheckerEvidence, at: number): StepCheck {
  const known = new Set(evidence.items.map((i) => i.id));
  const items: Record<string, StepCheckItem> = { ...(previous?.items ?? {}) };
  for (const claim of output.items) {
    if (!known.has(claim.id) || claim.state === "missing") continue;
    const verified = verify(claim, evidence);
    if (!verified) continue;
    const before = items[claim.id];
    if (before && RANK[before.state] >= RANK[claim.state]) continue;
    items[claim.id] = {
      state: claim.state,
      source: verified.source,
      at: verified.at,
      quote: clip(claim.quote, MAX_QUOTE),
      detail: claim.state === "partial" ? clip(claim.detail, MAX_DETAIL) : "",
    };
  }
  return { status: "done", checkedAt: at, usedImage: evidence.imageAttached, items };
}

function verify(claim: CheckerOutput["items"][number], e: CheckerEvidence): { source: StepCheckItem["source"]; at: number | null } | null {
  switch (claim.source) {
    case "chat": {
      const line = e.chat.find((c) => c.role === "candidate" && !c.fromOption && quoteIn(claim.quote, c.text));
      return line ? { source: "chat", at: line.at } : null;
    }
    case "board":
      // A drawing has no words to quote, so it counts only when the checker was shown the image.
      if (claim.quote.trim() === "") return e.imageAttached && e.boardText !== "" ? { source: "board", at: null } : null;
      return quoteIn(claim.quote, e.boardText) ? { source: "board", at: null } : null;
    case "code":
      return e.codeText !== "" && quoteIn(claim.quote, unnumberedCode(e.codeText)) ? { source: "code", at: null } : null;
    case "notes":
      return e.notesText !== "" && quoteIn(claim.quote, e.notesText) ? { source: "notes", at: null } : null;
    default:
      return null;
  }
}

/** The checklist with what he covered and where, in step order, for the scribe. A step with no finished check reads "not checked", never "missing". */
export function stepChecklistText(
  phases: readonly { id: string; label: string }[],
  checklist: Readonly<Record<string, readonly ChecklistItem[]>>,
  checks: Readonly<Record<string, StepCheck>>,
): string {
  return phases
    .flatMap((p) => {
      const check = checks[p.id];
      const items = checklist[p.id] ?? [];
      if (!check || items.length === 0) return [];
      if (check.status !== "done" || check.checkedAt === null) return [`[${p.label}]\n- not checked`];
      const rows = items.map((i) => {
        const got = check.items[i.id];
        if (!got) return `- missing: ${i.label}`;
        const where = got.source === "chat" ? `said "${got.quote}"` : whereText(got);
        return `- ${got.state}: ${i.label} (${where}${got.detail ? `; lacks ${got.detail}` : ""})`;
      });
      return [[`[${p.label}]`, ...rows].join("\n")];
    })
    .join("\n\n");
}

function whereText(item: StepCheckItem): string {
  if (item.source === "board") return "on the board";
  if (item.source === "code") return "in the code";
  if (item.source === "notes") return "in the written answer";
  return item.at !== null ? `said at ${formatClock(item.at)}` : "said in the chat";
}

/** One step's checklist as the checker last read it, one line per item, for the guide. */
export function stepReadingText(items: readonly ChecklistItem[], check: StepCheck | undefined): string {
  return items
    .map((i) => {
      const got = check?.items[i.id];
      if (!got) return `- ${i.id}: ${i.label} — missing`;
      const lacks = got.state === "partial" && got.detail ? `; lacks ${got.detail}` : "";
      return `- ${i.id}: ${i.label} — ${got.state}, ${whereText(got)}${lacks}`;
    })
    .join("\n");
}
