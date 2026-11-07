import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PrivacyGuard {
  /** Deny-listed terms found in `text` (case-insensitive, word boundaries). */
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

const COMMON_MAIL_PROVIDERS = new Set([
  "gmail",
  "outlook",
  "hotmail",
  "yahoo",
  "icloud",
  "proton",
  "protonmail",
  "live",
  "me",
]);

// Short fragments such as "me" or "jd" would match everyday words and make the guard unusable.
const MIN_DERIVED_TERM_LENGTH = 3;

const REDACTED = "[redacted]";
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
  const claudeJsonPath = options?.claudeJsonPath ?? process.env.IR_CLAUDE_JSON ?? join(homedir(), ".claude.json");
  const denylistPath =
    options?.denylistPath ?? process.env.IR_DENYLIST ?? join(homedir(), ".config", "interview-room", "denylist.txt");

  const texts = new Set<string>();
  for (const term of await termsFromClaudeJson(claudeJsonPath)) texts.add(term);
  for (const term of await termsFromDenylist(denylistPath)) texts.add(term);

  const terms = [...texts].map(compileTerm);
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
  const label = email.slice(at + 1).split(".")[0]?.toLowerCase() ?? "";
  if (label.length >= MIN_DERIVED_TERM_LENGTH && !COMMON_MAIL_PROVIDERS.has(label)) terms.push(label);
  return terms;
}

async function termsFromDenylist(path: string): Promise<string[]> {
  const raw = await readTextIfPresent(path);
  if (raw === null) return [];
  const terms: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    // A "#" inside a term (for example "c#") stays; only " #..." starts a trailing comment.
    const term = trimmed.replace(/\s+#.*$/, "").trim().toLowerCase();
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
    throw new Error(`Privacy guard cannot read ${path}: ${code ?? "unknown error"}`);
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

function compileTerm(text: string): Term {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const first = [...text][0] ?? "";
  const last = [...text].at(-1) ?? "";
  return {
    text,
    pattern: new RegExp(escaped, "giu"),
    needsLeftBoundary: isAlnum(first),
    needsRightBoundary: isAlnum(last),
  };
}

function collectSpans(terms: readonly Term[], text: string): Span[] {
  const spans: Span[] = [];
  for (const term of terms) {
    term.pattern.lastIndex = 0;
    for (let match = term.pattern.exec(text); match !== null; match = term.pattern.exec(text)) {
      const start = match.index;
      const end = start + match[0].length;
      const step = (text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1;
      // Overlapping occurrences of the same term (such as "aa" in "aaa") still count.
      term.pattern.lastIndex = start + step;
      if (end === start) continue;
      if (term.needsLeftBoundary && !boundaryBefore(text, start)) continue;
      if (term.needsRightBoundary && !boundaryAfter(text, end)) continue;
      spans.push({ start, end, term: term.text });
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
function boundaryBefore(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = charBefore(text, index);
  const current = charAt(text, index);
  if (!isAlnum(previous)) return true;
  return (isLower(previous) || isDigit(previous)) && isUpper(current);
}

function boundaryAfter(text: string, index: number): boolean {
  if (index >= text.length) return true;
  const last = charBefore(text, index);
  const next = charAt(text, index);
  if (!isAlnum(next)) return true;
  if (isUpper(next) && (isLower(last) || isDigit(last))) return true;
  const afterNext = charAt(text, index + next.length);
  return isUpper(next) && isUpper(last) && isLower(afterNext);
}

function charAt(text: string, index: number): string {
  const code = text.codePointAt(index);
  return code === undefined ? "" : String.fromCodePoint(code);
}

function charBefore(text: string, index: number): string {
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text.slice(index - 1, index);
}

function isAlnum(char: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(char);
}
function isLower(char: string): boolean {
  return /^\p{Ll}$/u.test(char);
}
function isUpper(char: string): boolean {
  return /^\p{Lu}$/u.test(char);
}
function isDigit(char: string): boolean {
  return /^\p{N}$/u.test(char);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
