import type { Mode, Track } from "../../shared/phases";
import type { TrackerMark, Verdict } from "../../shared/types";

export type Tone = "neutral" | "good" | "warn" | "bad" | "accent";

/** mm:ss with minutes that can pass 59, because a 120 minute round counts down from 120:00. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatMinutes(minutes: number): string {
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const DAY_ONLY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // "2026-10-18" parses as midnight UTC; formatting it in a local zone behind UTC would show the day before.
  return (CALENDAR_DAY.test(iso) ? DAY_ONLY : DATE).format(d);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_TIME.format(d);
}

export function daysSince(iso: string, now = Date.now()): number | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 86_400_000));
}

export const VERDICT_TONE: Record<Verdict, Tone> = {
  strong_hire: "good",
  hire: "good",
  lean_no_hire: "warn",
  no_hire: "bad",
};

export const SCORE_WORD: Record<number, string> = { 1: "Missing", 2: "Below bar", 3: "At bar", 4: "Stretch signal" };

export const SCORE_TONE: Record<number, Tone> = { 1: "bad", 2: "warn", 3: "accent", 4: "good" };

export const MARK_LABEL: Record<TrackerMark, string> = { "[ ]": "Not done", "[~]": "Partly done", "[x]": "Done" };

export const MARK_TONE: Record<TrackerMark, Tone> = { "[ ]": "neutral", "[~]": "warn", "[x]": "good" };

/** Text with each tracker mark written out, for a reason saved before the judge was asked to use words. */
export function marksInWords(text: string): string {
  return text.replace(/\[(~|x| )\]/g, (mark) => MARK_LABEL[mark as TrackerMark].toLowerCase());
}

export const TRACK_LABEL: Record<Track, string> = { hld: "HLD", lld: "LLD" };
export const TRACK_TITLE: Record<Track, string> = { hld: "High-level design", lld: "Low-level design in C++" };
export const MODE_LABEL: Record<Mode, string> = { interview: "Interview", guided: "Guided" };

export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
export const SEVERITY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;
export const SEVERITY_TONE: Record<keyof typeof SEVERITY_ORDER, Tone> = { high: "bad", medium: "warn", low: "neutral" };
