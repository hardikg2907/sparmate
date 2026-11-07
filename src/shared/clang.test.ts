import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { byteColumnToUtf16Column, parseClangDiagnostics, toUtf16Columns } from "./clang";

// Each .stderr file is real output from the machine's Apple clang with the runner's flags, compiled from the
// .cpp file next to it under /tmp/ir-fixtures.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string, ext: "stderr" | "cpp" = "stderr"): string => readFileSync(join(here, "__fixtures__", "clang", `${name}.${ext}`), "utf8");
const pathOf = (name: string): string => `/tmp/ir-fixtures/${name}.cpp`;
const parse = (name: string) => parseClangDiagnostics(fixture(name), pathOf(name));

describe("parseClangDiagnostics on real clang output", () => {
  it("parses an undeclared identifier and marks the identifier", () => {
    expect(parse("undeclared")).toEqual([
      { line: 9, column: 16, endLine: 9, endColumn: 21, severity: "error", message: "use of undeclared identifier 'bonus'" },
    ]);
  });

  it("parses a missing semicolon, which has no range, as a one-character mark", () => {
    expect(parse("missing_semicolon")).toEqual([
      { line: 5, column: 11, endLine: 5, endColumn: 12, severity: "error", message: "expected ';' at end of declaration list" },
      { line: 10, column: 28, endLine: 10, endColumn: 29, severity: "error", message: "expected ';' after expression" },
    ]);
  });

  it("ignores a range that does not start at the caret and marks the member name instead", () => {
    // clang reports the range of the object (`s`, columns 3 to 4) but puts the caret on the member.
    expect(parse("missing_member")).toEqual([
      { line: 11, column: 5, endLine: 11, endColumn: 12, severity: "error", message: "no member named 'release' in 'Spot'" },
      { line: 12, column: 18, endLine: 12, endColumn: 23, severity: "error", message: "no member named 'floor' in 'Spot'" },
    ]);
  });

  it("skips notes inside system headers and keeps the errors in the user's file", () => {
    const diagnostics = parse("type_mismatch");
    expect(diagnostics.map((d) => [d.line, d.column, d.severity])).toEqual([
      [7, 7, "error"],
      [9, 5, "error"],
      [10, 15, "error"],
    ]);
    expect(diagnostics[0]).toMatchObject({ endLine: 7, endColumn: 16, message: "no matching member function for call to 'push_back'" });
    expect(diagnostics[1]).toMatchObject({ endLine: 9, endColumn: 11, message: "no matching member function for call to 'insert'" });
    expect(diagnostics[2]).toMatchObject({ endLine: 10, endColumn: 16 });
    expect(diagnostics.some((d) => d.message.includes("candidate"))).toBe(false);
    expect(diagnostics.some((d) => d.severity === "note")).toBe(false);
  });

  it("trusts a range that starts exactly at the caret", () => {
    expect(parse("missing_header")).toEqual([
      { line: 2, column: 10, endLine: 2, endColumn: 21, severity: "error", message: "'optionall' file not found" },
    ]);
  });

  it("parses warnings with their flag and maps notes and remarks to the note severity", () => {
    const diagnostics = parse("warning");
    expect(diagnostics).toEqual([
      { line: 4, column: 7, endLine: 4, endColumn: 13, severity: "warning", message: "unused variable 'unused' [-Wunused-variable]" },
      { line: 8, column: 1, endLine: 8, endColumn: 2, severity: "warning", message: "non-void function does not return a value in all control paths [-Wreturn-type]" },
      { line: 10, column: 14, endLine: 10, endColumn: 18, severity: "warning", message: "unused parameter 'argc' [-Wunused-parameter]" },
      { line: 10, column: 27, endLine: 10, endColumn: 31, severity: "warning", message: "unused parameter 'argv' [-Wunused-parameter]" },
    ]);
  });

  it("keeps notes that point into the user's file, in order", () => {
    const diagnostics = parse("redefinition");
    expect(diagnostics.map((d) => [d.line, d.column, d.severity, d.message])).toEqual([
      [6, 7, "error", "redefinition of 'Gate'"],
      [1, 7, "note", "previous definition is here"],
      [13, 7, "error", "redefinition of 'value'"],
      [12, 7, "note", "previous definition is here"],
    ]);
    expect(diagnostics[0]).toMatchObject({ endColumn: 11 });
    expect(diagnostics[2]).toMatchObject({ endColumn: 12 });
  });

  it("attaches an error raised inside a library header to the note that points back into the user's file", () => {
    const diagnostics = parse("header_error");
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      line: 10,
      column: 4,
      severity: "error",
      message: "invalid operands to binary expression ('const Key' and 'const Key')",
    });
    expect(diagnostics[1]).toMatchObject({ line: 10, column: 4, severity: "note" });
    expect(diagnostics[1]!.message).toMatch(/^in instantiation of member function 'std::map<Key, int>::operator\[\]' requested here/);
  });

  it("returns nothing for link errors, which have no source location", () => {
    expect(parse("link_error")).toEqual([]);
    expect(parse("no_main")).toEqual([]);
  });

  it("reads byte columns, which UTF-16 conversion then fixes for lines with non-ASCII text", () => {
    const diagnostics = parse("tabs");
    expect(diagnostics.map((d) => [d.line, d.column])).toEqual([
      [4, 15],
      [4, 29],
    ]);
    const fixed = toUtf16Columns(diagnostics, fixture("tabs", "cpp"));
    expect(fixed.map((d) => [d.line, d.column, d.endColumn])).toEqual([
      [4, 15, 16],
      [4, 27, 28],
    ]);
  });

  it("returns nothing for the other files' diagnostics", () => {
    expect(parseClangDiagnostics(fixture("undeclared"), "/tmp/ir-fixtures/other.cpp")).toEqual([]);
  });
});

describe("parseClangDiagnostics on synthetic input", () => {
  it("returns an empty list for empty and unrelated text", () => {
    expect(parseClangDiagnostics("", "/a/b.cpp")).toEqual([]);
    expect(parseClangDiagnostics("1 error generated.\nIn file included from /a/b.cpp:1:\n", "/a/b.cpp")).toEqual([]);
    expect(parseClangDiagnostics("clang++: error: no input files\n", "/a/b.cpp")).toEqual([]);
  });

  it("matches a relative path in the output to an absolute file path", () => {
    const stderr = "b.cpp:3:5: error: expected ';' after expression\n";
    expect(parseClangDiagnostics(stderr, "/a/b.cpp")).toHaveLength(1);
    expect(parseClangDiagnostics(stderr, "/a/c.cpp")).toHaveLength(0);
    expect(parseClangDiagnostics(stderr, "/a/ab.cpp")).toHaveLength(0);
  });

  it("matches paths spelled with and without the macOS /private prefix, and with dot segments", () => {
    const stderr = "/private/var/folders/xx/T/run-abc/candidate.cpp:2:1: error: boom\n";
    expect(parseClangDiagnostics(stderr, "/var/folders/xx/T/run-abc/candidate.cpp")).toHaveLength(1);
    expect(parseClangDiagnostics("/a/./x/../b.cpp:1:1: error: boom", "/a/b.cpp")).toHaveLength(1);
  });

  it("handles Windows line endings", () => {
    const stderr = "/a/b.cpp:1:2: error: first\r\n/a/b.cpp:3:4: warning: second\r\n";
    expect(parseClangDiagnostics(stderr, "/a/b.cpp").map((d) => d.severity)).toEqual(["error", "warning"]);
  });

  it("removes duplicate diagnostics", () => {
    const stderr = "/a/b.cpp:1:2: error: same\n/a/b.cpp:1:2: error: same\n/a/b.cpp:1:2: warning: same\n";
    expect(parseClangDiagnostics(stderr, "/a/b.cpp")).toHaveLength(2);
  });

  it("cuts very long messages and survives a line of several megabytes quickly", () => {
    const longMessage = "x".repeat(5000);
    const [diagnostic] = parseClangDiagnostics(`/a/b.cpp:1:2: error: ${longMessage}\n`, "/a/b.cpp");
    expect(diagnostic!.message.length).toBeLessThanOrEqual(600);

    const hostile = `${"/a/b.cpp:1:2:".repeat(400_000)}\n`;
    const started = performance.now();
    parseClangDiagnostics(hostile, "/a/b.cpp");
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("caps each line at 2,000 characters before matching", () => {
    // The severity keyword sits after character 2,000, so the capped line cannot match.
    const padding = "p".repeat(2100);
    expect(parseClangDiagnostics(`/a/b.cpp:1:2:${padding} error: late`, "/a/b.cpp")).toEqual([]);
  });

  it("limits the number of diagnostics returned", () => {
    const stderr = Array.from({ length: 500 }, (_, i) => `/a/b.cpp:${i + 1}:1: warning: w${i}`).join("\n");
    expect(parseClangDiagnostics(stderr, "/a/b.cpp")).toHaveLength(200);
  });

  it("treats a multi-line range as ending on its own end line", () => {
    const stderr = "/a/b.cpp:3:5:{3:5-5:2}: error: unterminated thing\n";
    expect(parseClangDiagnostics(stderr, "/a/b.cpp")).toEqual([
      { line: 3, column: 5, endLine: 5, endColumn: 2, severity: "error", message: "unterminated thing" },
    ]);
  });

  it("guarantees an end column at least one past the start", () => {
    const stderr = "/a/b.cpp:3:5:{3:5-3:5}: error: empty range\n";
    expect(parseClangDiagnostics(stderr, "/a/b.cpp")[0]).toMatchObject({ column: 5, endColumn: 6 });
  });

  it("picks the range that starts at the caret when several are printed", () => {
    const stderr = "/a/b.cpp:2:8:{2:3-2:6}{2:8-2:11}: error: two ranges\n";
    expect(parseClangDiagnostics(stderr, "/a/b.cpp")[0]).toMatchObject({ column: 8, endColumn: 11 });
  });
});

describe("byteColumnToUtf16Column", () => {
  it("leaves ASCII lines unchanged", () => {
    expect(byteColumnToUtf16Column("int x = 1;", 5)).toBe(5);
  });

  it("subtracts the extra bytes of multi-byte characters before the column", () => {
    // "→" is three bytes in UTF-8 and one UTF-16 unit.
    expect(byteColumnToUtf16Column('"→" << z', 8)).toBe(6);
    // An emoji is four bytes and two UTF-16 units.
    expect(byteColumnToUtf16Column("\u{1F600}x", 5)).toBe(3);
  });

  it("does not move a column that sits before the first non-ASCII character", () => {
    expect(byteColumnToUtf16Column("ab → cd", 2)).toBe(2);
  });

  it("clamps a column past the end of the line", () => {
    expect(byteColumnToUtf16Column("abc", 9)).toBe(9);
  });
});
