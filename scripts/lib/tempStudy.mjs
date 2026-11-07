import { cp, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The starter study folder shipped with the app. Scripts copy it and never write to it. */
export const KIT_DIR = join(APP, "study-kit");

/** Fills a temp study folder with a copy of the starter kit, so a script never reads or edits a real study folder. */
export async function copyStudyKit(study) {
  await mkdir(study, { recursive: true });
  await cp(KIT_DIR, study, { recursive: true });
}
