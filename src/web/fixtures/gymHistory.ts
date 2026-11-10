import {
  DRILL_RUBRIC,
  addDays,
  type AttemptView,
  type DrillAttemptRow,
  type DrillDetail,
  type DrillOutcome,
  type DrillPoint,
  type DrillType,
  type GymClosedRow,
  type RecentAttemptRow,
} from "../../shared/drills";
import { ApiError } from "../backend";
import type { HistorySource } from "../lib/useDrillHistory";

const TODAY = "2026-11-08";
const ago = (days: number) => addDays(TODAY, -days);

function point(daysAgo: number, kind: DrillType, skill: string, score: number, outcome: DrillOutcome, firstTry = outcome === "ready"): DrillPoint {
  return { day: ago(daysAgo), kind, skill, score, outcome, firstTry };
}

/** Oldest first. The skills are the ones the fixture rounds score, so the Progress page shows diamonds on several rows. */
export const fixturePoints: DrillPoint[] = [
  point(26, "capacity", "scale_reliability", 1.8, "needs_work"),
  point(21, "requirements", "navigation", 2.3, "getting_there"),
  point(18, "capacity", "scale_reliability", 2.5, "getting_there"),
  point(14, "deep_dive", "depth", 2.8, "getting_there"),
  point(12, "walk", "design", 3.3, "ready"),
  point(9, "capacity", "scale_reliability", 3.5, "ready"),
  point(7, "tradeoff", "depth", 2.5, "getting_there"),
  point(5, "walk", "design", 3.5, "ready"),
  point(4, "capacity", "scale_reliability", 3.0, "ready", false),
  point(2, "lld_skeleton", "design", 3.2, "ready"),
  point(1, "deep_dive", "depth", 3.3, "ready"),
];

export const fixtureClosed: GymClosedRow[] = [
  { id: "a1b2c3d4e5f60101", gapTitle: "Said numbers without a decision", drill: "capacity", title: "Capacity math", originProblemTitle: "Notification Service", closedOn: ago(3) },
  { id: "a1b2c3d4e5f60102", gapTitle: "Missed the read path", drill: "walk", title: "Walk a request", originProblemTitle: "Parking Lot", closedOn: ago(11) },
];

const labels = (drill: DrillType, scores: number[]) => DRILL_RUBRIC[drill].criteria.map((k, i) => ({ id: k.id, label: k.label, core: k.core, score: scores[i] ?? 2 }));

const WALK_FIRST = "Client to the load balancer, then the redirect service. It reads the cache, and on a miss it reads a replica.";
const WALK_REVISED =
  "Client to the load balancer, then the redirect service. It reads the cache by code, and on a miss it reads a replica and fills the cache. The write path goes to the primary and writes through to the cache.";

const row = (
  id: string,
  daysAgo: number,
  drill: DrillType,
  problemTitle: string,
  outcome: DrillOutcome,
  scores: number[],
  extra: Partial<DrillAttemptRow> = {},
): DrillAttemptRow => ({
  id,
  at: `${ago(daysAgo)}T09:${10 + (daysAgo % 40)}:00.000Z`,
  problemTitle,
  variantTitle: null,
  outcome,
  firstOutcome: null,
  revised: false,
  scores: labels(drill, scores),
  seconds: 410 + daysAgo * 7,
  costUsd: 0.0412 + daysAgo / 1000,
  legacy: false,
  ...extra,
});

const WALK_ATTEMPTS: DrillAttemptRow[] = [
  row("c0ffee0000000003", 1, "walk", "News Feed", "ready", [3, 3, 3, 2], { variantTitle: "Hot spot (one post)", revised: true, firstOutcome: "getting_there" }),
  row("c0ffee0000000002", 5, "walk", "URL Shortener", "ready", [4, 3, 3, 3]),
  { ...row("c0ffee0000000001", 16, "walk", "URL Shortener", "needs_work", [], { seconds: null, costUsd: null }), legacy: true },
];

export const fixtureDetail: DrillDetail = {
  today: TODAY,
  item: {
    id: "a1b2c3d4e5f60002",
    drill: "walk",
    title: "Walk a request",
    gapTitle: "Walking one request through every box",
    status: "open",
    passes: 1,
    dueOn: TODAY,
    originProblemTitle: "URL Shortener",
    problemId: "c2-news-feed",
    problemTitle: "News Feed",
    variantTitle: "Hot spot (one post)",
    proofs: ["URL Shortener", "News Feed (Hot spot (one post))"],
  },
  attempts: WALK_ATTEMPTS,
};

export const fixtureRecent: RecentAttemptRow[] = [
  ...WALK_ATTEMPTS.slice(0, 2).map((a): RecentAttemptRow => ({ ...a, drill: "walk", title: "Walk a request", drillId: "a1b2c3d4e5f60002" })),
  { ...row("c0ffee0000000004", 2, "lld_skeleton", "Parking Lot", "ready", [3, 3, 3, 2, 2]), drill: "lld_skeleton", title: "LLD skeleton", drillId: null },
  { ...row("c0ffee0000000005", 4, "capacity", "URL Shortener", "getting_there", [3, 2, 3, 3]), drill: "capacity", title: "Capacity math", drillId: "a1b2c3d4e5f60001" },
];

const BODIES: Record<string, AttemptView> = {
  c0ffee0000000003: {
    id: "c0ffee0000000003",
    drill: "walk",
    title: "Walk a request",
    problemTitle: "News Feed",
    task: "Walk one request through your design after the change below. Say which boxes change and why.",
    changed: "One post gets **200,000 reads per second** for an hour. What changes on the path?",
    answers: [WALK_FIRST, WALK_REVISED],
    turns: [],
    grades: [
      {
        outcome: "getting_there",
        scores: labels("walk", [3, 2, 2, 1]),
        wentWell: ["The order of the boxes is right."],
        improve: ["Say what each box reads and writes.", "Name the slowest step."],
        yourLine: "It reads the cache, and on a miss it reads a replica.",
      },
      {
        outcome: "ready",
        scores: labels("walk", [3, 3, 3, 2]),
        wentWell: ["Every box has a job.", "Reads and writes are named."],
        improve: ["Name the slowest step."],
        yourLine: "It reads the cache by code, and on a miss it reads a replica and fills the cache.",
        strong: "The hot post sits on one cache shard, so the redirect servers keep a short local copy of it.",
      },
    ],
  },
  c0ffee0000000002: {
    id: "c0ffee0000000002",
    drill: "walk",
    title: "Walk a request",
    problemTitle: "URL Shortener",
    task: "Walk one redirect through your design, in order, and say what each box does.",
    changed: null,
    answers: [WALK_REVISED],
    turns: [],
    grades: [
      {
        outcome: "ready",
        scores: labels("walk", [4, 3, 3, 3]),
        wentWell: ["The path is complete.", "Each box has one job."],
        improve: ["Say what a cache miss costs."],
        yourLine: "It reads the cache by code, and on a miss it reads a replica.",
      },
    ],
  },
};

export const fixtureHistorySource: HistorySource = {
  drill: async (id) => {
    if (id === fixtureDetail.item.id) return fixtureDetail;
    throw new ApiError(404, "That drill was not found.");
  },
  attempts: async (limit) => fixtureRecent.slice(0, limit ?? fixtureRecent.length),
  attempt: async (id) => {
    const body = BODIES[id];
    if (!body) throw new ApiError(404, "No detail was saved for this attempt.");
    return body;
  },
};
