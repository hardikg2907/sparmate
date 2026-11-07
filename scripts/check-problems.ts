// Validates problem files: frontmatter, required sections, tracker bullet present in TRACKER.md, id matches file name.
// Usage: npx tsx scripts/check-problems.ts [file ...]   (no arguments: every file under content/problems)
// Bullets are checked against study-kit/TRACKER.md, or against the TRACKER.md in STUDY_ROOT when that is set.
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProblem } from "../src/server/engine/problems";
import { findBullet } from "../src/server/study/tracker";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trackerDir = process.env.STUDY_ROOT ? resolve(process.env.STUDY_ROOT) : join(appRoot, "study-kit");

async function listProblemFiles(): Promise<string[]> {
  const out: string[] = [];
  for (const track of ["hld", "lld"]) {
    const dir = join(appRoot, "content", "problems", track);
    for (const name of await readdir(dir)) if (name.endsWith(".md")) out.push(join(dir, name));
  }
  return out.sort();
}

const files = process.argv.length > 2 ? process.argv.slice(2).map((f) => resolve(f)) : await listProblemFiles();
const tracker = await readFile(join(trackerDir, "TRACKER.md"), "utf8");
let failures = 0;

for (const file of files) {
  const problems: string[] = [];
  try {
    const p = parseProblem(await readFile(file, "utf8"), file, false);
    if (basename(file, ".md") !== p.meta.id) problems.push(`file name does not match id "${p.meta.id}"`);
    if (!file.includes(`/problems/${p.meta.track}/`)) problems.push(`file is not under problems/${p.meta.track}/`);
    if (p.meta.tracker && !findBullet(tracker, p.meta.tracker.section, p.meta.tracker.bullet)) {
      problems.push(`tracker bullet "${p.meta.tracker.bullet}" not found under "${p.meta.tracker.section}"`);
    }
    if (p.meta.track === "lld" && !p.meta.lldFolder) problems.push("LLD problem has no lldFolder");
    const words = p.body.split(/\s+/).length;
    if (words < 900) problems.push(`body is thin (${words} words); the fixtures run 1,600 to 2,000`);
    for (const [heading, text] of Object.entries(p.sections)) {
      if (text.trim().length < 40) problems.push(`section "${heading}" is nearly empty`);
    }
  } catch (err) {
    problems.push((err as Error).message);
  }
  if (problems.length) {
    failures++;
    console.log(`FAIL ${basename(file)}\n  - ${problems.join("\n  - ")}`);
  } else {
    console.log(`ok   ${basename(file)}`);
  }
}
process.exit(failures ? 1 : 0);
