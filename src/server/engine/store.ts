import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Mode, Track } from "../../shared/phases";
import type { Proposal, Session, SessionStatus, Verdict } from "../../shared/types";
import { resolveInside } from "../study/files";
import { writeFileAtomic } from "./fsutil";
import type { Logger } from "./log";

export const SESSION_ID = /^\d{8}-\d{4}-[a-z0-9][a-z0-9-]{1,80}-[a-z0-9]{4}$/;
export const PROPOSAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface SessionSummary {
  id: string;
  problemId: string;
  title: string;
  track: Track;
  mode: Mode;
  createdAt: string;
  status: SessionStatus;
  verdict: Verdict | null;
  /** Set while the round is paused: why, and how much of the round is left (null in a guided round, which has no limit). */
  pause: { reason: NonNullable<Session["pauseReason"]>; timeLeftMs: number | null } | null;
  /** The study-notes draft was saved to the study files. */
  notesSaved: boolean;
}

export interface BoardFile {
  version: number;
  elements: Record<string, unknown>[];
}

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newSessionId(problemId: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  const suffix = [...randomBytes(4)].map((b) => BASE36[b % 36]).join("");
  return `${stamp}-${problemId}-${suffix}`;
}

function pauseSummary(s: Session): SessionSummary["pause"] {
  if (s.status !== "paused" || !s.pauseStartedAt || !s.pauseReason) return null;
  const roundMs = Math.max(0, Date.parse(s.pauseStartedAt) - Date.parse(s.startedAt) - s.pausedMs);
  return { reason: s.pauseReason, timeLeftMs: s.mode === "guided" ? null : Math.max(0, s.durationMs - roundMs) };
}

export function summarize(s: Session): SessionSummary {
  return {
    id: s.id,
    problemId: s.problemId,
    title: s.title,
    track: s.track,
    mode: s.mode,
    createdAt: s.createdAt,
    status: s.status,
    verdict: s.scorecard?.verdict.sde2 ?? null,
    pause: pauseSummary(s),
    notesSaved: (s.studyNotes?.appliedCount ?? 0) > 0,
  };
}

const PAUSE_REASONS: readonly NonNullable<Session["pauseReason"]>[] = ["error", "user", "away", "restart"];

/** Sessions saved before a field existed load with its empty value. A paused one with no reason was caught by a restart. */
function withDefaults(s: Session): Session {
  const saved = s.pauseReason;
  s.pauseReason = s.status !== "paused" ? null : PAUSE_REASONS.find((r) => r === saved) ?? "restart";
  s.stepNotes ??= {};
  s.stepNotesVersion ??= 0;
  s.stepSummaries ??= {};
  // A summary still running when the server stopped will never finish.
  for (const v of Object.values(s.stepSummaries)) if (v.status === "pending") v.status = "failed";
  s.checklist ??= {};
  s.stepChecks ??= {};
  s.pins ??= [];
  // A check still running when the server stopped will never finish; what it found before stays.
  for (const v of Object.values(s.stepChecks)) if (v.status === "checking") v.status = v.checkedAt === null ? "failed" : "done";
  s.focus ??= null;
  s.gapProgress ??= {};
  s.studyNotes ??= null;
  if (s.scorecard && !s.scorecard.steps) s.scorecard.steps = [];
  return s;
}

export class SessionStore {
  private readonly index = new Map<string, SessionSummary>();
  private readonly writes = new Map<string, Promise<void>>();
  /** Ids whose folder was deleted. A late save from a runtime that is shutting down must not bring one back. */
  private readonly removed = new Set<string>();

  constructor(
    private readonly sessionsDir: string,
    private readonly log: Logger,
  ) {}

  /** Every path below is built from an id that passed SESSION_ID, so it cannot leave the sessions folder. */
  dir(id: string): string {
    if (!SESSION_ID.test(id)) throw new Error("Invalid session id");
    return join(this.sessionsDir, id);
  }

  async loadIndex(): Promise<Session[]> {
    const loaded: Session[] = [];
    let names: string[] = [];
    try {
      names = await readdir(this.sessionsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    for (const name of names) {
      if (!SESSION_ID.test(name)) continue;
      const s = await this.load(name);
      if (s) loaded.push(s);
    }
    return loaded;
  }

  async load(id: string): Promise<Session | null> {
    if (this.removed.has(id)) return null;
    try {
      const s = withDefaults(JSON.parse(await readFile(join(this.dir(id), "session.json"), "utf8")) as Session);
      if (s.id !== id) throw new Error("Session file id does not match its folder");
      this.index.set(id, summarize(s));
      return s;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") this.log.warn(`Could not read session ${id}`, err);
      return null;
    }
  }

  async savedAt(id: string): Promise<Date | null> {
    try {
      return (await stat(join(this.dir(id), "session.json"))).mtime;
    } catch {
      return null;
    }
  }

  async create(session: Session): Promise<void> {
    await mkdir(join(this.dir(session.id), "proposals"), { recursive: true, mode: 0o700 });
    await this.save(session);
  }

  exists(id: string): boolean {
    return this.index.has(id);
  }

  /** Writes are chained per session, and each one snapshots the session when it is called, so the last call wins. */
  save(session: Session): Promise<void> {
    if (this.removed.has(session.id)) return Promise.resolve();
    const snapshot = JSON.stringify(session);
    this.index.set(session.id, summarize(session));
    const path = join(this.dir(session.id), "session.json");
    const prev = this.writes.get(session.id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => writeFileAtomic(path, snapshot));
    this.writes.set(session.id, next);
    return next;
  }

  /** Newest first. */
  history(): SessionSummary[] {
    return [...this.index.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async readBoard(id: string): Promise<BoardFile> {
    try {
      const parsed = JSON.parse(await readFile(join(this.dir(id), "board.json"), "utf8")) as BoardFile;
      return { version: parsed.version, elements: Array.isArray(parsed.elements) ? parsed.elements : [] };
    } catch {
      return { version: 0, elements: [] };
    }
  }

  writeBoard(id: string, board: BoardFile): Promise<void> {
    if (this.removed.has(id)) return Promise.resolve();
    return writeFileAtomic(join(this.dir(id), "board.json"), JSON.stringify(board));
  }

  writeFinalPng(id: string, png: Buffer): Promise<void> {
    return writeFileAtomic(join(this.dir(id), "board-final.png"), png);
  }

  async readFinalPng(id: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.dir(id), "board-final.png"));
    } catch {
      return null;
    }
  }

  writeFinalCode(id: string, content: string): Promise<void> {
    return writeFileAtomic(join(this.dir(id), "final.cpp"), content);
  }

  finalCodePath(id: string): string {
    return join(this.dir(id), "final.cpp");
  }

  async readFinalCode(id: string): Promise<string | null> {
    try {
      return await readFile(join(this.dir(id), "final.cpp"), "utf8");
    } catch {
      return null;
    }
  }

  async saveProposal(id: string, proposal: Proposal): Promise<void> {
    if (!PROPOSAL_ID.test(proposal.id)) throw new Error("Invalid proposal id");
    if (this.removed.has(id)) return;
    await mkdir(join(this.dir(id), "proposals"), { recursive: true, mode: 0o700 });
    await writeFileAtomic(join(this.dir(id), "proposals", `${proposal.id}.json`), JSON.stringify(proposal, null, 2));
  }

  async loadProposal(id: string, proposalId: string): Promise<Proposal | null> {
    if (!PROPOSAL_ID.test(proposalId)) return null;
    try {
      return JSON.parse(await readFile(join(this.dir(id), "proposals", `${proposalId}.json`), "utf8")) as Proposal;
    } catch {
      return null;
    }
  }

  isRemoved(id: string): boolean {
    return this.removed.has(id);
  }

  /** Deletes the session's folder. Resolves to false when there was nothing to delete. */
  async remove(id: string): Promise<boolean> {
    this.dir(id);
    this.removed.add(id);
    this.index.delete(id);
    // A save still in flight would otherwise write into the folder while it is being deleted.
    await (this.writes.get(id) ?? Promise.resolve()).catch(() => undefined);
    this.writes.delete(id);
    try {
      const root = await realpath(this.sessionsDir);
      const target = await resolveInside(this.sessionsDir, id);
      // Only a direct child named like the id may go; a symlinked folder would resolve somewhere else.
      if (dirname(target) !== root || basename(target) !== id) throw new Error("Session folder is outside the sessions folder");
      const existed = await stat(target).then(
        () => true,
        () => false,
      );
      await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      return existed;
    } catch (err) {
      this.removed.delete(id);
      await this.load(id);
      throw err;
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.writes.values()]);
  }
}
