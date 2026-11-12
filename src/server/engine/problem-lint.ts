// A missed Extra is never a gap, but a missed hire-bar item is one. So a hire-bar item that restates an Extra,
// with no "when asked" wording, tells the judge two opposite things.

const STOP = new Set([
  "each",
  "from",
  "have",
  "into",
  "make",
  "more",
  "most",
  "only",
  "over",
  "same",
  "some",
  "such",
  "than",
  "that",
  "them",
  "then",
  "they",
  "this",
  "uses",
  "when",
  "will",
  "with",
  "your",
  "about",
  "above",
  "after",
  "again",
  "also",
  "always",
  "another",
  "because",
  "before",
  "being",
  "between",
  "candidate",
  "could",
  "every",
  "other",
  "should",
  "still",
  "their",
  "there",
  "these",
  "those",
  "under",
  "until",
  "using",
  "where",
  "which",
  "while",
  "whose",
  "would",
  "without",
]);

const HEDGE = /\bwhen (?:asked|probed)\b|\bwhen [^.,;:]{0,40} comes up\b|\bif (?:asked|probed)\b|\bonly when\b/i;

function bullets(block: string): string[] {
  const out: string[] = [];
  for (const line of block.split("\n")) {
    if (/^\s*[-*] /.test(line)) out.push(line.replace(/^\s*[-*] /, ""));
    else if (out.length && /^\s+\S/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

function contentWords(text: string): Set<string> {
  const plain = text.replace(/\*[^*]*:\*/g, " ").replace(/[`*_]/g, "");
  const words = new Set<string>();
  for (const raw of plain.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 4 || STOP.has(raw)) continue;
    words.add(raw.slice(0, 5));
  }
  return words;
}

/** The Extras bullets of "Expected requirements". */
export function extraItems(requirements: string): string[] {
  const at = requirements.search(/^Extras\b.*$/m);
  return at < 0 ? [] : bullets(requirements.slice(at).split("\n").slice(1).join("\n"));
}

/** The hire-bar bullets of "Level bar", up to the stretch list. */
export function hireBarItems(levelBar: string): string[] {
  const lines = levelBar.split("\n");
  const start = lines.findIndex((l) => /^Hire bar\b/.test(l));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^(Stretch|Below)\b/.test(l));
  return bullets((end < 0 ? rest : rest.slice(0, end)).join("\n"));
}

export interface ExtraClash {
  extra: string;
  hire: string;
}

/**
 * Hire-bar items that restate an Extra without saying they apply only when the interviewer asks.
 * It matches shared words, so it catches near-copies, not every item that needs an Extra.
 */
export function extrasHireBarClashes(sections: Readonly<Record<string, string | undefined>>): ExtraClash[] {
  const extras = extraItems(sections["Expected requirements"] ?? "");
  const hires = hireBarItems(sections["Level bar"] ?? "").filter((h) => !HEDGE.test(h));
  const clashes: ExtraClash[] = [];
  for (const extra of extras) {
    const wanted = contentWords(extra);
    if (wanted.size < 2) continue;
    const need = Math.max(3, Math.ceil(wanted.size * 0.6));
    for (const hire of hires) {
      const have = contentWords(hire);
      let shared = 0;
      for (const w of wanted) if (have.has(w)) shared++;
      if (shared >= need) clashes.push({ extra, hire });
    }
  }
  return clashes;
}
