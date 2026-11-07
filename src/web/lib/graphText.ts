/**
 * The board's text form ends with a "Warnings:" line (or a "Warnings:" header with bullets).
 * The panel shows warnings apart from the body so a loose arrow or unlabeled box stands out.
 */
export function splitGraphText(text: string): { body: string; warnings: string[] } {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("Warnings:"));
  if (at === -1) return { body: text, warnings: [] };
  const warnings: string[] = [];
  const first = (lines[at] ?? "").slice("Warnings:".length).trim();
  if (first) warnings.push(...first.split(/;\s+/).filter(Boolean));
  for (const line of lines.slice(at + 1)) {
    const item = line.replace(/^\s*-\s*/, "").trim();
    if (item) warnings.push(item);
  }
  return { body: lines.slice(0, at).join("\n").trimEnd(), warnings };
}
