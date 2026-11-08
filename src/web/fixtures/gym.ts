import type { GymDrillRow, GymSummary } from "../../shared/drills";

const TODAY = "2026-11-08";

function row(
  id: string,
  drill: GymDrillRow["drill"],
  title: string,
  problemId: string,
  problemTitle: string,
  minutes: number,
  dueOn: string,
  passes: number,
  task: string,
): GymDrillRow {
  return { id, drill, title, problemId, problemTitle, minutes, dueOn, due: dueOn <= TODAY, passes, task };
}

/** A queue with five drills due, so the page shows the hero, the list and the "more due" line. */
export const fixtureGym: GymSummary = {
  today: TODAY,
  queue: [
    row(
      "a1b2c3d4e5f60001",
      "capacity",
      "Capacity math",
      "c2-url-shortener",
      "URL Shortener",
      10,
      "2026-11-07",
      0,
      'Write one line each for writes, reads, storage, hot set and code space. End each line with "which means".',
    ),
    row(
      "a1b2c3d4e5f60002",
      "walk",
      "Walk a request",
      "c2-url-shortener",
      "URL Shortener",
      10,
      "2026-11-08",
      1,
      "Walk one redirect through your design, box by box, from the first call to the last.",
    ),
    row(
      "a1b2c3d4e5f60003",
      "requirements",
      "Requirements sprint",
      "c2-rate-limiter",
      "Rate Limiter",
      10,
      "2026-11-08",
      0,
      "Write the questions you would ask and the requirements you would settle.",
    ),
    row(
      "a1b2c3d4e5f60004",
      "deep_dive",
      "Pick a deep dive",
      "c2-news-feed",
      "News Feed",
      15,
      "2026-11-08",
      2,
      'Take "Fan-out on write or read": say what goes wrong with the naive way.',
    ),
    row(
      "a1b2c3d4e5f60005",
      "lld_skeleton",
      "LLD skeleton",
      "b3-parking-lot",
      "Parking Lot",
      15,
      "2026-11-08",
      0,
      "Write the classes: names, fields and method signatures, with no bodies.",
    ),
    row("a1b2c3d4e5f60006", "capacity", "Capacity math", "c2-news-feed", "News Feed", 10, "2026-11-12", 1, ""),
  ],
  dueCount: 5,
  problems: [
    { id: "c2-url-shortener", title: "URL Shortener", track: "hld", drills: ["capacity", "walk", "requirements", "deep_dive"] },
    { id: "c2-rate-limiter", title: "Rate Limiter", track: "hld", drills: ["capacity", "walk", "requirements", "deep_dive"] },
    { id: "c2-news-feed", title: "News Feed", track: "hld", drills: ["capacity", "walk", "requirements", "deep_dive"] },
    { id: "b3-parking-lot", title: "Parking Lot", track: "lld", drills: ["lld_skeleton"] },
  ],
  week: { passed: 2, attempted: 3 },
};
