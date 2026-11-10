import { createTwoFilesPatch } from "diff";
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LIMITS } from "../../shared/protocol";
import { BookkeepingOpSchema, type BookkeepingOp, type Proposal, type ProposalOp } from "../../shared/types";
import type { PrivacyGuard } from "../guard/privacy";
import { atomicWrite, resolveInside, sha256 } from "./files";
import { findTable, lastSubBulletIndex, locateBullet, plainBulletText, subBulletTexts } from "./tracker";

const TRACKER = "TRACKER.md";
const REVIEW = "REVIEW.md";
const SESSION_LOG = "# Session Log";
const GAPS = "# Gaps Found & Filled";
const STALE_REASON = "The file changed since the draft; draft again";
const PRIVACY_REASON = "The text contains a term from the privacy deny-list";
const TOO_MANY_REASON = "Too many changes in one draft";

type OpResult = { ok: true; next: string; added: string } | { ok: false; reason: string };

interface FileState {
  path: string;
  /** Null when the file does not exist. */
  original: string | null;
  current: string | null;
}

/** Applies ops to in-memory copies, checks each with the guard, and returns a draft with diffs and base hashes. */
export async function planProposal(studyRoot: string, sessionId: string, ops: BookkeepingOp[], guard: PrivacyGuard): Promise<Proposal> {
  const states = new Map<string, FileState>();
  const baseHashes: Record<string, string | null> = {};
  const planned: ProposalOp[] = [];

  for (const [index, rawOp] of ops.entries()) {
    const id = `op-${index + 1}`;
    const parsed = BookkeepingOpSchema.safeParse(rawOp);
    if (!parsed.success) {
      planned.push({ id, op: redactStrings(rawOp, guard), file: "(invalid)", summary: "Invalid operation", blocked: "The operation is not valid" });
      continue;
    }
    const op = parsed.data;
    const file = targetFile(op);
    const summary = guard.redact(describe(op));

    let result: OpResult;
    if (index >= LIMITS.proposalOps) {
      result = { ok: false, reason: TOO_MANY_REASON };
    } else if (isNotesOp(op) && guard.findViolations(op.path).length > 0) {
      // Skipped before loading so the name never becomes a key in the draft's base hashes.
      result = { ok: false, reason: PRIVACY_REASON };
    } else {
      try {
        const state = await loadState(studyRoot, file, states, baseHashes);
        result = runOp(op, state.current, guard);
        if (result.ok) state.current = result.next;
      } catch {
        result = { ok: false, reason: "The file cannot be read or is outside the study folder" };
      }
    }
    // A blocked draft still goes to the page and to disk, so it must not carry the term it was blocked for.
    const hidden = !result.ok && result.reason === PRIVACY_REASON;
    planned.push({
      id,
      op: hidden ? redactStrings(op, guard) : op,
      file: guard.redact(file),
      summary,
      blocked: result.ok ? null : result.reason,
    });
  }

  const diffs: Proposal["diffs"] = [];
  for (const [file, state] of states) {
    if (state.current === null || state.current === state.original) continue;
    diffs.push({ file, diff: makePatch(file, state.original, state.current) });
  }

  return {
    id: randomBytes(8).toString("hex"),
    sessionId,
    createdAt: new Date().toISOString(),
    ops: planned,
    diffs,
    baseHashes,
    status: "draft",
  };
}

/** Writes the chosen ops if no target file changed since the draft. Marks the proposal stale otherwise. */
export async function applyProposal(
  studyRoot: string,
  proposal: Proposal,
  opIds: string[],
  guard: PrivacyGuard,
): Promise<{ proposal: Proposal; applied: string[]; failed: { opId: string; reason: string }[] }> {
  const selected = [...new Set(opIds)];
  const failAll = (reason: string): { proposal: Proposal; applied: string[]; failed: { opId: string; reason: string }[] } => ({
    proposal,
    applied: [],
    failed: selected.map((opId) => ({ opId, reason })),
  });
  const stale = (): { proposal: Proposal; applied: string[]; failed: { opId: string; reason: string }[] } => ({
    ...failAll(STALE_REASON),
    proposal: { ...proposal, status: "stale" },
  });

  if (proposal.status === "applied") return failAll("This draft was already saved");
  if (proposal.status === "stale") return failAll(STALE_REASON);

  const failed: { opId: string; reason: string }[] = [];
  const known = new Map(proposal.ops.map((o) => [o.id, o]));
  const chosen = new Set<string>();
  for (const opId of selected) {
    const planned = known.get(opId);
    if (!planned) failed.push({ opId, reason: "Unknown operation" });
    else if (planned.blocked !== null) failed.push({ opId, reason: planned.blocked });
    else chosen.add(opId);
  }
  if (chosen.size === 0) return { proposal, applied: [], failed };

  for (const [file, hash] of Object.entries(proposal.baseHashes)) {
    if ((await currentHash(studyRoot, file)) !== hash) {
      return stale();
    }
  }

  // Replay the chosen ops in draft order on the files as they are now. A subset can fail where the whole set worked.
  const states = new Map<string, FileState>();
  const unusedHashes: Record<string, string | null> = {};
  const appliedByFile = new Map<string, string[]>();
  for (const planned of proposal.ops) {
    if (!chosen.has(planned.id)) continue;
    const parsed = BookkeepingOpSchema.safeParse(planned.op);
    if (!parsed.success) {
      failed.push({ opId: planned.id, reason: "The operation is not valid" });
      continue;
    }
    const op = parsed.data;
    const file = targetFile(op);
    try {
      const state = await loadState(studyRoot, file, states, unusedHashes);
      // The hash check above read the file earlier; the text used here must be the text the draft was made from.
      if ((state.original === null ? null : sha256(state.original)) !== proposal.baseHashes[file]) return stale();
      const result = runOp(op, state.current, guard);
      if (!result.ok) {
        failed.push({ opId: planned.id, reason: result.reason });
        continue;
      }
      state.current = result.next;
      const list = appliedByFile.get(file) ?? [];
      list.push(planned.id);
      appliedByFile.set(file, list);
    } catch {
      failed.push({ opId: planned.id, reason: "The file cannot be read or is outside the study folder" });
    }
  }

  const applied: string[] = [];
  for (const file of writeOrder([...states.keys()])) {
    const state = states.get(file)!;
    const ids = appliedByFile.get(file) ?? [];
    if (state.current === null || state.current === state.original || ids.length === 0) continue;
    try {
      // The file is re-read just before the rename so an edit made while this ran is never overwritten.
      if ((await readIfExists(state.path)) !== state.original) throw new Error("changed");
      if (file.startsWith("notes/")) await mkdir(dirname(state.path), { recursive: true });
      await atomicWrite(state.path, state.current);
      applied.push(...ids);
    } catch {
      for (const opId of ids) failed.push({ opId, reason: "The file could not be saved; draft again" });
    }
  }

  const status: Proposal["status"] = applied.length > 0 ? "applied" : proposal.status;
  return { proposal: { ...proposal, status }, applied, failed };
}

// ---------------------------------------------------------------------------
// Op semantics

function runOp(op: BookkeepingOp, current: string | null, guard: PrivacyGuard): OpResult {
  const result = applyOp(op, current);
  if (!result.ok) return result;
  if (isNotesOp(op) && guard.findViolations(op.path).length > 0) return { ok: false, reason: PRIVACY_REASON };
  if (guard.findViolations(result.added).length > 0) return { ok: false, reason: PRIVACY_REASON };
  // A term can also form across the join with the text already in the file.
  if (current !== null) {
    const already = new Set(guard.findViolations(current));
    if (guard.findViolations(result.next).some((term) => !already.has(term))) return { ok: false, reason: PRIVACY_REASON };
  }
  return result;
}

function isNotesOp(op: BookkeepingOp): op is Extract<BookkeepingOp, { kind: "notes_create" | "notes_append" }> {
  return op.kind === "notes_create" || op.kind === "notes_append";
}

function redactStrings<T>(value: T, guard: PrivacyGuard): T {
  if (typeof value === "string") return guard.redact(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactStrings(item, guard)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStrings(item, guard)])) as T;
  }
  return value;
}

function applyOp(op: BookkeepingOp, current: string | null): OpResult {
  switch (op.kind) {
    case "tracker_update_bullet":
      return requireFile(current, TRACKER, (text) => updateBullet(text, op));
    case "tracker_add_subbullet":
      return requireFile(current, TRACKER, (text) => addSubBullet(text, op));
    case "tracker_append_session_log_row":
      return requireFile(current, TRACKER, (text) =>
        appendRow(text, SESSION_LOG, "Session Log", [op.date, op.topics, op.outcome, op.notesFile.trim() === "" ? "—" : op.notesFile]),
      );
    case "tracker_append_gap_row":
      return requireFile(current, TRACKER, (text) => appendRow(text, GAPS, "Gaps Found & Filled", [op.date, op.gap, op.cameUpWhile, op.filled]));
    case "review_append_entry":
      return requireFile(current, REVIEW, (text) => {
        const entry = trimBlock(op.markdown);
        return entry === "" ? { ok: false, reason: "The entry is empty" } : { ok: true, next: appendReview(text, entry), added: entry };
      });
    case "notes_create": {
      if (current !== null) return { ok: false, reason: "The notes file already exists" };
      const content = trimBlock(op.content);
      return content === "" ? { ok: false, reason: "The notes file would be empty" } : { ok: true, next: `${content}\n`, added: content };
    }
    case "notes_append": {
      if (current === null) return { ok: false, reason: "The notes file does not exist" };
      const content = trimBlock(op.content);
      if (content === "") return { ok: false, reason: "There is nothing to append" };
      const gap = current === "" || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
      return { ok: true, next: `${current}${gap}${content}\n`, added: content };
    }
  }
}

function requireFile(current: string | null, name: string, run: (text: string) => OpResult): OpResult {
  return current === null ? { ok: false, reason: `${name} is missing` } : run(current);
}

function updateBullet(text: string, op: Extract<BookkeepingOp, { kind: "tracker_update_bullet" }>): OpResult {
  const lookup = locateBullet(text, op.section, op.bullet);
  if (lookup.status === "no_section") return { ok: false, reason: "The section was not found in TRACKER.md" };
  if (lookup.status === "not_found") return { ok: false, reason: "The bullet was not found in that section" };
  if (lookup.status === "ambiguous") return { ok: false, reason: "More than one bullet in that section matches" };

  const lines = text.split("\n");
  const original = lines[lookup.match.lineIndex] ?? "";
  let line = original;
  if (op.mark !== undefined) line = line.replace(/^- \[( |~|x)\]/, `- ${op.mark}`);

  const suffix = oneLine(op.appendSuffix ?? "");
  if (suffix !== "") {
    const base = line.trimEnd();
    const bare = suffix.replace(/^→\s*/, "");
    if (lookup.match.suffix !== null) line = `${base} · ${bare}`;
    // A bullet that already ends with an arrow takes the text straight after it.
    else if (base.endsWith("→")) line = `${base} ${bare}`;
    else line = `${base} → ${bare}`;
  }

  if (line === original) return { ok: false, reason: "Nothing would change" };
  lines[lookup.match.lineIndex] = line;
  return { ok: true, next: lines.join("\n"), added: suffix };
}

function addSubBullet(text: string, op: Extract<BookkeepingOp, { kind: "tracker_add_subbullet" }>): OpResult {
  const lookup = locateBullet(text, op.section, op.parentBullet);
  if (lookup.status === "no_section") return { ok: false, reason: "The section was not found in TRACKER.md" };
  if (lookup.status === "not_found") return { ok: false, reason: "The parent bullet was not found in that section" };
  if (lookup.status === "ambiguous") return { ok: false, reason: "More than one bullet in that section matches" };

  const lines = text.split("\n");
  const body = oneLine(op.text);
  if (body === "") return { ok: false, reason: "The sub-bullet is empty" };
  const wanted = plainBulletText(body).toLowerCase();
  if (subBulletTexts(lines, lookup.match.lineIndex).some((existing) => existing.toLowerCase() === wanted)) {
    return { ok: false, reason: "A sub-bullet with this text already exists" };
  }

  const line = `  - [ ] ${/\(added\)/i.test(body) ? body : `${body} (added)`}`;
  lines.splice(lastSubBulletIndex(lines, lookup.match.lineIndex) + 1, 0, line);
  return { ok: true, next: lines.join("\n"), added: body };
}

function appendRow(text: string, heading: string, tableName: string, cells: string[]): OpResult {
  const table = findTable(text, heading);
  if (table === null) return { ok: false, reason: `The ${tableName} table was not found in TRACKER.md` };
  const row = `| ${cells.map(cell).join(" | ")} |`;
  const lines = text.split("\n");
  lines.splice(table.lastRowIndex + 1, 0, row);
  return { ok: true, next: lines.join("\n"), added: row };
}

/** One table cell: a line break would end the row, and an unescaped pipe would start a new cell. */
function cell(value: string): string {
  return oneLine(value).replace(/(?<!\\)\|/g, "\\|");
}

function appendReview(current: string, entry: string): string {
  let base = current;
  if (base !== "" && !base.endsWith("\n")) base += "\n";
  if (base !== "" && !base.endsWith("\n\n")) base += "\n";
  const lastLine = base.trimEnd().split("\n").at(-1) ?? "";
  const separator = base === "" || lastLine.trim() === "---" ? "" : "---\n\n";
  return `${base}${separator}${entry}\n`;
}

// ---------------------------------------------------------------------------
// Files

async function loadState(studyRoot: string, file: string, states: Map<string, FileState>, hashes: Record<string, string | null>): Promise<FileState> {
  const existing = states.get(file);
  if (existing) return existing;
  const path = await resolveInside(studyRoot, file);
  const original = await readIfExists(path);
  const state: FileState = { path, original, current: original };
  states.set(file, state);
  hashes[file] = original === null ? null : sha256(original);
  return state;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function currentHash(studyRoot: string, file: string): Promise<string | null | undefined> {
  try {
    const text = await readIfExists(await resolveInside(studyRoot, file));
    return text === null ? null : sha256(text);
  } catch {
    // An unreadable or escaping path counts as changed.
    return undefined;
  }
}

/** Notes first, so the tracker never points at a notes file that failed to save. */
function writeOrder(files: string[]): string[] {
  const rank = (file: string): number => (file.startsWith("notes/") ? 0 : file === REVIEW ? 1 : 2);
  return [...files].sort((a, b) => rank(a) - rank(b));
}

function targetFile(op: BookkeepingOp): string {
  if (op.kind === "review_append_entry") return REVIEW;
  if (op.kind === "notes_create" || op.kind === "notes_append") return op.path;
  return TRACKER;
}

function makePatch(file: string, before: string | null, after: string): string {
  const patch = createTwoFilesPatch(before === null ? "/dev/null" : `a/${file}`, `b/${file}`, before ?? "", after, "", "", { context: 3 });
  return patch.replace(/^=+\n/, "");
}

// ---------------------------------------------------------------------------
// Text helpers

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trimBlock(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/^\n+/, "").trimEnd();
}

function describe(op: BookkeepingOp): string {
  const short = (text: string, max = 60): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
  switch (op.kind) {
    case "tracker_update_bullet": {
      const parts: string[] = [];
      if (op.mark !== undefined) parts.push(`mark ${op.mark}`);
      if (op.appendSuffix !== undefined) parts.push(`add "${short(oneLine(op.appendSuffix), 50)}"`);
      return `Update "${short(op.bullet)}"${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
    }
    // Several ops of one kind are common in a draft, so each summary names its own content.
    case "tracker_add_subbullet":
      return `Add a sub-bullet under "${short(op.parentBullet, 40)}": "${short(oneLine(op.text))}"`;
    case "tracker_append_session_log_row":
      return `Add a Session Log row for ${op.date}`;
    case "tracker_append_gap_row":
      return `Add a Gaps Found & Filled row: "${short(oneLine(op.gap))}"`;
    case "review_append_entry": {
      const heading = op.markdown.split("\n").find((line) => line.trim() !== "") ?? "";
      return `Add a REVIEW.md entry: "${short(oneLine(heading.replace(/^#+\s*/, "")))}"`;
    }
    case "notes_create":
      return `Create ${op.path}`;
    case "notes_append":
      return `Append to ${op.path}`;
  }
}
