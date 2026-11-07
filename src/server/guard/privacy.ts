import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PrivacyGuard {
  /** Deny-listed terms found in `text` (case-insensitive, word boundaries, joined and look-alike forms included). */
  findViolations(text: string): string[];
  /** `text` with every deny-listed term replaced by "[redacted]". For logs. */
  redact(text: string): string;
  /** Number of terms loaded; the terms themselves are never exposed. */
  size(): number;
}

export interface PrivacyGuardOptions {
  claudeJsonPath?: string;
  denylistPath?: string;
}

const COMMON_MAIL_PROVIDERS = new Set(["gmail", "outlook", "hotmail", "yahoo", "icloud", "proton", "protonmail", "live", "me"]);

// Parts of a public suffix such as `co.in` or `com.au`; they are never a name of their own.
const SECOND_LEVEL_SUFFIXES = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ne", "or", "go", "nic", "res", "mil", "ltd", "plc", "sch"]);

// A domain that is only a mail host or a generic prefix names nobody.
const COMMON_SUBDOMAINS = new Set(["mail", "email", "webmail", "smtp", "mx", "in", "corp", "www", "app", "my", "office", "intranet", "internal"]);

// Short fragments such as "me" or "jd" would match everyday words and make the guard unusable.
const MIN_DERIVED_TERM_LENGTH = 3;

/** What `redact` puts in place of a term; callers that must drop a redaction instead can look for it. */
export const REDACTED = "[redacted]";
const JSON_READ_ATTEMPTS = 3;
const JSON_RETRY_DELAY_MS = 40;

interface Term {
  text: string;
  pattern: RegExp;
  needsLeftBoundary: boolean;
  needsRightBoundary: boolean;
}

interface Span {
  start: number;
  end: number;
  term: string;
}

export async function loadPrivacyGuard(options?: PrivacyGuardOptions): Promise<PrivacyGuard> {
  const claudeJsonPath = options?.claudeJsonPath ?? process.env.SPARMATE_CLAUDE_JSON ?? join(homedir(), ".claude.json");
  const denylistPath = options?.denylistPath ?? process.env.SPARMATE_DENYLIST ?? join(homedir(), ".config", "sparmate", "denylist.txt");

  const texts = new Set<string>();
  for (const term of await termsFromClaudeJson(claudeJsonPath)) texts.add(term);
  for (const term of await termsFromDenylist(denylistPath)) texts.add(term);

  const terms = [...texts].map(compileTerm).filter((term): term is Term => term !== null);
  return {
    findViolations(text: string): string[] {
      const found = new Set<string>();
      for (const span of collectSpans(terms, text)) found.add(span.term);
      return [...found];
    },
    redact(text: string): string {
      const spans = chooseNonOverlapping(collectSpans(terms, text));
      if (spans.length === 0) return text;
      let out = "";
      let cursor = 0;
      for (const span of spans) {
        out += text.slice(cursor, span.start) + REDACTED;
        cursor = span.end;
      }
      return out + text.slice(cursor);
    },
    size(): number {
      return terms.length;
    },
  };
}

async function termsFromClaudeJson(path: string): Promise<string[]> {
  const raw = await readTextIfPresent(path);
  if (raw === null) return [];
  const parsed = await parseJsonWithRetry(raw, path);
  const account = isRecord(parsed) ? parsed.oauthAccount : undefined;
  const email = isRecord(account) && typeof account.emailAddress === "string" ? account.emailAddress.trim() : "";
  return deriveEmailTerms(email);
}

function deriveEmailTerms(email: string): string[] {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return [];
  const terms = [email.toLowerCase()];
  const local = email.slice(0, at).toLowerCase();
  if (local.length >= MIN_DERIVED_TERM_LENGTH) terms.push(local);
  const name = registrableName(email.slice(at + 1).toLowerCase());
  if (name.length >= MIN_DERIVED_TERM_LENGTH && !COMMON_MAIL_PROVIDERS.has(name) && !COMMON_SUBDOMAINS.has(name)) terms.push(name);
  return terms;
}

/** The name an organisation registers: the label next to the public suffix, so `mail.quuxly.co.in` gives `quuxly`. */
function registrableName(domain: string): string {
  const labels = domain.split(".").filter((label) => label !== "");
  if (labels.length < 2) return "";
  labels.pop();
  const second = labels.at(-1) ?? "";
  if (labels.length >= 2 && SECOND_LEVEL_SUFFIXES.has(second)) labels.pop();
  return labels.at(-1) ?? "";
}

async function termsFromDenylist(path: string): Promise<string[]> {
  const raw = await readTextIfPresent(path);
  if (raw === null) return [];
  const terms: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    // A "#" inside a term (for example "c#") stays; only " #..." starts a trailing comment.
    const term = trimmed
      .replace(/\s+#.*$/, "")
      .trim()
      .toLowerCase();
    if (term !== "") terms.push(term);
  }
  return terms;
}

/** A missing file is normal; any other read failure must stop start-up rather than silently weaken the guard. */
async function readTextIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw new Error(`Privacy guard cannot read ${path}: ${code ?? "unknown error"}`, { cause: error });
  }
}

/** The account file is rewritten by another program, so one failed parse can be a half-written read. */
async function parseJsonWithRetry(firstRaw: string, path: string): Promise<unknown> {
  let raw = firstRaw;
  for (let attempt = 1; ; attempt++) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      if (attempt >= JSON_READ_ATTEMPTS) throw new Error(`Privacy guard cannot parse ${path}`);
      await new Promise((resolve) => setTimeout(resolve, JSON_RETRY_DELAY_MS));
      raw = (await readTextIfPresent(path)) ?? "";
    }
  }
}

// A term longer than this is cut; a longer line is not a name.
const MAX_TERM_CHARS = 200;
// Text is scanned in windows so no single pass runs over an unbounded input; the overlap is longer than any term.
const SCAN_WINDOW = 200_000;
const SCAN_OVERLAP = 4096;

/** Text reduced to a comparable form, with the original position of every unit kept for redaction. */
interface Folded {
  text: string;
  /** True where the original letter was upper case, so camelCase still marks a word edge after case folding. */
  upper: boolean[];
  from: number[];
  to: number[];
}

const SEPARATOR = /^[\s\p{Pd}_./\\|·•‧]$/u;
const INVISIBLE = /^[\p{Cf}\p{Cc}\u0300-\u036f\ufe00-\ufe0f\u{e0100}-\u{e01ef}\u115f\u1160\u3164\uffa0\u2800]$/u;

// Letters from other scripts that read as a Latin letter; typed in place of it they hide a name.
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: "a",
  в: "b",
  е: "e",
  ё: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  ө: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  ѕ: "s",
  і: "i",
  ј: "j",
  ԁ: "d",
  ӏ: "l",
  ѡ: "w",
  ԛ: "q",
  α: "a",
  β: "b",
  γ: "y",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  ω: "w",
  ϲ: "c",
  ı: "i",
  ł: "l",
  ø: "o",
  đ: "d",
  ħ: "h",
  ŧ: "t",
  ɑ: "a",
  ɡ: "g",
};

function fold(text: string): Folded {
  const out: Folded = { text: "", upper: [], from: [], to: [] };
  let afterSeparator = false;
  let at = 0;
  for (const original of text) {
    const start = at;
    at += original.length;
    for (const piece of original.normalize("NFKC")) {
      // U+FEFF counts as white space to the regex engine but is an invisible character here.
      if (piece !== "﻿" && SEPARATOR.test(piece)) {
        // A run of separators of any length is one gap, so padding cannot split a name.
        if (afterSeparator) out.to[out.to.length - 1] = at;
        else push(out, " ", false, start, at);
        afterSeparator = true;
        continue;
      }
      if (INVISIBLE.test(piece)) continue;
      afterSeparator = false;
      const lower = piece.toLowerCase();
      const isUpperCase = lower !== piece && /^\p{Lu}$/u.test(piece);
      let first = true;
      for (const unit of lower) {
        if (INVISIBLE.test(unit)) continue;
        const mapped = CONFUSABLES[unit] ?? unit;
        push(out, mapped, isUpperCase && first, start, at);
        first = false;
      }
    }
  }
  return out;
}

function push(out: Folded, chars: string, upper: boolean, from: number, to: number): void {
  for (let i = 0; i < chars.length; i++) {
    out.upper.push(upper && i === 0);
    out.from.push(from);
    out.to.push(to);
  }
  out.text += chars;
}

function compileTerm(text: string): Term | null {
  const folded = fold(text.slice(0, MAX_TERM_CHARS)).text.trim();
  if (folded === "") return null;
  // Words may touch, so `zorblax corp` also catches `ZorblaxCorp`; any other gap was already folded to one space.
  const pattern = folded
    .split(" ")
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(" ?");
  const first = [...folded][0] ?? "";
  const last = [...folded].at(-1) ?? "";
  return { text, pattern: new RegExp(pattern, "gu"), needsLeftBoundary: isAlnum(first), needsRightBoundary: isAlnum(last) };
}

function collectSpans(terms: readonly Term[], text: string): Span[] {
  if (text.length <= SCAN_WINDOW) return scanWindow(terms, text, 0);
  const spans: Span[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + SCAN_WINDOW);
    if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end--;
    spans.push(...scanWindow(terms, text.slice(start, end), start));
    if (end >= text.length) break;
    start = end - SCAN_OVERLAP;
    if (isLowSurrogate(text.charCodeAt(start))) start++;
  }
  return spans;
}

function scanWindow(terms: readonly Term[], raw: string, offset: number): Span[] {
  const view = fold(raw);
  const spans: Span[] = [];
  for (const term of terms) {
    term.pattern.lastIndex = 0;
    for (let match = term.pattern.exec(view.text); match !== null; match = term.pattern.exec(view.text)) {
      const start = match.index;
      const end = start + match[0].length;
      const step = (view.text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1;
      // Overlapping occurrences of the same term (such as "aa" in "aaa") still count.
      term.pattern.lastIndex = start + step;
      if (end === start) continue;
      if (term.needsLeftBoundary && !boundaryBefore(view, start)) continue;
      if (term.needsRightBoundary && !boundaryAfter(view, end)) continue;
      spans.push({ start: offset + (view.from[start] ?? 0), end: offset + (view.to[end - 1] ?? raw.length), term: term.text });
    }
  }
  return spans;
}

/** Longest match first at each position, so an address is redacted as one unit, not piece by piece. */
function chooseNonOverlapping(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const chosen: Span[] = [];
  let cursor = 0;
  for (const span of sorted) {
    if (span.start < cursor) continue;
    chosen.push(span);
    cursor = span.end;
  }
  return chosen;
}

// Word boundaries also split snake_case and camelCase, because identifiers are where names leak.
function boundaryBefore(view: Folded, index: number): boolean {
  if (index === 0) return true;
  const previous = unitBefore(view.text, index);
  const previousChar = view.text.slice(previous, index);
  if (!isAlnum(previousChar)) return true;
  return (isLowerAt(view, previous) || isDigit(previousChar)) && view.upper[index] === true;
}

function boundaryAfter(view: Folded, index: number): boolean {
  if (index >= view.text.length) return true;
  const last = unitBefore(view.text, index);
  const lastChar = view.text.slice(last, index);
  const next = charAt(view.text, index);
  if (!isAlnum(next)) return true;
  const nextUpper = view.upper[index] === true;
  if (nextUpper && (isLowerAt(view, last) || isDigit(lastChar))) return true;
  const afterNext = index + next.length;
  return nextUpper && view.upper[last] === true && afterNext < view.text.length && !view.upper[afterNext] && isLowerAt(view, afterNext);
}

function isLowerAt(view: Folded, index: number): boolean {
  return view.upper[index] !== true && /^\p{Ll}$/u.test(charAt(view.text, index));
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function charAt(text: string, index: number): string {
  const code = text.codePointAt(index);
  return code === undefined ? "" : String.fromCodePoint(code);
}

/** Index of the code point that ends just before `index`. */
function unitBefore(text: string, index: number): number {
  const high = text.charCodeAt(index - 2);
  return isLowSurrogate(text.charCodeAt(index - 1)) && index >= 2 && high >= 0xd800 && high <= 0xdbff ? index - 2 : index - 1;
}

function isAlnum(char: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(char);
}
function isDigit(char: string): boolean {
  return /^\p{N}$/u.test(char);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
