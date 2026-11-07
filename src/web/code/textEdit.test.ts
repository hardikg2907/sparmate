import { describe, expect, it } from "vitest";
import { diffEdit, mapOffset, normaliseEol, type TextEdit } from "./textEdit";

function apply(oldText: string, edit: TextEdit): string {
  return oldText.slice(0, edit.start) + edit.text + oldText.slice(edit.endOld);
}

describe("diffEdit", () => {
  it("returns null for equal text", () => {
    expect(diffEdit("int main() {}", "int main() {}")).toBeNull();
  });

  it.each([
    ["insert in the middle", "int main() {}", "int main() { return 0; }"],
    ["delete in the middle", "int main() { return 0; }", "int main() {}"],
    ["append", "a\nb\n", "a\nb\nc\n"],
    ["prepend", "b\nc\n", "a\nb\nc\n"],
    ["replace everything", "abc", "xyz"],
    ["empty to text", "", "hello"],
    ["text to empty", "hello", ""],
    ["repeated characters", "aaaa", "aaaaaa"],
    ["emoji sharing a first half", "x\u{1F600}y", "x\u{1F601}y"],
  ])("builds an edit that reproduces the new text: %s", (_name, before, after) => {
    const edit = diffEdit(before, after);
    expect(edit).not.toBeNull();
    expect(apply(before, edit as TextEdit)).toBe(after);
  });

  it("never starts or ends inside a surrogate pair", () => {
    const before = "x\u{1F600}y";
    const edit = diffEdit(before, "x\u{1F601}y") as TextEdit;
    expect(edit.start).toBe(1);
    expect(edit.endOld).toBe(3);
  });

  it("keeps the changed region small", () => {
    const edit = diffEdit("line1\nline2\nline3\n", "line1\nLINE2\nline3\n") as TextEdit;
    expect(edit.text).toBe("LINE");
    expect(edit.endOld - edit.start).toBe(4);
  });
});

describe("mapOffset", () => {
  const before = "aaa-OLD-zzz";
  const edit = diffEdit(before, "aaa-NEWER-zzz") as TextEdit;

  it("leaves a cursor before the change alone", () => {
    expect(mapOffset(2, edit)).toBe(2);
    expect(mapOffset(edit.start, edit)).toBe(edit.start);
  });

  it("shifts a cursor after the change by the size difference", () => {
    const at = before.indexOf("zzz");
    expect(mapOffset(at, edit)).toBe("aaa-NEWER-zzz".indexOf("zzz"));
    expect(mapOffset(before.length, edit)).toBe("aaa-NEWER-zzz".length);
  });

  it("keeps a cursor inside the change at the same distance from its start, capped to the new text", () => {
    expect(mapOffset(edit.start + 1, edit)).toBe(edit.start + 1);
    const shrink = diffEdit("aaa-LONGER-zzz", "aaa-X-zzz") as TextEdit;
    expect(mapOffset(shrink.start + 5, shrink)).toBe(shrink.start + shrink.text.length);
  });
});

describe("normaliseEol", () => {
  it("turns CRLF and lone CR into LF", () => {
    expect(normaliseEol("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });
});
