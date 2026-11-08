import type { BootstrapResponse } from "../../shared/protocol";
import type { ProblemSummary, Settings } from "../../shared/types";
import type { SessionHistoryItem } from "../backend";
import type { Theme } from "../theme";

const DAY = 86_400_000;

function iso(daysAgo: number, hour = 10): string {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

/** A calendar day, "2026-11-10", as the server writes a last-attempt date. */
function day(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * DAY);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const fixtureBootstrap: BootstrapResponse = {
  csrfToken: "fixture-token-not-used-anywhere",
  version: "0.1.0",
  studyRoot: "/Users/you/study",
  fakeAgent: true,
  setup: [],
};

export function fixtureSettings(theme: Theme): Settings {
  return {
    models: { interviewer: "claude-opus-5-5", judge: "claude-opus-5-5", coach: "claude-opus-5-5", scribe: "claude-opus-5-5" },
    effort: { interviewer: "low", judge: "high", coach: "medium", scribe: "medium" },
    durations: { hld: 45, lld: 120 },
    theme,
    weeklyPlan: ["dsa", "hld", "dsa", "hld", "dsa", "lld", "redo"],
    dsaWeeklyGoal: 3,
  };
}

export const fixtureProblems: ProblemSummary[] = [
  {
    id: "c2-url-shortener",
    track: "hld",
    title: "URL Shortener",
    summary: "Design a url shortener. Where would you like to start?",
    difficulty: "easy",
    tags: ["read-heavy", "caching"],
    trackerMark: "[~]",
    lastAttempt: { sessionId: "20261017-0915-c2-url-shortener-k3x9", date: day(12), mode: "guided", verdict: "lean_no_hire", readiness: "not_yet" },
    badge: "redo",
    custom: false,
  },
  {
    id: "c2-rate-limiter",
    track: "hld",
    title: "Rate Limiter",
    summary: "Design a rate limiter. Where would you like to start?",
    difficulty: "medium",
    tags: ["algorithms", "redis"],
    trackerMark: "[ ]",
    lastAttempt: null,
    badge: "next",
    custom: false,
  },
  {
    id: "c2-news-feed",
    track: "hld",
    title: "News Feed",
    summary: "Design a news feed. Where would you like to start?",
    difficulty: "medium",
    tags: ["fan-out", "caching"],
    trackerMark: "[ ]",
    lastAttempt: null,
    badge: null,
    custom: false,
  },
  {
    id: "c2-chat-system",
    track: "hld",
    title: "Chat System",
    summary: "Design a chat system. Where would you like to start?",
    difficulty: "hard",
    tags: ["websockets", "ordering"],
    trackerMark: "[ ]",
    lastAttempt: null,
    badge: null,
    custom: false,
  },
  {
    id: "c2-notification-service",
    track: "hld",
    title: "Notification Service",
    summary: "Design a notification service. Where would you like to start?",
    difficulty: "medium",
    tags: ["queues", "retries"],
    trackerMark: "[x]",
    lastAttempt: { sessionId: "20261008-1930-c2-notification-service-q2m7", date: day(21), mode: "interview", verdict: "hire" },
    badge: null,
    custom: false,
  },
  {
    id: "c2-web-crawler",
    track: "hld",
    title: "Web Crawler",
    summary: "Design a web crawler. Where would you like to start?",
    difficulty: "hard",
    tags: ["queues", "politeness"],
    trackerMark: "[ ]",
    lastAttempt: null,
    badge: null,
    custom: false,
  },
  {
    id: "b3-parking-lot",
    track: "lld",
    title: "Parking Lot",
    summary: "Design a parking lot. Where would you like to start?",
    difficulty: "medium",
    tags: ["strategy", "concurrency"],
    trackerMark: "[~]",
    lastAttempt: { sessionId: "20261028-1100-b3-parking-lot-a8f2", date: day(1), mode: "interview", verdict: "lean_no_hire" },
    badge: null,
    custom: false,
  },
  {
    id: "b3-elevator",
    track: "lld",
    title: "Elevator Controller",
    summary: "Design a elevator controller. Where would you like to start?",
    difficulty: "medium",
    tags: ["state", "scheduling"],
    trackerMark: "[ ]",
    lastAttempt: null,
    badge: null,
    custom: false,
  },
  {
    id: "b3-vending-machine",
    track: "lld",
    title: "Vending Machine",
    summary: "Design a vending machine. Where would you like to start?",
    difficulty: "easy",
    tags: ["state", "inventory"],
    trackerMark: "[x]",
    lastAttempt: { sessionId: "20261003-1400-b3-vending-machine-z9c1", date: day(26), mode: "guided", verdict: "strong_hire" },
    badge: null,
    custom: false,
  },
  {
    id: "b3-library",
    track: "lld",
    title: "Library Management",
    summary: "Design a library management. Where would you like to start?",
    difficulty: "easy",
    tags: ["entities", "rules"],
    trackerMark: "[ ]",
    lastAttempt: null,
    badge: null,
    custom: false,
  },
  {
    id: "b3-expense-split",
    track: "lld",
    title: "Expense Splitter",
    summary: "Design a expense splitter. Where would you like to start?",
    difficulty: "medium",
    tags: ["strategy", "money"],
    trackerMark: "[ ]",
    lastAttempt: null,
    badge: null,
    custom: false,
  },
  {
    id: "custom-seat-booking-4kq1",
    track: "lld",
    title: "Seat Booking System",
    summary: "Design a seat booking system. Where would you like to start?",
    difficulty: "medium",
    tags: ["concurrency"],
    trackerMark: null,
    lastAttempt: null,
    badge: null,
    custom: true,
  },
];

const TIMING = [
  { phase: "requirements", label: "Requirements", plannedMinutes: 5, actualMinutes: 7.2 },
  { phase: "entities", label: "Core entities", plannedMinutes: 2, actualMinutes: 1.8 },
  { phase: "api", label: "API", plannedMinutes: 5, actualMinutes: 5.4 },
  { phase: "design", label: "High-level design", plannedMinutes: 13, actualMinutes: 30.6 },
  { phase: "deep_dives", label: "Deep dives", plannedMinutes: 20, actualMinutes: 0 },
];

const SCORES = (driving: number, depth: number) => [
  { id: "problem_navigation", name: "Problem navigation", score: 2 },
  { id: "solution_design", name: "Solution design", score: 2 },
  { id: "technical_depth", name: "Technical depth", score: depth },
  { id: "scale_reliability", name: "Scale and reliability", score: 2 },
  { id: "communication", name: "Communication", score: 3 },
  { id: "driving_time", name: "Driving and time", score: driving },
];

function clock(startedAt: string, usedMin: number, durationMin: number, paused: boolean) {
  const started = new Date(startedAt).getTime();
  return {
    startedAt,
    pausedMs: 0,
    pauseStartedAt: paused ? new Date(started + usedMin * 60_000).toISOString() : null,
    durationMs: durationMin * 60_000,
  };
}

const pausedAfter = (startedAt: string, usedMin: number) => new Date(new Date(startedAt).getTime() + usedMin * 60_000).toISOString();

export const fixtureHistory: SessionHistoryItem[] = [
  {
    id: "20261028-1100-b3-parking-lot-a8f2",
    problemId: "b3-parking-lot",
    title: "Parking Lot",
    track: "lld",
    mode: "interview",
    createdAt: iso(1, 11),
    status: "debriefed",
    verdict: "lean_no_hire",
    pause: null,
    notesSaved: false,
    scores: SCORES(2, 3),
    gaps: [{ title: "Name the state transitions before coding", goodLooksLike: "A transition table is written before any method body.", severity: "medium", done: false }],
  },
  {
    id: "20261024-1900-c2-news-feed-t7d4",
    problemId: "c2-news-feed",
    title: "News Feed",
    track: "hld",
    mode: "guided",
    createdAt: iso(5, 19),
    status: "failed",
    verdict: null,
    pause: null,
    notesSaved: false,
  },
  {
    id: "20261017-0915-c2-url-shortener-k3x9",
    problemId: "c2-url-shortener",
    title: "URL Shortener",
    track: "hld",
    mode: "guided",
    createdAt: iso(12, 9),
    status: "debriefed",
    verdict: "lean_no_hire",
    readiness: "not_yet",
    pause: null,
    notesSaved: false,
    scores: SCORES(1, 2),
    phaseTiming: TIMING,
    gaps: [
      { title: "Numbers that decide nothing", goodLooksLike: "Each number in a deep dive ends in a line that says which means.", severity: "high", done: false },
      { title: "Driving the clock", goodLooksLike: "Moves on at the planned time for each step.", severity: "high", done: false },
    ],
  },
  {
    id: "20261008-1930-c2-notification-service-q2m7",
    problemId: "c2-notification-service",
    title: "Notification Service",
    track: "hld",
    mode: "interview",
    createdAt: iso(21, 19),
    status: "debriefed",
    verdict: "hire",
    pause: null,
    notesSaved: true,
    scores: SCORES(3, 3),
    phaseTiming: TIMING,
    gaps: [],
  },
  {
    id: "20261003-1400-b3-vending-machine-z9c1",
    problemId: "b3-vending-machine",
    title: "Vending Machine",
    track: "lld",
    mode: "guided",
    createdAt: iso(26, 14),
    status: "debriefed",
    verdict: "strong_hire",
    readiness: "ready",
    pause: null,
    notesSaved: true,
    scores: SCORES(2, 3),
    gaps: [],
  },
];

const RECENT = iso(2, 18);
const OLD = iso(30, 20);

/** Two unfinished rounds: one paused two days ago with 43 minutes used, and an old one. */
export const fixtureOpenRounds: SessionHistoryItem[] = [
  {
    id: "20261106-1800-b3-elevator-p4k2",
    problemId: "b3-elevator",
    title: "Elevator Controller",
    track: "lld",
    mode: "interview",
    createdAt: RECENT,
    status: "paused",
    verdict: null,
    pause: { reason: "user", pausedAt: pausedAfter(RECENT, 43), timeLeftMs: 77 * 60_000 },
    notesSaved: false,
    clock: clock(RECENT, 43, 120, true),
  },
  {
    id: "20261009-2015-c2-chat-system-m5p8",
    problemId: "c2-chat-system",
    title: "Chat System",
    track: "hld",
    mode: "interview",
    createdAt: OLD,
    status: "paused",
    verdict: null,
    pause: { reason: "away", pausedAt: pausedAfter(OLD, 27), timeLeftMs: 18 * 60_000 },
    notesSaved: false,
    clock: clock(OLD, 27, 45, true),
  },
];

export const fixtureAllHistory: SessionHistoryItem[] = [...fixtureOpenRounds, ...fixtureHistory].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
