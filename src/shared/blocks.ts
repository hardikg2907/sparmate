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

const WORD_CHAR = /[\p{L}\p{N}_]/u;
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
  for (const opt of [...optionTexts].sort((a, b) => b.length - a.length)) {
    const spans = foldedSpans(work, foldForMatch(opt).folded);
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
