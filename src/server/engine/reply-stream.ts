const OPENING = /^\s*\{\s*"text"\s*:\s*"/;
const SIMPLE_ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/**
 * Reads the `text` value out of a reply tool's input while its JSON is still arriving, so the reply can be shown as
 * it is written. Escapes and surrogate pairs that are split across pieces wait for the rest. Input that does not
 * start with the `text` key yields nothing, and the caller then shows the complete input once it lands.
 */
export class ReplyTextStream {
  private raw = "";
  private pos = -1;
  private pendingHigh = "";
  /** Everything decoded so far. */
  text = "";
  /** True once the closing quote of the value has been read. */
  done = false;

  constructor(private readonly emit: (delta: string) => void) {}

  push(piece: string): void {
    if (this.done) return;
    this.raw += piece;
    if (this.pos < 0) {
      const open = OPENING.exec(this.raw);
      if (!open) return;
      this.pos = open[0].length;
    }
    let out = "";
    while (this.pos < this.raw.length) {
      const ch = this.raw[this.pos]!;
      if (ch === '"') {
        this.done = true;
        break;
      }
      if (ch !== "\\") {
        out += this.flushHigh() + ch;
        this.pos++;
        continue;
      }
      const kind = this.raw[this.pos + 1];
      if (kind === undefined) break;
      if (kind !== "u") {
        out += this.flushHigh() + (SIMPLE_ESCAPES[kind] ?? kind);
        this.pos += 2;
        continue;
      }
      const hex = this.raw.slice(this.pos + 2, this.pos + 6);
      if (hex.length < 4) break;
      const code = Number.parseInt(hex, 16);
      this.pos += 6;
      if (code >= 0xd800 && code <= 0xdbff) {
        out += this.flushHigh();
        this.pendingHigh = String.fromCharCode(code);
      } else if (code >= 0xdc00 && code <= 0xdfff && this.pendingHigh) {
        out += this.pendingHigh + String.fromCharCode(code);
        this.pendingHigh = "";
      } else {
        out += this.flushHigh() + String.fromCharCode(code);
      }
    }
    if (this.done) out += this.flushHigh();
    if (out) {
      this.text += out;
      this.emit(out);
    }
  }

  /** A high surrogate is held until its pair arrives; anything else that follows it lets it go alone. */
  private flushHigh(): string {
    const high = this.pendingHigh;
    this.pendingHigh = "";
    return high;
  }
}
