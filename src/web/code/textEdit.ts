/** Replace `old.slice(start, endOld)` with `text`. Offsets are UTF-16 code units, as in JavaScript strings. */
export interface TextEdit {
  start: number;
  endOld: number;
  text: string;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Line breaks as the editor stores them: LF only. */
export function normaliseEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** The smallest single edit that turns `oldText` into `newText`, or null when they are equal. */
export function diffEdit(oldText: string, newText: string): TextEdit | null {
  if (oldText === newText) return null;
  const limit = Math.min(oldText.length, newText.length);
  let start = 0;
  while (start < limit && oldText.charCodeAt(start) === newText.charCodeAt(start)) start += 1;
  // Two different emoji can share a first half; an edit must not begin between the halves of one.
  if (start > 0 && isHighSurrogate(oldText.charCodeAt(start - 1))) start -= 1;

  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText.charCodeAt(endOld - 1) === newText.charCodeAt(endNew - 1)) {
    endOld -= 1;
    endNew -= 1;
  }
  if (endOld < oldText.length && isLowSurrogate(oldText.charCodeAt(endOld))) {
    endOld += 1;
    endNew += 1;
  }
  return { start, endOld, text: newText.slice(start, endNew) };
}

/**
 * Where a cursor at `offset` in the old text sits after `edit`. Before the change it stays; after it,
 * it shifts by the size change; inside it, it keeps its distance from the start of the change.
 */
export function mapOffset(offset: number, edit: TextEdit): number {
  if (offset <= edit.start) return offset;
  if (offset >= edit.endOld) return offset - (edit.endOld - edit.start) + edit.text.length;
  return edit.start + Math.min(offset - edit.start, edit.text.length);
}
