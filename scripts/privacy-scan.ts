// Scans the app's shipped text (content, docs, source, scripts) for deny-listed terms with the app's own guard.
// Prints file names and hit counts only, never the terms. Usage: npx tsx scripts/privacy-scan.ts
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrivacyGuard } from "../src/server/guard/privacy";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "dist", "data", ".git"]);
const TEXT = /\.(md|ts|tsx|mjs|js|json|css|html|txt|yaml|yml|cpp|stderr)$/;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (TEXT.test(entry.name)) yield path;
  }
}

const guard = await loadPrivacyGuard();
let files = 0;
let hits = 0;
for await (const file of walk(appRoot)) {
  files++;
  const found = guard.findViolations(await readFile(file, "utf8"));
  if (found.length) {
    hits++;
    console.log(`HIT ${relative(appRoot, file)} (${found.length} term${found.length > 1 ? "s" : ""})`);
  }
}
console.log(`${guard.size()} terms checked across ${files} files: ${hits ? `${hits} files with hits` : "clean"}`);
process.exit(hits ? 1 : 0);
