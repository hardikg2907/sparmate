# Ideas

Ideas we have discussed but not built. Each entry says what the idea is and why it waits. When an idea is built, delete its entry.

## Next

- **Gym.** Short drills of 10 to 15 minutes, each on one skill. The Gym page exists as a placeholder, and its link in the main bar shows no count until drills exist.
  - The drill types are fixed: capacity math, walk a request, requirements sprint, pick a deep dive, LLD skeleton.
  - The judge's gaps choose which drill is due. A gap queues its drill for the next day, then 3 days later, then 7 days later. Three passes in a row close the gap.
  - A drill takes its prompt and its answer key from one section of a problem brief. A grader compares the answer with that section and returns Pass or Not yet, plus the single most important fix.
  - Drills use only problems the candidate has already played, plus custom problems, so a drill never spoils a full round.
  - The candidate can also open any drill without a gap. Due drills come first.
- **LeetCode progress.** The candidate enters a LeetCode username. The app reads LeetCode's public GraphQL endpoint, which needs no login: solved counts by difficulty, solved counts per topic tag and recent accepted submissions. The DSA page, which exists as a placeholder, shows problems solved this week against the weekly goal from Settings, mediums solved, and the weakest topics. The username is already stored in Settings. These counts measure activity, not skill, so the panel never shows a readiness call. The endpoint is unofficial and can change, so a failed read shows the last good numbers with their date. The app never asks for or stores a LeetCode login cookie.

## Parked

- **Pacing in interview mode.** Each step gets a time budget, and the interviewer moves the candidate on when a step runs over. Waits until the guided-mode and Today-page changes land.
- **Audio cues for pacing.** A soft sound when a step reaches its budget, so the candidate feels the clock without looking at it. Depends on pacing.
- **Rich blocks in the chat.** The guide and the coach can send a few fixed kinds of block instead of plain text: a choice card for an H3 hint ("coalesce the misses, or warm the key?") that the candidate answers with one click, a "predict what happens" card with an answer box, a numbers table for capacity math, and a small diagram. Each block type has a strict schema, and the page draws it from its own components, never from model-written HTML. A block always carries a plain-text form, so voice and the transcript still work. Interview mode keeps plain text, because a real interviewer only talks. Waits for the Today page and the Gym, because the Gym's drills can use the same blocks.
