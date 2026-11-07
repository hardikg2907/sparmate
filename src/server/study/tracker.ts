import type { TrackerMark } from "../../shared/types";

export interface BulletMatch {
  lineIndex: number;
  mark: TrackerMark;
  text: string;
  suffix: string | null;
}

export type BulletLookup = { status: "ok"; match: BulletMatch } | { status: "no_section" } | { status: "not_found" } | { status: "ambiguous" };

export interface TableLocation {
  headerIndex: number;
  /** Index of the last data row, or of the separator row when the table has no rows yet. */
  lastRowIndex: number;
}

interface SectionRange {
  /** Index of the heading line. */
  start: number;
  /** Index of the first line after the section. */
  end: number;
}

const HEADING = /^(#{1,6})\s+\S/;
const BULLET = /^- \[( |~|x)\] (.*)$/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^---\s*$/;
const TABLE_ROW = /^\s*\|/;

/** Finds the one bullet `bullet` in the section whose heading starts with `section`. Null when absent or ambiguous. */
export function findBullet(tracker: string, section: string, bullet: string): BulletMatch | null {
  const lookup = locateBullet(tracker, section, bullet);
  return lookup.status === "ok" ? lookup.match : null;
}

/** Like findBullet, but says why nothing was returned. */
export function locateBullet(tracker: string, section: string, bullet: string): BulletLookup {
  const lines = tracker.split("\n");
  const range = findSection(lines, section);
  if (range === null) return { status: "no_section" };
  const wanted = bullet.trim();
  const matches = topLevelBullets(lines, range).filter((b) => b.text === wanted);
  if (matches.length === 0) return { status: "not_found" };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "ok", match: matches[0]! };
}

/** Every top-level bullet of a section, in order. */
export function readMarks(tracker: string, section: string): BulletMatch[] {
  const lines = tracker.split("\n");
  const range = findSection(lines, section);
  return range === null ? [] : topLevelBullets(lines, range);
}

/** The raw text of a section (heading included), or null. */
export function sectionText(tracker: string, section: string): string | null {
  const lines = tracker.split("\n");
  const range = findSection(lines, section);
  if (range === null) return null;
  let end = range.end;
  while (end > range.start + 1 && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(range.start, end).join("\n");
}

/** The table header plus the last `n` rows of the table under a top-level heading such as "# Session Log". */
export function tableTail(tracker: string, heading: string, n: number): string | null {
  const lines = tracker.split("\n");
  const table = findTable(tracker, heading);
  if (table === null) return null;
  const first = Math.max(table.headerIndex + 2, table.lastRowIndex + 1 - Math.max(0, n));
  return [...lines.slice(table.headerIndex, table.headerIndex + 2), ...lines.slice(first, table.lastRowIndex + 1)].join("\n");
}

/** Locates the first Markdown table inside the section that starts with `heading`. */
export function findTable(tracker: string, heading: string): TableLocation | null {
  const lines = tracker.split("\n");
  const range = findSection(lines, heading);
  if (range === null) return null;
  const fenced = fenceMask(lines);
  for (let i = range.start + 1; i < range.end; i++) {
    if (fenced[i] || !TABLE_ROW.test(lines[i] ?? "")) continue;
    const separator = lines[i + 1] ?? "";
    if (i + 1 >= range.end || !/^\s*\|?\s*:?-{2,}/.test(separator)) return null;
    let last = i + 1;
    while (last + 1 < range.end && TABLE_ROW.test(lines[last + 1] ?? "")) last++;
    return { headerIndex: i, lastRowIndex: last };
  }
  return null;
}

/** Index of the last sub-bullet line that belongs to the bullet at `parentIndex`, or `parentIndex` when it has none. */
export function lastSubBulletIndex(lines: readonly string[], parentIndex: number): number {
  let last = parentIndex;
  for (let i = parentIndex + 1; i < lines.length; i++) {
    if (!/^ {2,}\S/.test(lines[i] ?? "")) break;
    last = i;
  }
  return last;
}

/** Text of the sub-bullets under the bullet at `parentIndex`, without mark, suffix or the "(added)" tag. */
export function subBulletTexts(lines: readonly string[], parentIndex: number): string[] {
  const texts: string[] = [];
  for (let i = parentIndex + 1; i <= lastSubBulletIndex(lines, parentIndex); i++) {
    const match = /^ {2,}- \[( |~|x)\] (.*)$/.exec(lines[i] ?? "");
    if (match) texts.push(plainBulletText(match[2] ?? ""));
  }
  return texts;
}

export function plainBulletText(rest: string): string {
  const withoutSuffix = rest.split(/ → | · /)[0] ?? rest;
  return withoutSuffix.replace(/\s*\(added\)\s*$/i, "").trim();
}

function topLevelBullets(lines: readonly string[], range: SectionRange): BulletMatch[] {
  const fenced = fenceMask(lines);
  const bullets: BulletMatch[] = [];
  for (let i = range.start + 1; i < range.end; i++) {
    if (fenced[i]) continue;
    const match = BULLET.exec(lines[i] ?? "");
    if (!match) continue;
    const rest = match[2] ?? "";
    const arrow = rest.indexOf(" → ");
    const trailingArrow = arrow === -1 && rest.endsWith(" →");
    const text = (arrow !== -1 ? rest.slice(0, arrow) : trailingArrow ? rest.slice(0, -2) : rest).trim();
    const suffix = arrow !== -1 ? rest.slice(arrow + 3).trim() : "";
    bullets.push({ lineIndex: i, mark: `[${match[1]}]` as TrackerMark, text, suffix: suffix === "" ? null : suffix });
  }
  return bullets;
}

/**
 * A section runs from the heading to the next heading of the same or a higher level, or to a `---` line.
 * The heading matches when it starts with `section` (real headings carry emoji and status notes after the title).
 */
function findSection(lines: readonly string[], section: string): SectionRange | null {
  const wanted = section.trim();
  if (wanted === "" || !wanted.startsWith("#")) return null;
  const fenced = fenceMask(lines);

  const candidates: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!fenced[i] && HEADING.test(line) && line.startsWith(wanted)) candidates.push(i);
  }
  // Two headings can share a prefix; an exact heading is the unambiguous answer.
  const exact = candidates.filter((i) => (lines[i] ?? "").trim() === wanted);
  const start = exact.length === 1 ? exact[0]! : candidates.length === 1 ? candidates[0]! : null;
  if (start === null) return null;

  const level = (HEADING.exec(lines[start] ?? "")?.[1] ?? "#").length;
  let end = start + 1;
  for (; end < lines.length; end++) {
    if (fenced[end]) continue;
    const line = lines[end] ?? "";
    if (RULE.test(line)) break;
    const heading = HEADING.exec(line);
    if (heading && (heading[1] ?? "").length <= level) break;
  }
  return { start, end };
}

/** True for every line inside a fenced code block, including the fence lines themselves. */
function fenceMask(lines: readonly string[]): boolean[] {
  const mask: boolean[] = new Array<boolean>(lines.length).fill(false);
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const marker = FENCE.exec(lines[i] ?? "")?.[1] ?? null;
    if (fence === null) {
      if (marker !== null) {
        fence = marker;
        mask[i] = true;
      }
    } else {
      mask[i] = true;
      if (marker === fence) fence = null;
    }
  }
  return mask;
}
