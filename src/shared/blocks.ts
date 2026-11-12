import { z } from "zod";

export const MAX_BLOCKS_PER_TURN = 4;

// Control bytes other than tab and newline have no visual meaning in chat and can confuse plain-text logs.
function stripControlChars(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code >= 0x20 && code !== 0x7f) || code === 0x09 || code === 0x0a) out += value[i];
  }
  return out;
}

function cleanSingleLine(value: string): string {
  return stripControlChars(value).replace(/\s+/g, " ").trim();
}

function cleanMultiLine(value: string): string {
  return stripControlChars(value.replace(/\r\n?/g, "\n")).trim();
}

function nonEmpty(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((s) => cleanMultiLine(s).length > 0, "Must not be blank");
}

export const OptionItemSchema = z.strictObject({
  label: nonEmpty(120),
  note: nonEmpty(240).optional(),
  reply: nonEmpty(500).optional(),
});
export type OptionItem = z.infer<typeof OptionItemSchema>;

export const OptionsBlockSchema = z.strictObject({
  kind: z.literal("options"),
  items: z.array(OptionItemSchema).min(2).max(4),
  action: z.enum(["send", "prefill"]).optional(),
});
export type OptionsBlock = z.infer<typeof OptionsBlockSchema>;

export const FlowNodeSchema = z.strictObject({
  id: nonEmpty(64),
  label: nonEmpty(80),
  detail: nonEmpty(120).optional(),
});
export type FlowNode = z.infer<typeof FlowNodeSchema>;

export const FlowEdgeSchema = z.strictObject({
  from: nonEmpty(64),
  to: nonEmpty(64),
  label: nonEmpty(80).optional(),
  style: z.enum(["solid", "dashed"]).optional(),
});
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowDiagramBlockSchema = z
  .strictObject({
    kind: z.literal("diagram"),
    layout: z.literal("flow"),
    title: nonEmpty(120).optional(),
    nodes: z.array(FlowNodeSchema).min(2).max(12),
    edges: z.array(FlowEdgeSchema).min(1).max(20),
  })
  .superRefine((diagram, ctx) => {
    const ids = new Set<string>();
    for (const [i, node] of diagram.nodes.entries()) {
      const id = cleanSingleLine(node.id);
      if (ids.has(id)) {
        ctx.addIssue({ code: "custom", path: ["nodes", i, "id"], message: `Duplicate node id "${id}"` });
      }
      ids.add(id);
    }
    for (const [i, edge] of diagram.edges.entries()) {
      const from = cleanSingleLine(edge.from);
      const to = cleanSingleLine(edge.to);
      if (!ids.has(from)) {
        ctx.addIssue({ code: "custom", path: ["edges", i, "from"], message: `Unknown node id "${from}"` });
      }
      if (!ids.has(to)) {
        ctx.addIssue({ code: "custom", path: ["edges", i, "to"], message: `Unknown node id "${to}"` });
      }
      if (from === to) {
        ctx.addIssue({ code: "custom", path: ["edges", i, "to"], message: "Self-edges are not supported in flow diagrams" });
      }
    }
  });
export type FlowDiagramBlock = z.infer<typeof FlowDiagramBlockSchema>;

export const SequenceActorSchema = z.strictObject({
  id: nonEmpty(64),
  label: nonEmpty(60),
});
export type SequenceActor = z.infer<typeof SequenceActorSchema>;

export const SequenceStepSchema = z.strictObject({
  from: nonEmpty(64),
  to: nonEmpty(64),
  label: nonEmpty(120),
  style: z.enum(["solid", "dashed"]).optional(),
});
export type SequenceStep = z.infer<typeof SequenceStepSchema>;

export const SequenceDiagramBlockSchema = z
  .strictObject({
    kind: z.literal("diagram"),
    layout: z.literal("sequence"),
    title: nonEmpty(120).optional(),
    actors: z.array(SequenceActorSchema).min(2).max(6),
    steps: z.array(SequenceStepSchema).min(1).max(16),
  })
  .superRefine((diagram, ctx) => {
    const ids = new Set<string>();
    for (const [i, actor] of diagram.actors.entries()) {
      const id = cleanSingleLine(actor.id);
      if (ids.has(id)) {
        ctx.addIssue({ code: "custom", path: ["actors", i, "id"], message: `Duplicate actor id "${id}"` });
      }
      ids.add(id);
    }
    for (const [i, step] of diagram.steps.entries()) {
      const from = cleanSingleLine(step.from);
      const to = cleanSingleLine(step.to);
      if (!ids.has(from)) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "from"], message: `Unknown actor id "${from}"` });
      }
      if (!ids.has(to)) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "to"], message: `Unknown actor id "${to}"` });
      }
    }
  });
export type SequenceDiagramBlock = z.infer<typeof SequenceDiagramBlockSchema>;

export type DiagramBlock = FlowDiagramBlock | SequenceDiagramBlock;

export const BoardAnchorTargetSchema = z.strictObject({
  kind: z.literal("board"),
  elementId: nonEmpty(120),
});
export type BoardAnchorTarget = z.infer<typeof BoardAnchorTargetSchema>;

export const CodeAnchorTargetSchema = z
  .strictObject({
    kind: z.literal("code"),
    line: z.number().int().min(1).max(100_000),
    endLine: z.number().int().min(1).max(100_000).optional(),
  })
  .superRefine((target, ctx) => {
    if (target.endLine !== undefined && target.endLine < target.line) {
      ctx.addIssue({ code: "custom", path: ["endLine"], message: "endLine must be greater than or equal to line" });
    }
  });
export type CodeAnchorTarget = z.infer<typeof CodeAnchorTargetSchema>;

export const AnchorTargetSchema = z.union([BoardAnchorTargetSchema, CodeAnchorTargetSchema]);
export type AnchorTarget = z.infer<typeof AnchorTargetSchema>;

export const AnchorBlockSchema = z.strictObject({
  kind: z.literal("anchor"),
  target: AnchorTargetSchema,
  label: nonEmpty(120),
  note: nonEmpty(240).optional(),
});
export type AnchorBlock = z.infer<typeof AnchorBlockSchema>;

export const CalloutBlockSchema = z.strictObject({
  kind: z.literal("callout"),
  label: nonEmpty(80).optional(),
  text: nonEmpty(800),
});
export type CalloutBlock = z.infer<typeof CalloutBlockSchema>;

export const KvRowSchema = z.strictObject({
  key: nonEmpty(120),
  value: nonEmpty(240),
});
export type KvRow = z.infer<typeof KvRowSchema>;

export const KvBlockSchema = z.strictObject({
  kind: z.literal("kv"),
  rows: z.array(KvRowSchema).min(1).max(10),
});
export type KvBlock = z.infer<typeof KvBlockSchema>;

export const ChatBlockSchema = z.union([OptionsBlockSchema, FlowDiagramBlockSchema, SequenceDiagramBlockSchema, AnchorBlockSchema, CalloutBlockSchema, KvBlockSchema]);
export type ChatBlock = z.infer<typeof ChatBlockSchema>;

/** Normalizes whitespace and strips control bytes without adding Zod transforms that break JSON Schema generation. */
export function sanitizeChatBlock(block: ChatBlock): ChatBlock {
  switch (block.kind) {
    case "options":
      return {
        kind: "options",
        ...(block.action ? { action: block.action } : {}),
        items: block.items.map((item) => ({
          label: cleanSingleLine(item.label),
          ...(item.note !== undefined ? { note: cleanSingleLine(item.note) } : {}),
          ...(item.reply !== undefined ? { reply: cleanMultiLine(item.reply) } : {}),
        })),
      };
    case "diagram":
      if (block.layout === "flow") {
        return {
          kind: "diagram",
          layout: "flow",
          ...(block.title !== undefined ? { title: cleanSingleLine(block.title) } : {}),
          nodes: block.nodes.map((node) => ({
            id: cleanSingleLine(node.id),
            label: cleanSingleLine(node.label),
            ...(node.detail !== undefined ? { detail: cleanSingleLine(node.detail) } : {}),
          })),
          edges: block.edges.map((edge) => ({
            from: cleanSingleLine(edge.from),
            to: cleanSingleLine(edge.to),
            ...(edge.label !== undefined ? { label: cleanSingleLine(edge.label) } : {}),
            ...(edge.style ? { style: edge.style } : {}),
          })),
        };
      }
      return {
        kind: "diagram",
        layout: "sequence",
        ...(block.title !== undefined ? { title: cleanSingleLine(block.title) } : {}),
        actors: block.actors.map((actor) => ({
          id: cleanSingleLine(actor.id),
          label: cleanSingleLine(actor.label),
        })),
        steps: block.steps.map((step) => ({
          from: cleanSingleLine(step.from),
          to: cleanSingleLine(step.to),
          label: cleanSingleLine(step.label),
          ...(step.style ? { style: step.style } : {}),
        })),
      };
    case "anchor":
      return {
        kind: "anchor",
        target:
          block.target.kind === "board"
            ? { kind: "board", elementId: cleanSingleLine(block.target.elementId) }
            : {
                kind: "code",
                line: block.target.line,
                ...(block.target.endLine !== undefined && block.target.endLine > block.target.line ? { endLine: block.target.endLine } : {}),
              },
        label: cleanSingleLine(block.label),
        ...(block.note !== undefined ? { note: cleanSingleLine(block.note) } : {}),
      };
    case "callout":
      return {
        kind: "callout",
        ...(block.label !== undefined ? { label: cleanSingleLine(block.label) } : {}),
        text: cleanMultiLine(block.text),
      };
    case "kv":
      return {
        kind: "kv",
        rows: block.rows.map((row) => ({
          key: cleanSingleLine(row.key),
          value: cleanSingleLine(row.value),
        })),
      };
  }
}

/** Deterministic plain-text rendering for transcripts read by the checker, judge, coach and scribe. */
export function blockToPlainText(block: ChatBlock): string {
  switch (block.kind) {
    case "options": {
      const lines = block.items.map((item) => `- ${item.label}${item.note ? ` — ${item.note}` : ""}`);
      return `Options:\n${lines.join("\n")}`;
    }
    case "diagram": {
      if (block.layout === "flow") {
        const byId = new Map(block.nodes.map((n) => [n.id, n]));
        const touched = new Set<string>();
        const header = block.title ? `Diagram (${block.title}):` : "Diagram:";
        const fmtNode = (id: string) => {
          const n = byId.get(id);
          if (!n) return id;
          return n.detail ? `${n.label} [${n.detail}]` : n.label;
        };
        const edgeLines = block.edges.map((e) => {
          touched.add(e.from);
          touched.add(e.to);
          const arrow = e.style === "dashed" ? "-->" : "->";
          const via = e.label ? ` (${e.label})` : "";
          return `- ${fmtNode(e.from)} ${arrow} ${fmtNode(e.to)}${via}`;
        });
        const isolated = block.nodes.filter((n) => !touched.has(n.id)).map((n) => `- ${fmtNode(n.id)}`);
        return [header, ...edgeLines, ...isolated].join("\n");
      }
      const byId = new Map(block.actors.map((a) => [a.id, a.label]));
      const header = block.title ? `Sequence (${block.title}):` : "Sequence:";
      const stepLines = block.steps.map((s, idx) => {
        const from = byId.get(s.from) ?? s.from;
        const to = byId.get(s.to) ?? s.to;
        const arrow = s.style === "dashed" ? "-->" : "->";
        return `${idx + 1}. ${from} ${arrow} ${to}: ${s.label}`;
      });
      return [header, ...stepLines].join("\n");
    }
    case "anchor": {
      const where =
        block.target.kind === "board"
          ? `board ${block.target.elementId}`
          : block.target.endLine && block.target.endLine > block.target.line
            ? `code L${block.target.line}-L${block.target.endLine}`
            : `code L${block.target.line}`;
      return `Pointer (${where}): ${block.label}${block.note ? ` — ${block.note}` : ""}`;
    }
    case "callout":
      return block.label ? `${block.label}: ${block.text}` : `Note: ${block.text}`;
    case "kv":
      return block.rows.map((r) => `- ${r.key}: ${r.value}`).join("\n");
  }
}

export function blocksToPlainText(blocks: readonly ChatBlock[] | undefined): string {
  if (!blocks || blocks.length === 0) return "";
  return blocks.map(blockToPlainText).join("\n\n");
}

function ensureSentenceEnd(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Concise spoken form for screen-reader live regions and voice replies. */
export function blockToSpeechText(block: ChatBlock): string {
  switch (block.kind) {
    case "options":
      return ensureSentenceEnd(`Options: ${block.items.map((item) => item.label).join(", ")}`);
    case "diagram":
      return ensureSentenceEnd(block.title ? `Diagram: ${block.title}` : "Diagram attached");
    case "anchor":
      return ensureSentenceEnd(block.note ? `${block.label}. ${block.note}` : block.label);
    case "callout":
      return ensureSentenceEnd(block.label ? `${block.label}. ${block.text}` : block.text);
    case "kv":
      return block.rows.map((row) => ensureSentenceEnd(`${row.key}: ${row.value}`)).join(" ");
  }
}

export function blocksToSpeechText(blocks: readonly ChatBlock[] | undefined): string {
  if (!blocks || blocks.length === 0) return "";
  return blocks.map(blockToSpeechText).filter(Boolean).join(" ");
}

// Combining marks belong to the letter before them, so a match never ends between a letter and its accent.
const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u;
const HAS_WORD = /[\p{L}\p{N}]/u;
// Marks matched text as used, so a shorter option never matches inside a longer one already found.
const USED = "\u0000";

/**
 * Text folded for matching: whitespace runs become one space, ends are dropped, and case is folded. `source` maps
 * each folded character back to its index in the original, so a match can be cut out of the text the candidate sent.
 */
function foldForMatch(text: string): { folded: string; source: number[] } {
  let folded = "";
  const source: number[] = [];
  let spaceAt = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (spaceAt < 0) spaceAt = i;
      continue;
    }
    if (spaceAt >= 0 && folded.length > 0) {
      folded += " ";
      source.push(spaceAt);
    }
    spaceAt = -1;
    for (const lower of ch.toLowerCase()) {
      folded += lower;
      source.push(i);
    }
  }
  return { folded, source };
}

/** Whole-word occurrences of `needle` in `folded`, as folded index ranges. */
function foldedSpans(folded: string, needle: string): [number, number][] {
  const spans: [number, number][] = [];
  if (!needle) return spans;
  let from = 0;
  while (from <= folded.length - needle.length) {
    const idx = folded.indexOf(needle, from);
    if (idx === -1) break;
    const end = idx + needle.length;
    const leftOk = idx === 0 || !WORD_CHAR.test(needle[0]!) || !WORD_CHAR.test(folded[idx - 1]!);
    const rightOk = end === folded.length || !WORD_CHAR.test(needle[needle.length - 1]!) || !WORD_CHAR.test(folded[end]!);
    if (leftOk && rightOk) {
      spans.push([idx, end]);
      from = end;
    } else {
      from = idx + 1;
    }
  }
  return spans;
}

function markUsed(folded: string, spans: readonly [number, number][]): string {
  let out = folded;
  for (const [s, e] of spans) out = out.slice(0, s) + USED.repeat(e - s) + out.slice(e);
  return out;
}

/**
 * The option texts in a candidate message, from the latest unsettled `options` block on `channel` (an assistant turn
 * with no non-system turn after it). A whole message that equals any option is a pick. A click on a `send` option
 * sends its text unchanged, so only a written `prefill` starter (`reply`) can sit inside longer text. A bare label
 * is a name the candidate may type by chance, so finding one inside typed text would take their own words away.
 */
export function matchUnsettledOptionTexts(
  entries: readonly { channel: string; role: string; blocks?: readonly ChatBlock[] }[],
  channel: string,
  candidateText: string,
): string[] | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || entry.channel !== channel || entry.role === "system") continue;
    if (entry.role !== "interviewer" && entry.role !== "coach") return undefined;
    const options: { text: string; folded: string; starter: boolean }[] = [];
    for (const block of entry.blocks ?? []) {
      if (block.kind !== "options") continue;
      for (const item of block.items) {
        const text = (item.reply ?? item.label).trim();
        const folded = foldForMatch(text).folded;
        const starter = block.action === "prefill" && item.reply !== undefined;
        if (folded && !options.some((o) => o.folded === folded && o.starter === starter)) options.push({ text, folded, starter });
      }
    }
    if (options.length === 0) return undefined;
    let remaining = foldForMatch(candidateText).folded;
    const whole = options.find((o) => o.folded === remaining);
    if (whole) return [whole.text];
    const matched: string[] = [];
    for (const o of options.filter((x) => x.starter).sort((a, b) => b.folded.length - a.folded.length)) {
      const spans = foldedSpans(remaining, o.folded);
      if (spans.length === 0) continue;
      if (!matched.includes(o.text)) matched.push(o.text);
      remaining = markUsed(remaining, spans);
    }
    return matched.length > 0 ? matched : undefined;
  }
  return undefined;
}

/**
 * Removes guide- or coach-written option text from a candidate message, leaving only the candidate's own words.
 * What is left with no letter or digit is empty, so a starter sent with only "." added is not evidence.
 */
export function stripOptionTexts(text: string, optionTexts: readonly string[] | undefined): string {
  if (!optionTexts || optionTexts.length === 0) return text;
  const { folded, source } = foldForMatch(text);
  let work = folded;
  const removed: [number, number][] = [];
  // Same order as the matcher (longest folded text first), so each stored text is found where the matcher found it.
  const foldedOptions = optionTexts.map((opt) => foldForMatch(opt).folded).sort((a, b) => b.length - a.length);
  for (const needle of foldedOptions) {
    const spans = foldedSpans(work, needle);
    for (const [s, e] of spans) removed.push([source[s]!, source[e - 1]! + 1]);
    work = markUsed(work, spans);
  }
  if (removed.length === 0) return text;
  removed.sort((a, b) => a[0] - b[0]);
  let out = "";
  let cursor = 0;
  let sep = "";
  for (const [s, e] of removed) {
    const piece = text.slice(cursor, s).trim();
    if (piece) out = out ? `${out}${sep}${piece}` : piece;
    sep = /[\r\n]/.test(text.slice(Math.max(0, s - 1), Math.min(text.length, e + 1))) ? "\n" : " ";
    cursor = e;
  }
  const tail = text.slice(cursor).trim();
  if (tail) out = out ? `${out}${sep}${tail}` : tail;
  out = out.replace(/\r\n?/g, "\n");
  return HAS_WORD.test(out) ? out : "";
}

export function candidateOwnText(entry: { text: string; optionTexts?: readonly string[] }): string {
  return stripOptionTexts(entry.text, entry.optionTexts);
}

// A reply places block N (1-based) by writing `<block N/>` alone on a line. Only whole lines outside fenced code
// count, so a marker can never split a list item, a table row or a code sample.
const MARKER_LINE = /^[ \t]*<block[ \t]+(\d{1,2})[ \t]*\/>[ \t]*$/;
const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})/;
// While a reply streams, the last line may be the start of a marker; it stays hidden until it settles either way.
const PARTIAL_MARKER_TAIL = /(?:^|\n)[ \t]*<(?:b(?:l(?:o(?:c(?:k(?:[ \t]+\d{0,2}[ \t]*\/?)?)?)?)?)?)?$/;

/** Calls `onMarker` for every marker line and `onText` for every other line, in order. */
function walkMarkerLines(text: string, onText: (line: string) => void, onMarker: (n: number) => void): void {
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const fenceMatch = FENCE_LINE.exec(line);
    if (fenceMatch) {
      const mark = fenceMatch[1]!;
      if (fence === null) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      onText(line);
      continue;
    }
    const marker = fence === null ? MARKER_LINE.exec(line) : null;
    if (marker) onMarker(Number(marker[1]));
    else onText(line);
  }
}

// Only blank lines at the ends go: blank lines inside the prose may sit inside a code sample.
function tidyLines(lines: readonly string[]): string {
  return lines.join("\n").replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, "");
}

/** Points each marker at a new block number, or drops it when `map` returns null. */
export function renumberBlockMarkers(text: string, map: (n: number) => number | null): string {
  if (!text.includes("<block")) return text;
  const out: string[] = [];
  walkMarkerLines(
    text,
    (line) => out.push(line),
    (n) => {
      const next = map(n);
      if (next !== null) out.push(`<block ${next}/>`);
    },
  );
  return tidyLines(out);
}

export type ReplySegment = { kind: "text"; text: string } | { kind: "block"; index: number };

/**
 * Splits a reply into prose and the blocks its markers place, in reading order. `trailing` lists the blocks with no
 * usable marker; they show after the prose. Options always trail, because they are the prompt for the next answer.
 * A marker for a missing block, a second marker for the same block, or a half-written marker while streaming shows nothing.
 */
export function segmentReply(text: string, blocks: readonly ChatBlock[], streaming = false): { segments: ReplySegment[]; trailing: number[] } {
  const source = streaming ? text.replace(PARTIAL_MARKER_TAIL, "") : text;
  if (!source.includes("<block")) {
    return { segments: source.trim() ? [{ kind: "text", text: source }] : [], trailing: blocks.map((_, i) => i) };
  }
  const segments: ReplySegment[] = [];
  const placed = new Set<number>();
  let lines: string[] = [];
  const flush = () => {
    const prose = tidyLines(lines);
    if (prose) segments.push({ kind: "text", text: prose });
    lines = [];
  };
  walkMarkerLines(
    source,
    (line) => lines.push(line),
    (n) => {
      const index = n - 1;
      const block = blocks[index];
      // A dropped marker still ends the paragraph, so prose does not jump when the block arrives after streaming.
      if (!block || block.kind === "options" || placed.has(index)) {
        lines.push("");
        return;
      }
      flush();
      placed.add(index);
      segments.push({ kind: "block", index });
    },
  );
  flush();
  const trailing = blocks.map((_, i) => i).filter((i) => !placed.has(i));
  return { segments, trailing };
}

/** The reply prose with every marker removed, for speech and anywhere blocks are not shown. */
export function stripBlockMarkers(text: string, streaming = false): string {
  return segmentReply(text, [], streaming)
    .segments.map((s) => (s.kind === "text" ? s.text : ""))
    .join("\n\n");
}

/** The reply as plain text with each block's text where its marker stands, and unplaced blocks after the prose. */
export function replyPlainText(text: string, blocks: readonly ChatBlock[] | undefined): string {
  const all = blocks ?? [];
  const { segments, trailing } = segmentReply(text, all);
  if (!segments.some((s) => s.kind === "block")) {
    const prose = segments.map((s) => (s.kind === "text" ? s.text : "")).join("\n\n");
    const blocksText = blocksToPlainText(all);
    return prose && blocksText ? `${prose}\n${blocksText}` : prose || blocksText;
  }
  const parts = segments.map((s) => (s.kind === "text" ? s.text : blockToPlainText(all[s.index]!)));
  for (const i of trailing) parts.push(blockToPlainText(all[i]!));
  return parts.filter(Boolean).join("\n\n");
}
