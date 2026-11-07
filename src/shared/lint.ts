/** The mechanical checks from the "How to write" rule in TEACHING.md. Returns short issue descriptions; empty when clean. */
export function lintProse(text: string): string[] {
  const issues: string[] = [];
  const paragraphs = splitParagraphs(text);
  paragraphs.forEach((paragraph, index) => {
    const label = `Paragraph ${index + 1} ("${preview(paragraph)}")`;

    const dashes = (paragraph.match(/—/g) ?? []).length;
    if (dashes > 1) issues.push(`${label} has ${dashes} em-dashes; the limit is one.`);

    for (const sentence of splitSentences(paragraph)) {
      const symbols = [...new Set(sentence.match(SYMBOLS) ?? [])];
      if (symbols.length > 0) {
        issues.push(`${label} uses ${symbols.map((s) => `"${s}"`).join(" and ")} in a sentence; write the words instead.`);
      }
      const opener = sentence.match(SOFT_OPENER)?.[1];
      if (opener !== undefined) {
        issues.push(`Soft issue: ${label} has a sentence starting with "${opener}"; name the thing instead.`);
      }
    }

    const words = countWords(paragraph);
    if (words > MAX_PARAGRAPH_WORDS) issues.push(`${label} has ${words} words; the limit is ${MAX_PARAGRAPH_WORDS}.`);
  });
  return issues;
}

const MAX_PARAGRAPH_WORDS = 300;
const SYMBOLS = /[→≈⇒×]/g;
const SOFT_OPENER = /^(That's|This is|It's)\b/;
const PREVIEW_CHARS = 40;

/** Prose paragraphs with fenced code, inline code and table rows removed. List items and headings count as their own paragraphs. */
function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = (): void => {
    const joined = current.join(" ").replace(/\s+/g, " ").trim();
    if (joined !== "") paragraphs.push(joined);
    current = [];
  };

  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const fenceMatch = rawLine.match(/^\s*(```+|~~~+)/);
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1]!.startsWith(fence[0]!) && fenceMatch[1]!.length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1]!;
      continue;
    }
    if (rawLine.trim() === "" || isTableRow(rawLine) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(rawLine)) {
      flush();
      continue;
    }

    const startsBlock = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(rawLine);
    if (startsBlock) flush();
    current.push(stripMarkdown(rawLine));
    if (/^\s*#{1,6}\s/.test(rawLine)) flush();
  }
  flush();
  return paragraphs;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 1;
}

function stripMarkdown(line: string): string {
  return line
    .replace(/`[^`]*`/g, " ")
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/[‘’]/g, "'")
    .replace(/\*+/g, "")
    .replace(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, "");
}

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+(?=["'(\[]?[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function countWords(paragraph: string): number {
  return paragraph.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

function preview(paragraph: string): string {
  const flat = paragraph.replace(/"/g, "'");
  return flat.length <= PREVIEW_CHARS ? flat : `${flat.slice(0, PREVIEW_CHARS).trimEnd()}...`;
}
