# Sparmate

A local practice room for system design (HLD) and C++ machine-coding (LLD) interviews. An AI interviewer runs
a timed round with you on a whiteboard or in a code editor, then a judge scores the round against the SDE-2 bar,
a coach teaches the gaps, and a scribe drafts the study-note edits for you to approve.

It runs only on this Mac, at `http://127.0.0.1:4747`, and uses your Claude Code login (no API key).

## Start and stop

```
cp .env.example .env   # then set STUDY_ROOT to your study folder
npm install        # first time only
npm start          # builds the page, then serves http://127.0.0.1:4747
```

Stop it with Ctrl+C in that terminal, or `pkill -f "tsx src/server/index.ts"` if it runs in the background.

## A round

1. **Pick a problem** on the home page. "Up next" alternates HLD and LLD and flags `[~]` problems due for a cold
   redo. "Practise any question" turns a pasted prompt into a fully researched and verified problem: an agent
   uses web search to ground real-world numbers and architectures, followed by an independent fact-checker pass
   that verifies claims against sources. A setup card shows sources, checks, and corrections before starting.
2. **Interview** is the real round: 45 minutes for HLD, 120 or 90 for LLD (Settings), no help on the clock, and
   the extension 10 (HLD) or 15 (LLD) minutes before the end. **Guided** walks the steps with you: ask it to
   check a step or give a hint.
3. **HLD:** draw on the whiteboard with the component palette and talk in the chat by typing or voice (mic button
   or Ctrl+M, on-device in Chrome; spoken interviewer replies via local Kokoro neural TTS with half-duplex speaker
   feedback prevention and Esc to interrupt). "What the interviewer sees" shows how your diagram reads as text: fix
   an unlabeled box or a loose arrow there.
   The board has one frame per step: write and draw each step's answer in its frame. Click a step in the step bar
   to move there. The step's frame comes into view whenever you or the guide move the rail. In a guided round, the
   checklist above the chat shows how many things the step covers. Once you check the step, it ticks each one and where
   you said, drew or wrote it ("Said at 04:12", "On the board"), and shows a missing requirement as the question to
   ask; a ring per step in the step bar shows the progress, hovering a step there shows its checklist, and the guide
   pins short notes on your boxes. An interview round shows none of this until the debrief, as a real interviewer would
   not. The check runs on Sonnet when you leave a step, when the round ends and, in a guided round, when you press
   "Check this step"; it never runs while you work in a step. "Check this step" runs the check first, and the guide
   answers once it is done, so its feedback matches the list. In an LLD round the checker reads the code you wrote
   while a step was on the rail: Clarify, Entities and Behaviour read only their own lines, and the build steps read
   the whole file. If the list looks wrong or stale, tell the guide: it can re-read any step from scratch.
4. **LLD:** type C++ in the editor (autocomplete is off on purpose) and press Run. The same file lives at
   `lld/<problem>/attempt-<date>.cpp`, so you can switch to Zed at any time; edits in Zed show up in the browser.
5. **Pause** when you must step away; the round also pauses about a minute after you close its tab. **Discard
   round** deletes a round with no debrief. **End interview** ends the round and starts the debrief.
6. **Debrief:** the verdict at the SDE-2 and senior bars, a score per dimension with your own words quoted
   (each quote is checked against the transcript), the gaps in order, the time per phase, each step's frame with
   what held, what is missing and the judge's pins, and for LLD the tester's scenario results against your code. "Reference answer" opens the problem's model design.
7. **Coach:** the chat on the right teaches the gaps, following `TEACHING.md` (with voice input and spoken replies).
   Push back if a score looks wrong.
8. **Study notes:** "Draft study notes" proposes edits to `TRACKER.md`, `REVIEW.md` and `notes/`. Tick the
   ones you want and click Save. Nothing is written before that, and nothing is written if a file changed since
   the draft.

## What it writes, and where

| What | When | Where |
|---|---|---|
| Tracker mark, Session Log row, gaps, REVIEW entry, notes | Only when you click Save on the study-notes diff | `../TRACKER.md`, `../REVIEW.md`, `../notes/` |
| Your C++ for a round | At the start of an LLD round (a new file, never `main.cpp`) | `../lld/<problem>/attempt-<date>.cpp` |
| Transcripts, boards, scores, settings, usage ledger | All the time | `data/` (git ignores it) |

## Settings and usage

Every role runs on Claude Opus 5.5 by default; the interviewer at effort `low` so replies take a few seconds.
A round uses your Claude plan like any Claude Code session. To spend less, switch the interviewer (and the
coach) to Sonnet in Settings; keep the judge on Opus.

The app tracks model call metrics in `data/usage.jsonl` (input, output, cache read and cache creation tokens,
API-equivalent cost, duration, role and model). Check `/usage` from the header to view overall totals,
daily cost charts, and breakdowns by problem, round, role, and model. Each debrief page also shows a card
with token counts and cost for that specific round.

## Privacy

The app never names your employer. Every model prompt says not to mention your email or workplace, the study
notes are checked against a deny-list before they can be saved (your account email's domain, plus any terms
in `~/.config/sparmate/denylist.txt`, one per line), and the model subprocess loads none of your Claude
Code settings or memory.

## Problems

Problem briefs live in `content/problems/{hld,lld}/`. Each is the interviewer's private answer key: hidden
facts, expected requirements, capacity math or entities, a reference design, accepted alternatives, deep dives,
curveballs or extensions, the level bar and traps. Check a new or edited brief with
`npx tsx scripts/check-problems.ts`.

## For development

```
npm run dev          # vite on :5173 with reload, server on :4747
npm test             # unit tests
npm run typecheck
SPARMATE_FAKE_AGENT=1 npm start                      # no model calls: a scripted fake interviewer and judge
node scripts/e2e/ws-fake-round.mjs             # full rounds over the WebSocket with the fake driver
node scripts/e2e/real-round.mjs --profile strong|weak|lld   # real model, temp copy of the study folder
node scripts/e2e/ui-tour.mjs                   # screenshots of the main pages
```

`docs/SPEC.md` is the full design. `content/prompts/` holds every model prompt as plain Markdown;
`content/rubrics/` holds the scoring rubrics.
