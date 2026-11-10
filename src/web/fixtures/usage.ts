import type { UsageSummaryResponse } from "../backend";

const DAY = 86_400_000;

function day(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
}

function cost(costUsd: number, calls: number, input: number, output: number, cacheRead: number) {
  const creation = Math.round(input * 0.4);
  return {
    cost: costUsd,
    costUsd,
    calls,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: creation,
    cacheHitRate: cacheRead / (input + cacheRead + creation),
  };
}

const DAILY = [0, 0, 0.42, 1.18, 0, 0, 0.9, 2.35, 0.31, 0, 0, 0, 1.64, 0.77, 0, 0.12, 0, 0, 2.91, 1.05, 0, 0.38, 0, 0, 1.4, 0.66, 0, 0, 1.92, 0.54];

/** A month of rounds, so the usage page can be checked without a server or a ledger. */
export const fixtureUsage: UsageSummaryResponse = {
  trackingSince: day(34),
  totals: { ...cost(17.55, 214, 640_000, 182_000, 4_900_000), rounds: 11, drillCost: 0.62 },
  drills: {
    cost: 0.62,
    calls: 14,
    failedCalls: 1,
    attempts: 5,
    byKind: [
      { kind: "capacity", cost: 0.21, calls: 4, attempts: 2 },
      { kind: "lld_skeleton", cost: 0.17, calls: 3, attempts: 1 },
      { kind: "walk", cost: 0.12, calls: 3, attempts: 2 },
      { kind: null, cost: 0.12, calls: 4, attempts: 0 },
    ],
    byAttempt: [
      {
        attemptId: "a1b2c3d4e5f60718",
        kind: "capacity",
        problemId: "c2-url-shortener",
        problemTitle: "URL Shortener",
        date: day(0),
        cost: 0.12,
        calls: 2,
        failedCalls: 0,
        durationMs: 9_000,
      },
      {
        attemptId: "0f1e2d3c4b5a6978",
        kind: "lld_skeleton",
        problemId: "l1-parking-lot",
        problemTitle: "Parking Lot",
        date: day(1),
        cost: 0.17,
        calls: 3,
        failedCalls: 1,
        durationMs: 14_000,
      },
      {
        attemptId: "1122334455667788",
        kind: "walk",
        problemId: "c2-rate-limiter",
        problemTitle: "Rate Limiter",
        date: day(3),
        cost: 0.07,
        calls: 2,
        failedCalls: 0,
        durationMs: 8_000,
      },
      {
        attemptId: "99aabbccddeeff00",
        kind: "capacity",
        problemId: "c2-url-shortener",
        problemTitle: "URL Shortener",
        date: day(6),
        cost: 0.09,
        calls: 2,
        failedCalls: 0,
        durationMs: 7_500,
      },
      {
        attemptId: "abcdef0123456789",
        kind: "walk",
        problemId: "c2-url-shortener",
        problemTitle: "URL Shortener",
        date: day(9),
        cost: 0.05,
        calls: 1,
        failedCalls: 0,
        durationMs: 4_000,
      },
    ],
    earlier: { cost: 0.12, calls: 4 },
  },
  byDay: DAILY.map((value, index) => ({
    date: day(DAILY.length - 1 - index),
    ...cost(value, value > 0 ? Math.ceil(value * 9) : 0, Math.round(value * 41_000), Math.round(value * 11_000), Math.round(value * 310_000)),
  })),
  byProblem: [
    { problemId: "c2-url-shortener", problemTitle: "URL Shortener", track: "hld", rounds: 3, roundCost: 5.5, drillCost: 0.32, ...cost(5.82, 71, 210_000, 61_000, 1_650_000) },
    { problemId: "c2-rate-limiter", problemTitle: "Rate Limiter", track: "hld", rounds: 2, roundCost: 4.03, drillCost: 0.07, ...cost(4.1, 49, 150_000, 42_000, 1_120_000) },
    { problemId: "l1-parking-lot", problemTitle: "Parking Lot", track: "lld", rounds: 4, roundCost: 5.73, drillCost: 0.17, ...cost(5.9, 71, 220_000, 62_000, 1_700_000) },
    { problemId: "l1-vending", problemTitle: "Vending Machine", track: "lld", rounds: 2, roundCost: 1.73, drillCost: 0, ...cost(1.73, 23, 60_000, 17_000, 430_000) },
  ],
  bySession: [
    {
      sessionId: "2026-10-30-parking-lot-a1b2c3",
      problemId: "l1-parking-lot",
      problemTitle: "Parking Lot",
      date: day(1),
      mode: "interview",
      track: "lld",
      durationMs: 0,
      ...cost(2.35, 31, 90_000, 26_000, 700_000),
    },
    {
      sessionId: "2026-10-26-news-feed-d4e5f6",
      problemId: "c2-news-feed",
      problemTitle: "News Feed",
      date: day(5),
      mode: "guided",
      track: "hld",
      durationMs: 0,
      ...cost(0.54, 9, 22_000, 6_500, 160_000),
    },
    {
      sessionId: "2026-10-19-url-shortener-778899",
      problemId: "c2-url-shortener",
      problemTitle: "URL Shortener",
      date: day(12),
      mode: "interview",
      track: "hld",
      durationMs: 0,
      ...cost(2.91, 38, 105_000, 31_000, 820_000),
    },
    {
      sessionId: "2026-10-10-notification-svc-aabbcc",
      problemId: "c2-notification",
      problemTitle: "Notification Service",
      date: day(21),
      mode: "interview",
      track: "hld",
      durationMs: 0,
      ...cost(1.64, 22, 61_000, 18_000, 470_000),
    },
  ],
  byRole: [
    { role: "interviewer", ...cost(4.2, 96, 180_000, 64_000, 1_900_000) },
    { role: "judge", ...cost(9.8, 22, 310_000, 71_000, 1_300_000) },
    { role: "coach", ...cost(2.6, 74, 120_000, 38_000, 1_500_000) },
    { role: "scribe", ...cost(0.95, 22, 30_000, 9_000, 200_000) },
  ],
  byModel: [
    { model: "claude-opus-5-5", ...cost(15.8, 168, 520_000, 150_000, 4_100_000) },
    { model: "claude-sonnet-5-5", ...cost(1.75, 46, 120_000, 32_000, 800_000) },
  ],
};
