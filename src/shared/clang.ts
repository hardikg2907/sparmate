import type { CompileDiagnostic } from "./types";

// Lines longer than this are cut before any regex runs: template-heavy diagnostics can be megabytes long.
const MAX_LINE_CHARS = 2000;
const MAX_MESSAGE_CHARS = 600;
const MAX_DIAGNOSTICS = 200;

// file:line:col: severity: message      and, with -fdiagnostics-print-source-range-info,
// file:line:col:{l:c-l:c}{l:c-l:c}: severity: message
const LOCATION = /^(.+?):(\d+):(\d+):((?:\{\d+:\d+-\d+:\d+\})*):? (fatal error|error|warning|note|remark): (.*)$/;
const RANGE = /\{(\d+):(\d+)-(\d+):(\d+)\}/g;

/** Parses clang stderr into diagnostics for one file; lines about other files (system headers) are skipped. */
export function parseClangDiagnostics(stderr: string, filePath: string): CompileDiagnostic[] {
  const lines = stderr.split(/\r\n|\r|\n/);
  const results: CompileDiagnostic[] = [];
  const seen = new Set<string>();
  // An error raised inside a library header carries no location in the user's file, so it is attached to the
  // first "requested here" note that points back into the user's file.
  let foreignError: string | null = null;

  const push = (diagnostic: CompileDiagnostic): void => {
    const key = `${diagnostic.line}:${diagnostic.column}:${diagnostic.severity}:${diagnostic.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(diagnostic);
  };

  for (let i = 0; i < lines.length; i++) {
    const match = LOCATION.exec(capLine(lines[i] ?? ""));
    if (!match) continue;
    const [, file = "", lineText = "", columnText = "", ranges = "", severityText = "", rawMessage = ""] = match;
    const severity = toSeverity(severityText);
    const message = capMessage(rawMessage);

    if (!samePath(file, filePath)) {
      if (severity === "error" && foreignError === null) foreignError = message;
      continue;
    }

    const line = Number(lineText);
    const column = Number(columnText);
    const diagnostic: CompileDiagnostic = { line, column, severity, message, ...extent(ranges, line, column, lines, i) };

    if (foreignError !== null && severity === "note") push({ ...diagnostic, severity: "error", message: foreignError });
    foreignError = null;
    push(diagnostic);
    if (results.length >= MAX_DIAGNOSTICS) break;
  }
  return results;
}

/**
 * Converts clang's 1-based byte columns to the UTF-16 columns an editor uses.
 * Only lines that contain non-ASCII text change.
 */
export function toUtf16Columns(diagnostics: readonly CompileDiagnostic[], sourceText: string): CompileDiagnostic[] {
  const sourceLines = sourceText.split(/\r\n|\r|\n/);
  const convert = (lineNumber: number, byteColumn: number): number => {
    const text = sourceLines[lineNumber - 1];
    return text === undefined ? byteColumn : byteColumnToUtf16Column(text, byteColumn);
  };
  return diagnostics.map((d) => {
    const converted: CompileDiagnostic = { ...d, column: convert(d.line, d.column) };
    if (d.endColumn !== undefined) converted.endColumn = convert(d.endLine ?? d.line, d.endColumn);
    return converted;
  });
}

export function byteColumnToUtf16Column(lineText: string, byteColumn: number): number {
  const wanted = byteColumn - 1;
  let bytes = 0;
  let units = 0;
  for (const char of lineText) {
    if (bytes >= wanted) return units + 1;
    bytes += utf8Length(char.codePointAt(0) ?? 0);
    units += char.length;
  }
  return units + 1 + Math.max(0, wanted - bytes);
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Clang's printed ranges are not always anchored at the caret (a "no member named" error ranges over the object,
 * not the member), so a range is used only when it starts exactly at the reported position. Otherwise the word
 * under the caret is marked, read from the source snippet clang prints under the diagnostic.
 */
function extent(ranges: string, line: number, column: number, lines: readonly string[], diagnosticIndex: number): Pick<CompileDiagnostic, "endLine" | "endColumn"> {
  for (const range of ranges.matchAll(RANGE)) {
    const [, startLine, startColumn, endLine, endColumn] = range.map(Number) as [number, number, number, number, number];
    if (startLine !== line || startColumn !== column) continue;
    if (endLine > line) return { endLine, endColumn };
    return { endLine: line, endColumn: Math.max(endColumn, column + 1) };
  }
  return { endLine: line, endColumn: column + wordLengthAtCaret(lines, diagnosticIndex) };
}

function wordLengthAtCaret(lines: readonly string[], diagnosticIndex: number): number {
  const snippet = lines[diagnosticIndex + 1];
  const caretLine = lines[diagnosticIndex + 2];
  if (snippet === undefined || caretLine === undefined) return 1;
  const gutter = snippet.indexOf("|");
  if (gutter === -1 || gutter !== caretLine.indexOf("|") || !/^\s*\d+ $/.test(snippet.slice(0, gutter))) return 1;
  const caret = caretLine.indexOf("^");
  if (caret <= gutter) return 1;
  const word = /^[A-Za-z0-9_]+/.exec(snippet.slice(caret));
  return Math.max(1, word?.[0].length ?? 1);
}

function toSeverity(text: string): CompileDiagnostic["severity"] {
  if (text === "warning") return "warning";
  if (text === "note" || text === "remark") return "note";
  return "error";
}

function capLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line;
}

function capMessage(message: string): string {
  return message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS - 3)}...` : message;
}

/** Same file whether clang printed it absolute or relative, and whether or not macOS spelled it under /private. */
function samePath(reported: string, filePath: string): boolean {
  const a = normalizePath(reported);
  const b = normalizePath(filePath);
  if (a === b) return true;
  if (!a.startsWith("/") && b.endsWith(`/${a}`)) return true;
  return !b.startsWith("/") && a.endsWith(`/${b}`);
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push("..");
      continue;
    }
    parts.push(part);
  }
  const joined = (absolute ? "/" : "") + parts.join("/");
  return joined.replace(/^\/private(?=\/(?:var|tmp|etc)(?:\/|$))/, "");
}
