import type { Proposal } from "../../shared/types";

const TRACKER_DIFF = `--- TRACKER.md
+++ TRACKER.md
@@ -118,7 +118,7 @@
 ### C2. Classic HLD Problems

-- [ ] URL Shortener
+- [~] URL Shortener → notes/c2-url-shortener.md · 2026-10-30
 - [ ] Rate Limiter
 - [ ] News Feed
 - [ ] Chat System
@@ -302,3 +302,4 @@
 | 2026-10-24 | B3 | Vending machine, guided | [x] with notes |
 | 2026-10-28 | B3 | Parking lot | [~] two state bugs |
+| 2026-10-30 | C2 | URL shortener | [~] unique codes across servers, cache failure |

@@ -330,3 +331,4 @@
 | Date | Gap | Came up while | Filled |
 |---|---|---|---|
 | 2026-10-28 | Validate a ticket before freeing a spot | Parking lot | yes |
+| 2026-10-30 | Unique ids across several servers | URL shortener | yes |
`;

const REVIEW_DIFF = `--- REVIEW.md
+++ REVIEW.md
@@ -88,3 +88,14 @@
 3. Why does a hot key hurt a cache cluster more than a single large value?

 ---
+
+## 2026-10-30 · URL Shortener
+
+1. Two servers each hold a counter at 1,000. What goes wrong, and how does a block of ids fix it?
+2. A server dies holding an unused block of 1,000 ids. What happens to those ids, and does it matter?
+3. Redis disappears. Reads on Postgres go up by roughly what factor, and what would you do first?
+4. Why is the code the primary key of the links table?
`;

const NOTES_DIFF = `--- /dev/null
+++ notes/c2-url-shortener.md
@@ -0,0 +1,18 @@
+# URL Shortener
+
+## My design
+
+- CDN in front, then a stateless redirect service.
+- Redis holds the hot set, about 50 GB.
+- Postgres is the source of truth, keyed by the code.
+- A 302 redirect, so clicks can be counted and links deleted quickly.
+
+## Gaps
+
+1. Unique codes across several servers. A single counter does not survive two writers.
+2. Cache failure. Postgres takes about 100 times the reads it was sized for.
+
+## The clean version of what broke
+
+Each create server holds a block of ids from a small coordinator and encodes its own counter inside the block. A dead server wastes the unused ids, and that is fine because the code space is huge.
`;

export function fixtureProposal(): Proposal {
  return {
    id: "fixture-proposal-1",
    sessionId: "fixture",
    createdAt: new Date().toISOString(),
    ops: [
      {
        id: "op1",
        file: "TRACKER.md",
        summary: "Mark URL Shortener as partly done and link its notes",
        blocked: null,
        op: { kind: "tracker_update_bullet", section: "### C2. Classic HLD Problems", bullet: "URL Shortener", mark: "[~]", appendSuffix: "→ notes/c2-url-shortener.md · 2026-10-30" },
      },
      {
        id: "op2",
        file: "TRACKER.md",
        summary: "Add a Session Log row for 2026-10-30",
        blocked: null,
        op: { kind: "tracker_append_session_log_row", date: "2026-10-30", topics: "URL shortener", outcome: "[~] unique codes across servers, cache failure", notesFile: "notes/c2-url-shortener.md" },
      },
      {
        id: "op3",
        file: "TRACKER.md",
        summary: "Add a Gaps Found and Filled row: unique ids across several servers",
        blocked: null,
        op: { kind: "tracker_append_gap_row", date: "2026-10-30", gap: "Unique ids across several servers", cameUpWhile: "URL shortener", filled: "yes" },
      },
      {
        id: "op4",
        file: "TRACKER.md",
        summary: "Add a sub-bullet under Rate Limiter for token buckets",
        blocked: "The bullet 'Rate Limiter' was not found in that section.",
        op: { kind: "tracker_add_subbullet", section: "### C2. Classic HLD Problems", parentBullet: "Rate Limiter", text: "Token bucket versus sliding window" },
      },
      {
        id: "op5",
        file: "REVIEW.md",
        summary: "Add four recall questions for URL Shortener",
        blocked: null,
        op: { kind: "review_append_entry", markdown: "## 2026-10-30 · URL Shortener\n\n1. Two servers each hold a counter at 1,000..." },
      },
      {
        id: "op6",
        file: "notes/c2-url-shortener.md",
        summary: "Create the notes file for URL Shortener",
        blocked: null,
        op: { kind: "notes_create", path: "notes/c2-url-shortener.md", content: "# URL Shortener\n\n## The reference design\n\n- CDN in front, then a stateless redirect service.\n- Redis holds the hot set." },
      },
    ],
    diffs: [
      { file: "TRACKER.md", diff: TRACKER_DIFF },
      { file: "REVIEW.md", diff: REVIEW_DIFF },
      { file: "notes/c2-url-shortener.md", diff: NOTES_DIFF },
    ],
    baseHashes: { "TRACKER.md": "a".repeat(64), "REVIEW.md": "b".repeat(64), "notes/c2-url-shortener.md": null },
    status: "draft",
  };
}
