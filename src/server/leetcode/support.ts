import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LeetcodeClient } from "./client";
import type { LedgerEntry, ProblemInfo } from "./compute";

export const fixture = (name: string): string => readFileSync(join(__dirname, "__fixtures__", `${name}.json`), "utf8");

export const jsonResponse = (body: string, init: ResponseInit = {}): Response => new Response(body, { status: 200, headers: { "content-type": "application/json" }, ...init });

/** Unix seconds of a local date and time, so a test never depends on the machine's time zone. */
export const at = (y: number, m: number, d: number, h = 12, min = 0): number => Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000);

export const solve = (slug: string, timestamp: number): LedgerEntry => ({ title: slug.replace(/-/g, " "), slug, timestamp });

export const EASY: ProblemInfo = { difficulty: "Easy", topics: [{ name: "Array", slug: "array" }] };
export const MEDIUM: ProblemInfo = {
  difficulty: "Medium",
  topics: [
    { name: "Array", slug: "array" },
    { name: "Graph", slug: "graph" },
  ],
};
export const HARD: ProblemInfo = { difficulty: "Hard", topics: [{ name: "Heap (Priority Queue)", slug: "heap-priority-queue" }] };

/** A client whose answers a test sets, and which counts what it was asked. */
export function fakeClient(over: Partial<LeetcodeClient> = {}): LeetcodeClient & { calls: { profile: number; recent: number; problem: number } } {
  const calls = { profile: 0, recent: 0, problem: 0 };
  return {
    calls,
    profile: async () => {
      calls.profile += 1;
      return { found: true, profile: { totals: { all: 100, easy: 40, medium: 40, hard: 20 } } };
    },
    recent: async () => {
      calls.recent += 1;
      return [];
    },
    problem: async () => {
      calls.problem += 1;
      return EASY;
    },
    ...over,
  };
}
