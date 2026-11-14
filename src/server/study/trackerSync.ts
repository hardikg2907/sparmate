import { readFile } from "node:fs/promises";
import type { Problem } from "../../shared/problem";
import type { Logger } from "../engine/log";
import { atomicWrite, resolveInside } from "./files";
import { lastSubBulletIndex, locateBullet, readMarks } from "./tracker";

/**
 * A tracker made from an older template lacks the bullets of problems added since, so the debrief cannot mark them.
 * This adds each missing built-in bullet under its section, and leaves the file untouched when nothing is missing.
 * A missing section or an ambiguous bullet is skipped: guessing where it belongs could damage the user's file.
 */
export async function syncTrackerBullets(studyRoot: string, problems: readonly Problem[], log: Logger): Promise<{ added: number }> {
  let path: string;
  let original: string;
  try {
    path = await resolveInside(studyRoot, "TRACKER.md");
    original = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { added: 0 };
    throw err;
  }

  let text = original;
  let added = 0;
  for (const { meta, custom } of problems) {
    if (custom || !meta.tracker) continue;
    const { section, bullet } = meta.tracker;
    const lookup = locateBullet(text, section, bullet);
    if (lookup.status === "ambiguous") {
      log.info(`Tracker sync skipped ${meta.id}: the bullet appears more than once`);
      continue;
    }
    if (lookup.status === "no_section") {
      log.info(`Tracker sync skipped ${meta.id}: its section is not in the tracker`);
      continue;
    }
    if (lookup.status === "ok") continue;

    const last = readMarks(text, section).at(-1);
    if (!last) {
      log.info(`Tracker sync skipped ${meta.id}: its section has no bullets to follow`);
      continue;
    }
    const lines = text.split("\n");
    lines.splice(lastSubBulletIndex(lines, last.lineIndex) + 1, 0, `- [ ] ${bullet.trim()}`);
    text = lines.join("\n");
    added++;
  }

  if (added === 0) return { added: 0 };
  await atomicWrite(path, text);
  log.info(`Tracker sync added ${added} missing ${added === 1 ? "bullet" : "bullets"}`);
  return { added };
}
