import { describe, expect, it } from "vitest";
import { ReplyTextStream } from "./reply-stream";

function feed(pieces: string[]): { stream: ReplyTextStream; emitted: string[] } {
  const emitted: string[] = [];
  const stream = new ReplyTextStream((d) => emitted.push(d));
  for (const piece of pieces) stream.push(piece);
  return { stream, emitted };
}

/** Splits a string into pieces of every size from 1 to 7, the way the API cuts tool input. */
function everySplit(json: string): string[][] {
  const out: string[][] = [];
  for (let size = 1; size <= 7; size++) {
    const pieces: string[] = [];
    for (let i = 0; i < json.length; i += size) pieces.push(json.slice(i, i + size));
    out.push(pieces);
  }
  return out;
}

describe("ReplyTextStream", () => {
  it("streams the text value as it arrives", () => {
    const { stream, emitted } = feed(['{"te', 'xt": "Hel', "lo, ", 'there."}']);
    expect(emitted).toEqual(["Hel", "lo, ", "there."]);
    expect(stream.text).toBe("Hello, there.");
    expect(stream.done).toBe(true);
  });

  it("decodes every escape the same way JSON.parse does, wherever the pieces are cut", () => {
    const value = 'Line one\nLine "two"\ttab \\ slash / é 😀 end\r\b\f';
    const json = JSON.stringify({ text: value });
    const escaped = json.replace("é", "\\u00e9").replace("😀", "\\ud83d\\ude00");
    for (const source of [json, escaped]) {
      for (const pieces of everySplit(source)) {
        const { stream, emitted } = feed(pieces);
        expect(stream.text).toBe(value);
        expect(emitted.join("")).toBe(value);
        expect(stream.done).toBe(true);
      }
    }
  });

  it("never emits half of a surrogate pair", () => {
    const { emitted } = feed(['{"text":"a\\ud83d', "\\ude00", 'b"}']);
    expect(emitted).toEqual(["a", "😀", "b"]);
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(emitted.some((piece) => loneSurrogate.test(piece))).toBe(false);
  });

  it("allows whitespace around the key and the colon", () => {
    expect(feed(['{ \n "text" :  "ok"}']).stream.text).toBe("ok");
  });

  it("yields nothing when another key comes first, so the complete input is used instead", () => {
    const { stream, emitted } = feed(['{"note":"x","text":"hidden"}']);
    expect(emitted).toEqual([]);
    expect(stream.text).toBe("");
  });

  it("ignores anything after the closing quote", () => {
    const { stream } = feed(['{"text":"done"', ',"extra":"no"}']);
    expect(stream.text).toBe("done");
  });
});
