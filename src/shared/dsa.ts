import type { Settings } from "./types";

export const DSA_STATUSES = ["ok", "stale", "no_username", "not_found", "error"] as const;
export type DsaStatus = (typeof DSA_STATUSES)[number];

/** Why the last read of LeetCode did not give new numbers. */
export const DSA_FAILURES = ["timeout", "unreachable", "unexpected_reply", "busy", "not_found"] as const;
export type DsaFailure = (typeof DSA_FAILURES)[number];

export type LeetcodeDifficulty = "Easy" | "Medium" | "Hard";

export interface DsaTopic {
  name: string;
  slug: string;
  solved: number;
}

export interface DsaSolve {
  title: string;
  slug: string;
  /** Null when the difficulty could not be read yet. */
  difficulty: LeetcodeDifficulty | null;
  /** ISO time of the accepted submission. */
  solvedAt: string;
}

export interface DsaResponse {
  username: string | null;
  status: DsaStatus;
  /** ISO time of the last good read, or null when nothing was ever read for this name. */
  fetchedAt: string | null;
  /** First local day that counts, "YYYY-MM-DD". */
  countFrom: string | null;
  /** Distinct problems solved since `countFrom`, by difficulty. `unread` counts problems whose difficulty is not known, so the three levels plus `unread` add up to `solved`. */
  pass: { solved: number; easy: number; medium: number; hard: number; unread: number };
  /** Topics with at least one solve since `countFrom`, most solved first. */
  topics: DsaTopic[];
  week: {
    solved: number;
    mediums: number;
    /** Solved problems per local day, Monday first. */
    perDay: number[];
  };
  /** Up to 10 distinct problems, newest first. */
  recent: DsaSolve[];
  /** Everything LeetCode counts on the account, including earlier years. Null when it was not read. */
  lifetimeSolved: number | null;
  weeklyGoal: number;
  /** Set when the numbers are stale or missing because the last read did not work. */
  failure: { reason: DsaFailure; at: string } | null;
  /** ISO time before which a "read again" returns the saved numbers. Null when a read is allowed now. */
  nextReadAt: string | null;
}

/** The topics an interview round is likely to touch. LeetCode's own tag slugs map to a plain name. */
export const COMMON_TOPICS: readonly { slug: string; name: string }[] = [
  { slug: "array", name: "Array" },
  { slug: "string", name: "String" },
  { slug: "hash-table", name: "Hash Table" },
  { slug: "two-pointers", name: "Two Pointers" },
  { slug: "sliding-window", name: "Sliding Window" },
  { slug: "stack", name: "Stack" },
  { slug: "binary-search", name: "Binary Search" },
  { slug: "linked-list", name: "Linked List" },
  { slug: "tree", name: "Tree" },
  { slug: "graph", name: "Graph" },
  { slug: "heap-priority-queue", name: "Heap" },
  { slug: "backtracking", name: "Backtracking" },
  { slug: "dynamic-programming", name: "Dynamic Programming" },
  { slug: "greedy", name: "Greedy" },
  { slug: "trie", name: "Trie" },
  { slug: "union-find", name: "Union Find" },
];

export interface TopicFocus {
  /** True when the list holds common topics with no solve at all; false when it holds the three with the fewest. */
  untouched: boolean;
  topics: DsaTopic[];
}

/**
 * What to practise next among the common topics. A topic missing from `topics` has zero solves. While some common
 * topic is still untouched the list is exactly those; once all have a solve it is the three with the fewest.
 */
export function topicFocus(topics: readonly DsaTopic[], count = 3): TopicFocus {
  const bySlug = new Map(topics.map((t) => [t.slug, t.solved]));
  const common = COMMON_TOPICS.map((t, order) => ({ name: t.name, slug: t.slug, solved: bySlug.get(t.slug) ?? 0, order }));
  const none = common.filter((t) => t.solved === 0).map(({ name, slug, solved }) => ({ name, slug, solved }));
  if (none.length > 0) return { untouched: true, topics: none };
  const weakest = [...common].sort((a, b) => a.solved - b.solved || a.order - b.order).slice(0, count);
  return { untouched: false, topics: weakest.map(({ name, slug, solved }) => ({ name, slug, solved })) };
}

export function emptyDsa(username: string | null, status: DsaStatus, weeklyGoal: number, countFrom: string | null = null): DsaResponse {
  return {
    username,
    status,
    fetchedAt: null,
    countFrom,
    pass: { solved: 0, easy: 0, medium: 0, hard: 0, unread: 0 },
    topics: [],
    week: { solved: 0, mediums: 0, perDay: [0, 0, 0, 0, 0, 0, 0] },
    recent: [],
    lifetimeSolved: null,
    weeklyGoal,
    failure: null,
    nextReadAt: null,
  };
}

/** A saved username without a count-from day starts counting today, so the page never opens on earlier years. */
export function withDefaultCountFrom(settings: Settings, today: string): Settings {
  if (settings.leetcodeUsername === undefined || settings.dsaCountFrom !== undefined) return settings;
  return { ...settings, dsaCountFrom: today };
}
