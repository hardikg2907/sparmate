# Spaced Repetition — recall questions

Agents append here at the end of every session (see `TEACHING.md` §8).
Re-test anything older than **1 week** at the start of a session, before new material. Two minutes, no notes.

This is a **diagnostic**, not a scoreboard. A shaky answer here is a cheap catch — re-teach and move on.

**Format:**

```
## <Topic ID> — <name> · taught YYYY-MM-DD
1. <explain-to-a-junior question>
2. <tradeoff sentence question>
3. <transfer question>
Result YYYY-MM-DD: <solid / shaky on #2 / failed — re-taught>
```

---

<!-- append below -->

## A4 — Replication · taught 2026-09-26
1. Explain to a junior: why can a read from a replica return older data than a read from the leader?
2. Finish it: "You'd read from the leader instead of a replica when ___, because you're trading ___ for ___."
3. Transfer: a user posts a comment, reloads the page and does not see it. Name two causes and one fix for each.

Result 2026-09-26: **[~] — mechanism solid, fixes shaky.**
- **Q1 — good.** Named asynchronous shipping and apply lag.
- **Q3 — one cause found.** Missed the case of two replicas at different lag; re-taught read-your-writes.
