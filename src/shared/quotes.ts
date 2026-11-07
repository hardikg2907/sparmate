import type { Scorecard } from "./types";

/** Folds text so cosmetic differences (curly quotes, spacing, case, ellipsis glyphs) never fail a quote. */
function fold(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const EDGE_QUOTES = /^["'`\s]+/;
const TRAILING_MARKS = /["'`.,;:!?\s]+$/;

export function normalizeQuote(text: string): string {
  return fold(text).replace(EDGE_QUOTES, "").replace(TRAILING_MARKS, "");
}

/** Checks every evidence quote in a scorecard against the text it claims to come from. */
export function checkQuotes(
  scorecard: Pick<Scorecard, "dimensions">,
  sources: { candidate: string; board: string; code: string },
): { dimensionId: string; index: number; verified: boolean }[] {
  const folded = {
    candidate: fold(sources.candidate),
    board: fold(sources.board),
    code: fold(sources.code),
  };
  const results: { dimensionId: string; index: number; verified: boolean }[] = [];
  for (const dimension of scorecard.dimensions) {
    dimension.evidence.forEach((evidence, index) => {
      const source = folded[evidence.source] ?? "";
      results.push({ dimensionId: dimension.id, index, verified: quoteAppears(evidence.quote, source) });
    });
  }
  return results;
}

type QuoteSources = { candidate: string; board: string; code: string };

/** Checks every step evidence quote against the text it claims to come from; a function gives each step its own text. */
export function checkStepQuotes(
  scorecard: { steps?: readonly { phase: string; took: readonly { evidence: { quote: string; source: "candidate" | "board" | "code" } }[] }[] },
  sources: QuoteSources | ((phase: string) => QuoteSources),
): { phase: string; index: number; verified: boolean }[] {
  const results: { phase: string; index: number; verified: boolean }[] = [];
  const seen = new Set<string>();
  for (const step of scorecard.steps ?? []) {
    if (seen.has(step.phase)) continue;
    seen.add(step.phase);
    const own = typeof sources === "function" ? sources(step.phase) : sources;
    const folded = { candidate: fold(own.candidate), board: fold(own.board), code: fold(own.code) };
    step.took.forEach((item, index) => {
      const source = folded[item.evidence.source] ?? "";
      results.push({ phase: step.phase, index, verified: quoteAppears(item.evidence.quote, source) });
    });
  }
  return results;
}

/** An ellipsis inside a quote splits it into parts that must all appear in the source, in order. */
function quoteAppears(quote: string, foldedSource: string): boolean {
  const normalized = normalizeQuote(quote);
  if (normalized === "") return false;
  const parts = normalized
    .split("...")
    .map((part) => part.replace(EDGE_QUOTES, "").replace(TRAILING_MARKS, ""))
    .filter((part) => part !== "");
  if (parts.length === 0) return false;

  let from = 0;
  for (const part of parts) {
    const at = findWhole(foldedSource, part, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return true;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** First match at or after `from` that does not start or end inside a word, so "ache" never matches "cache". */
function findWhole(source: string, part: string, from: number): number {
  const first = part[0] ?? "";
  const last = part[part.length - 1] ?? "";
  for (let at = source.indexOf(part, from); at !== -1; at = source.indexOf(part, at + 1)) {
    const before = source[at - 1];
    const after = source[at + part.length];
    const startOk = !WORD_CHAR.test(first) || before === undefined || !WORD_CHAR.test(before);
    const endOk = !WORD_CHAR.test(last) || after === undefined || !WORD_CHAR.test(after);
    if (startOk && endOk) return at;
  }
  return -1;
}

/** True when `quote` appears in `source` under the same folding and ellipsis rules as the scorecard checks. */
export function quoteIn(quote: string, source: string): boolean {
  return quoteAppears(quote, fold(source));
}
