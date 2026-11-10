import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import type { Problem } from "../../shared/problem";
import type { Session } from "../../shared/types";
import { sectionText, tableTail } from "../study/tracker";
import { phasesFor } from "../../shared/phases";
import { stepChecklistText } from "./checker";
import { stepNotesText, stepSummariesText, transcriptLines } from "./envelope";
import { scorecardWithCurrentPlan } from "./store";

const STUDY_READABLE = /^(TRACKER\.md|REVIEW\.md|TEACHING\.md|notes\/[A-Za-z0-9_][A-Za-z0-9_-]*\.md)$/;

/** Reads a study file by a fixed relative path; null when it does not exist. Never follows a link out of the root. */
export async function readStudyFile(studyRoot: string, relative: string): Promise<string | null> {
  if (!STUDY_READABLE.test(relative)) throw new Error("Not a readable study file");
  let real: string;
  try {
    real = await realpath(join(studyRoot, relative));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const root = await realpath(studyRoot);
  if (!real.startsWith(root + sep)) throw new Error("Study file resolves outside the study folder");
  return readFile(real, "utf8");
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** REVIEW.md's header (up to the append marker) and its last entry. */
export function reviewHeaderAndLastEntry(review: string): { header: string; lastEntry: string } {
  const lines = review.split("\n");
  const marker = lines.findIndex((l) => l.trim() === "<!-- append below -->");
  let headerEnd = marker >= 0 ? marker + 1 : -1;
  let inFence = false;
  let lastHeading = -1;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) inFence = !inFence;
    else if (!inFence && line.startsWith("## ") && i >= Math.max(0, headerEnd)) {
      if (headerEnd < 0) headerEnd = i;
      lastHeading = i;
    }
  });
  if (headerEnd < 0) headerEnd = lines.length;
  return {
    header: lines.slice(0, headerEnd).join("\n").trim(),
    lastEntry: lastHeading >= 0 ? lines.slice(lastHeading).join("\n").trim() : "",
  };
}

function block(tag: string, content: string | null | undefined): string {
  return `<${tag}>\n${content && content.trim() ? content.trim() : "(none)"}\n</${tag}>`;
}

export interface ScribeInputArgs {
  studyRoot: string;
  problem: Problem;
  session: Session;
  date: string;
}

/** Everything the scribe needs, assembled deterministically from the study files and the session. */
export async function buildScribeInput({ studyRoot, problem, session, date }: ScribeInputArgs): Promise<{ text: string; notesFileExists: boolean }> {
  const tracker = (await readStudyFile(studyRoot, "TRACKER.md")) ?? "";
  const review = (await readStudyFile(studyRoot, "REVIEW.md")) ?? "";
  const template = await readStudyFile(studyRoot, "notes/_TEMPLATE.md");
  const notes = await readStudyFile(studyRoot, problem.meta.notesFile);
  const section = problem.meta.tracker ? sectionText(tracker, problem.meta.tracker.section) : null;
  const { header, lastEntry } = reviewHeaderAndLastEntry(review);
  const { quoteChecks: _q, lintIssues: _l, ...card } = scorecardWithCurrentPlan(session) ?? ({} as NonNullable<Session["scorecard"]>);

  const facts = [
    `date: ${date}`,
    `session: ${session.id}`,
    `problem: ${problem.meta.title} (${problem.meta.id})`,
    `track: ${session.track}`,
    `mode: ${session.mode}`,
    `notes file: ${problem.meta.notesFile} (${notes === null ? "does not exist yet" : "exists"})`,
    problem.meta.tracker ? `tracker section: ${problem.meta.tracker.section}\ntracker bullet: ${problem.meta.tracker.bullet}` : "tracker: this problem has no tracker bullet",
  ].join("\n");

  const text = [
    block("facts", facts),
    block("tracker_section", section),
    block("session_log_tail", tableTail(tracker, "# Session Log", 3)),
    block("gaps_table_tail", tableTail(tracker, "# Gaps Found & Filled", 3)),
    block("review_header", header),
    block("review_last_entry", lastEntry),
    block("notes_template", template),
    block("problem_brief", problem.body),
    block("existing_notes", notes),
    block("scorecard", session.scorecard ? JSON.stringify(card, null, 2) : null),
    block("step_notes", stepNotesText(phasesFor(session.track), session.stepNotes)),
    block("step_summaries", stepSummariesText(phasesFor(session.track), session.stepSummaries ?? {})),
    block("step_checklist", stepChecklistText(phasesFor(session.track), session.checklist ?? {}, session.stepChecks ?? {})),
    block("transcript", transcriptLines(session.transcript, "interview")),
    block("coach_transcript", transcriptLines(session.transcript, "coach")),
    "Draft the bookkeeping ops for this session.",
  ].join("\n\n");
  return { text, notesFileExists: notes !== null };
}
