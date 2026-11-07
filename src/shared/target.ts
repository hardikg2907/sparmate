/** The bar a round is judged against. Today's values apply when the profile states none. */
export interface Target {
  level: string;
  stretch: string;
  company: string;
}

export const DEFAULT_TARGET: Readonly<Target> = {
  level: "SDE-2",
  stretch: "senior",
  company: "Series A to C startup",
};

const MAX_VALUE = 60;

const TARGET_LINE = /^[ \t]*(?:[-*][ \t]+)?Target:[ \t]*(.+)$/im;
const OPTION = /^(stretch|company)[ \t]*:[ \t]*(.*)$/i;

/** Values reach prompts, so keep them to one short line of plain words. */
function cleanValue(raw: string): string | null {
  const value = raw.replace(/[`{}<>\\]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_VALUE).trim();
  return value === "" ? null : value;
}

/**
 * Reads one profile line of the form `Target: SDE-2; stretch: senior; company: Series A to C startup`.
 * Each part is optional, and a missing or malformed part keeps its default. Other wording in the
 * profile, such as `Target level:`, is not read, so free text can never change the bar by accident.
 */
export function parseTarget(profile: string): Target {
  const target: Target = { ...DEFAULT_TARGET };
  const line = TARGET_LINE.exec(profile)?.[1];
  if (line === undefined) return target;
  const [level = "", ...options] = line.split(";");
  target.level = cleanValue(level) ?? target.level;
  for (const part of options) {
    const match = OPTION.exec(part.trim());
    if (!match) continue;
    const value = cleanValue(match[2] ?? "");
    if (value === null) continue;
    if (match[1]?.toLowerCase() === "stretch") target.stretch = value;
    else target.company = value;
  }
  return target;
}
