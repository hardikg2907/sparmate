import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StudyKitOptions {
  studyRoot: string;
  templateDir: string;
}

export async function isDirectoryEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    const visible = entries.filter((e) => e !== ".DS_Store");
    return visible.length === 0;
  } catch {
    return true;
  }
}

/** Populates an empty study folder with baseline tracker, review, teaching, profile and flags templates. */
export async function initStudyKit(options: StudyKitOptions): Promise<{ created: string[] }> {
  const { studyRoot, templateDir } = options;
  await mkdir(studyRoot, { recursive: true });
  const empty = await isDirectoryEmpty(studyRoot);
  if (!empty) {
    return { created: [] };
  }

  const files = ["TRACKER.md", "REVIEW.md", "TEACHING.md", "ABOUT_ME.md", "notes/_TEMPLATE.md", "lld/compile_flags.txt"];

  const created: string[] = [];
  for (const rel of files) {
    const src = join(templateDir, rel);
    const dest = join(studyRoot, rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
    created.push(rel);
  }

  return { created };
}
