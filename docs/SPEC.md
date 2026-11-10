# Sparmate — build spec

A local web app for practising system design (HLD) and machine-coding (LLD, C++) interviews against an AI
interviewer, then getting a scored debrief, a coach who fills the gaps, and drafted study notes to approve.
It runs on one machine at `http://127.0.0.1:4747`, uses the user's existing Claude Code login through the Claude
Agent SDK (no API key), and reads and edits a personal study folder (the "study root", set with `STUDY_ROOT`),
which holds `TEACHING.md`, `TRACKER.md`, `REVIEW.md`, `notes/` and `lld/`. When the study root is missing or
empty, the server fills it from `study-kit/` at start.

Read these before building: `src/shared/*.ts` (the typed contract), the two fixture problems in
`content/problems/`, and the study root's `TEACHING.md` sections 2, 10, 12 and 13.

---

## 1. Non-negotiables

1. **Privacy.** The study folder is personal and has nothing to do with the user's job. No code, prompt,
   comment, fixture, test or file this app writes may contain an employer, company, product or internal
   service name. The model subprocess receives the user's account email as automatic context (a Claude Code
   behaviour that cannot be switched off with the OAuth login), so: every model role's prompt says never to
   mention it, and the privacy guard (section 11) blocks any bookkeeping write containing a deny-listed term.
2. **The interviewer behaves like a real interviewer** (TEACHING.md section 10): short prompt, no hints
   volunteered, no teaching or rescuing while the clock runs, one level deeper where a real interviewer would
   push, the extension at the right time (HLD: 10 minutes left; LLD: 15 minutes left). Syntax help in C++ is
   allowed at once; design help is not.
3. **The candidate's own methods drive the phase rail:** five HLD steps and seven LLD steps
   (`src/shared/phases.ts`). The rail is a guide, never a gate: the candidate may move freely. Each step has planned
   minutes that scale with the round's length and add up to it exactly (45 and 90 minutes are the base plans); the
   guide's pace nudges, the clock checkpoints, the pace chip and the debrief's and Progress's planned minutes all read the same plan. A round scored under an older plan shows its real times against today's plan; its saved file is not changed.
4. **Marks follow the tracker rules.** Guided rounds earn at most `[~]`, and get a readiness call instead of a hire verdict (section 5.7). `[x]` needs: finished inside the
   time, the code ran (LLD), and no gap at the target level bar.
5. **Never edit the candidate's code or `main()`.** Tests compile his file plus a separate harness `main()`.
6. **Nothing is written to `TRACKER.md`, `REVIEW.md` or `notes/` without the user approving the exact diff.**
7. **Offline UI.** The page loads nothing from the internet (fonts and editor are served locally). Only the
   Claude subprocess talks to the network.

---

## 2. Running

```
npm install          # once, from the repository root
npm start            # vite build, then serve on http://127.0.0.1:4747
npm run dev          # vite on :5173 (proxies /api, /ws, /excalidraw-assets) + server on :4747 with reload
npm test             # vitest unit tests
npm run typecheck
```

Environment variables (all optional). The server also reads them from a gitignored `.env` file in the repository root (`KEY=value` lines; variables already set in the environment win). `.env.example` lists them.

| Variable | Default | Use |
|---|---|---|
| `PORT` | `4747` | Server port. The server binds `127.0.0.1` only natively, or `0.0.0.0` when `SPARMATE_IN_CONTAINER=1`. |
| `STUDY_ROOT` | `~/sparmate-study` | Where `TRACKER.md`, `REVIEW.md`, `notes/`, `lld/` live. Tests point it at a temp copy. |
| `DATA_DIR` | `<STUDY_ROOT>/rounds` | Sessions, settings, custom problems, drill schedule and attempts, usage ledger, logs. |
| `SPARMATE_IN_CONTAINER` | unset | `1` enables container mode: server listens on `0.0.0.0`, strict host/origin allow-lists applied. |
| `SPARMATE_FAKE_AGENT` | unset | `1` replaces every model call with the deterministic fake driver (section 5.7). Its calls still write ledger rows, with tokens and a cost of 0, so a test run never changes the cost totals. |
| `SPARMATE_CLAUDE_JSON` | `~/.claude.json` | Where the privacy guard reads the account email (section 11). |
| `SPARMATE_DENYLIST` | `~/.config/sparmate/denylist.txt` | Extra deny-listed terms, one per line, kept outside the repo. |
| `SPARMATE_KOKORO_HOME` | `<DATA_DIR>/kokoro` | Local Kokoro neural TTS folder holding `.venv/bin/python`, `kokoro-v1.0.onnx` and `voices-v1.0.bin`. |
| `SPARMATE_AWAY_MS` | unset (60000) | Tests only. Milliseconds a live round may have no open socket before it pauses as "away" (section 5.5). An integer from 50 to 600000. |

Data layout under `DATA_DIR` (shown for the default, `<STUDY_ROOT>/rounds`):

```
rounds/
  settings.json                      Settings (src/shared/types.ts), defaults when missing
  usage.jsonl                        append-only model call ledger (tokens, cost, duration)
  leetcode.json                      the DSA solve ledger and cached problem details (below)
  drills.json                        the drill queue and the index of every drill attempt, format version 2 (section 12.1)
  drill-attempts/<attemptId>.json    the saved body of one drill attempt: task, answers, dialogue turns and grades
  sessions/<sessionId>/              deleted whole when the round is discarded (section 5.11)
    session.json                     Session, rewritten atomically after every change worth keeping
    board.json                       { version, elements } latest scene
    board-final.png                  PNG captured at the end (for the judge and the debrief page)
    proposals/<proposalId>.json      bookkeeping drafts
  custom-problems/<id>.md            problems generated from a pasted prompt
  runtime/agent-cwd/                 empty working directory for every model subprocess
  runtime/cpp/<random>/              temp build folders, deleted after each run
  logs/server.log                    no secrets, no model prompts, no deny-listed terms
```

Session ids: `YYYYMMDD-HHMM-<problemId>-<4 random base36 chars>` from `crypto.randomBytes`.

---

## 3. Layout and ownership

Each build agent owns the paths listed for it and edits nothing else. Shared contract files
(`src/shared/types.ts`, `src/shared/protocol.ts`, `src/shared/phases.ts`, `src/shared/problem.ts`) are owned by
the spec author: if one needs a change, stop and report it instead of editing it.

```
<repository root>/
  study-kit/                           starter study folder copied into an empty STUDY_ROOT
  docs/SPEC.md                         spec author
  content/problems/{hld,lld}/*.md      spec author + content writers
  content/prompts/*.md                 PROMPTS agent
  content/rubrics/{hld,lld}.md         PROMPTS agent
  content/candidate.md                 PROMPTS agent
  src/shared/{types,protocol,phases,problem,stepFrames,checklist}.ts   spec author
  src/shared/graph/**, src/shared/{clang,quotes,lint}.ts   MODULES agent
  src/server/runner/**, src/server/study/**, src/server/guard/**   MODULES agent
  src/server/index.ts, src/server/http/**, src/server/engine/**   ENGINE agent
  scripts/e2e/**                       ENGINE agent (WebSocket scripts); verification agents later
  src/web/board/**, src/web/code/**    WORKSPACE agent
  src/web/** (everything else)         SHELL agent
```

Stub files already exist for every module boundary (signatures with `throw new Error("not implemented")` or a
placeholder component). Owners replace the bodies and keep the exported signatures. Changing an exported
signature needs the spec author.

No new npm dependencies. Everything needed is installed (see `package.json`). If something truly cannot be
built without one, stop and report it.

---

## 4. Architecture

```
 Browser (React)                                   Node server (Fastify, 127.0.0.1:4747)
 ─────────────────                                 ───────────────────────────────────────────────
 Home ── REST /api/* ───────────────────────────> http/routes ──> engine/sessions (store + state machine)
 Room ── WS /ws/session/:id ────────────────────> engine/socket ──> engine/session-runtime (one per live session)
   Board (Excalidraw) ── board.update ─────────>      ├─ graph: sceneToGraph -> text form for the models; one frame per step
   CodeEditor (Monaco) ─ code.update ──────────>      ├─ lld file: lld/<folder>/attempt-<date>.cpp, watched for edits from your editor
   Chat ──────────────── chat.send ────────────>      ├─ clock: checkpoints -> <clock> events to the interviewer
   <── chat.delta / chat.message / board.png.request ─┤ drivers: ClaudeDriver (Agent SDK) | FakeDriver
                                                      │   roles: interviewer, guide, tester, judge, coach, scribe, brief-writer, checker
                                                      ├─ runner: clang++ in sandbox-exec (syntax check, run, harness)
                                                      └─ study: tracker marks, scribe extracts, proposals, guarded apply
```

---

## 5. The agent engine (ENGINE agent)

### 5.1 Base SDK options for every role

```ts
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
const base = {
  settingSources: [],            // never load user or project settings: the user's CLAUDE.md imports work context
  tools: [],                     // no built-in tools at all
  strictMcpConfig: true,
  mcpServers: { room: <in-process server with this role's tools> },
  allowedTools: ["mcp__room__<name>", ...],   // exactly this role's tools
  permissionMode: "default",
  permissionPrompts: "none",     // nothing answers prompts, so any tool outside allowedTools is denied at once
  cwd: DATA_DIR/runtime/agent-cwd,
  model, effort,                 // from settings per role
  systemPrompt: <rendered prompt file>,       // a plain string: replaces Claude Code's own system prompt
  verbatimPrompts: true,         // candidate text reaches the model as written: no @path expansion, no slash commands
  env: { ...process.env minus the parent Claude Code session variables, CLAUDE_AGENT_SDK_CLIENT_APP: "sparmate/0.1" },
  stderr: (line) => log (redacted, truncated),
};
```

These were verified on this machine (SDK 0.3.312): login works with no API key (`apiKeySource: "none"`),
in-process MCP tools work, tool results can carry PNG image blocks that the model reads, multi-turn streaming
input works, and `outputFormat: { type: "json_schema", schema }` returns `structured_output` on the result.
Opus 5.5 answered a short turn with one tool call in about 4 seconds at effort `low`.

Streaming roles (interviewer, guide, coach) use streaming input: `query({ prompt: asyncIterable, options })`
with an app-owned queue, `includePartialMessages: true` (text deltas become `chat.delta`), and
`persistSession: true` so `resume` can be attempted after a restart. One-shot roles (tester, judge, scribe,
brief-writer) use a single user message (an async iterable of one message when an image is attached) and
`persistSession: false`.

Model ids are exact strings: `claude-opus-5-5`, `claude-sonnet-5-5`. Defaults are in `DEFAULT_SETTINGS`.

Structured output: build the JSON Schema with `z.toJSONSchema(...)` from the zod schemas in
`src/shared/types.ts` and drop the root `$schema` key (the CLI rejects zod's draft 2020-12 URI; `oneOf`,
`const`, length limits, `pattern`, `minimum` and `maximum` are all accepted). Always validate the result with
the zod schema in code. Never trust model JSON without the zod parse.

### 5.2 Roles

| Role | When | Mode | Tools | Output |
|---|---|---|---|---|
| interviewer | live round, interview mode | streaming, persisted | view_whiteboard, set_phase, note_hint, end_interview; LLD adds read_code, run_code | chat text |
| guide | live round, guided mode | streaming, persisted | same as interviewer, plus pin_note, recheck_step and step_verdict | chat text |
| tester | LLD, after the round ends | one-shot | read_code, run_harness | `{ compiled, scenarios[{name,pass,detail,cause?}], notes }` structured |
| judge | after the round (and the tester) | one-shot | pin_element (board PNG attached as an image block) | `ScorecardSchema` structured |
| coach | after the debrief, when the candidate starts the chat | streaming, persisted | read_transcript, view_whiteboard, set_gap, read_code, run_code (LLD) | chat text on the `coach` channel |
| scribe | when the user clicks "Draft study notes" | one-shot | none | `ScribeOutputSchema` structured |
| brief-writer | custom problem preparation | one-shot | WebSearch (<= 8), WebFetch (<= 6) | `{ meta: { title, difficulty, tags }, body, sources, confidence }` structured |
| brief-checker | custom problem verification | one-shot | WebFetch, WebSearch (<= 3) | `{ body, corrections, unconfirmed? }` structured |
| grader | when the candidate submits, or replies in, a drill (section 12.1) | one-shot, default `claude-sonnet-5-5` at effort `medium`, set in Settings `models.grader` and `effort.grader` | none | `{ scores, wentWell, improve, yourLine, strong }` structured, checked and trimmed by the server; the server derives the outcome from the scores. The interviewer questions of a dialogue drill use the same role and the prompt `drill-follow-up`, and return `{ question }` or `{ another, question }`, checked and cleaned by the server |
| checker | when the round leaves a step, when the round ends, on a guided step check, and when the guide re-reads a step (section 5.11) | one-shot, always `claude-sonnet-5-5` at effort `low` | none (a frame PNG attached as an image block when needed) | `{ items[{ id, state, source, quote, detail }] }` structured, verified and stored in `Session.stepChecks` |

Tool definitions (zod input schemas, every input validated, size-capped):

- `view_whiteboard()` -> asks the browser for a PNG (`board.png.request`, 15 s timeout), returns
  `[{type:"image", data, mimeType:"image/png"}, {type:"text", text: graphText}]`. If the browser does not
  answer, return the graph text alone and say the image was unavailable.
- `read_transcript({ at? })` (coach only) -> the round's interview transcript, one `[mm:ss] role: text` line per entry
  with app events as `(event)` lines. A recorded hint shows as `The interviewer gave a hint on: <topic>`, without its
  level; other hidden notes are left out; a line break inside an entry starts an indented line. With `at` (`mm:ss`,
  brackets allowed, at most 10 characters) it returns only the lines from three minutes before to two minutes after
  that time; an `at` that is not a time is a tool error. A transcript over 60,000 characters is cut, with a note to ask
  for a time.
- `set_phase({ phase })` -> phase must belong to the track; records `phaseHistory` with `by: "interviewer"`.
- `note_hint({ level: 1|2|3, topic })` -> appends to `session.hints`. Hidden from the candidate.
- `end_interview({ reason })` -> ends the round (same path as the candidate's end).
- `pin_note({ elementId, note })` (guide only, so an interview round has no pins) and `pin_element({ elementId, note,
  verdict: "held"|"gap" })` (judge) -> attach a note of at most `LIMITS.pinNoteChars` (200) characters to one board
  element. The server checks the id against the board as it is now: it must name a box (rectangle, ellipse, diamond) or
  an arrow; text, frames, freehand strokes and unknown ids are refused with an error the model can read. The note is
  reduced to one plain line (control characters and line breaks become spaces). One pin per element and author (a new
  note replaces the old one); at most 30 guide pins per round and 12 judge pins. The pin records the step of the frame
  that holds the element. The models get the ids from a pin targets list (`pinTargets` in `src/shared/graph/frames.ts`):
  the guide in `view_whiteboard` and in every "Check this step" request, the judge as `<pin_targets>`.
- `step_verdict({ phase, verdict: "pass"|"not_yet", gap? })` (guide only) -> the guide's call on one step, and the only
  "passed" the candidate sees. The input is a strict schema (unknown fields are refused). `phase` must be a step of the
  round. For `not_yet`, `gap` is required: control characters and line breaks become spaces, it is trimmed, and it must
  be 1 to 200 characters of plain text; for `pass`, `gap` is dropped. It is stored in `Session.stepVerdicts[phase]` as
  `{ verdict, gap?, at, misses? }` (`at` is round time in ms; `misses` counts the step's `not_yet` calls, and a
  session saved without it counts a held `not_yet` as one) and the session state is broadcast. After a step's second
  `not_yet` its checks give only a count (`checksCountOnly`), whether he pressed "Check this step" or asked in the
  chat: the request and the `steps:` line ("checks give only a count: Requirements") tell the guide to name nothing
  that is missing, a guide `pin_note` on an element of a counted step (or, outside every frame, while the current step is counted) is refused, and the server stores the gap as
  `openCountText` ("3 things are still open. Press Hint for a nudge toward the next one."), whatever gap the guide
  wrote, an empty one included. The count is the items the checker has not read as covered; a step that needs one
  item (Deep dives) counts one until one is covered and "Some things" after that, and the count reads "Some things"
  when no finished reading matches his latest work (a check asked for in the chat runs no new reading). The machine
  coding build steps (Skeleton on) are never counted, because their checks name the exact cause of a failing compile
  or run. A hint press is then how he hears the next open item. A pass is final: a later
  `not_yet` for a passed step is refused with an error that says the step already passed and must not be raised again.
  A `pass` may replace a `not_yet`. The guide calls it once per step check, and again with `not_yet` after a refused pass. In the reply to "I'm stuck" a `pass` is
  refused, so a model answer never earns one. Each check ends with a verdict. A new `pass` must be supported by the
  checker's reading of the step (`passCheck`): the server first brings the reading up to date (it waits for a check
  that is already running, else runs one only when the evidence changed since the last finished reading, and waits at
  most 60 s), then counts the items read as `covered`. An edit he makes while the checker reads does not void the
  reading that just finished.
  A pass needs at least half of the step's items, rounded up and at least one (`passNeed`); Deep dives needs one,
  because its level bar asks for one deep dive done properly, and Extension needs both of its items, because it is
  done only when the demo runs after the change. A partial item does not count. A step he has said, drawn and
  written nothing for is refused, and so is a pass after the round ended. Too few covered items refuse the pass with an
  error that gives the count, the items not covered yet, and tells the guide to name the most important one, to keep
  the reading to itself, and to call `recheck_step` once if he covered more than it shows. A step with no checklist,
  or whose reading is out of date because no check finished while the server waited (the checker failed or ran out of
  time), is left to the guide,
  so a broken checker never locks a step. An accepted pass returns the `steps:` line, so the guide names the steps still open.
- `recheck_step({ phase })` (guide only) -> the phase must belong to the track, else an error that lists the valid
  ids. Reads that step's checklist again from scratch (section 5.11): it bypasses the unchanged-evidence skip, and its
  result replaces the step's items. Any step, not only the current one. It waits for a check of that step that is
  already running, waits for the result for at most 60 s, and returns one line per item (id, label, state, and where:
  said at mm:ss, on the board, in the code or in the written answer; a partial item adds what it lacks), or says the check did not finish. At
  most 3 calls per guide reply.
- `read_code()` -> the current file with line numbers, plus the last syntax-check summary.
- `run_code()` -> compile and run the candidate's program (section 8) and return the result as text.
- `run_harness({ harness })` -> section 8.4. Harness source up to 100 KB.
- `WebSearch`, `WebFetch` -> built-in SDK tools enabled only for `brief-writer` and `brief-checker`. Web content is untrusted data; tool caps are enforced via prompt and a PreToolUse hook.

### 5.3 Prompts

Prompt files live in `content/prompts/` and use `{{name}}` placeholders. The engine renders them with a
plain string replace (no template engine, no eval). An unknown placeholder left in a rendered prompt is a bug:
fail loudly in development. Files and variables:

| File | Role | Variables |
|---|---|---|
| `interviewer-hld.md`, `interviewer-lld.md` | interviewer | common + `problem_brief`, `extension_minute`, `phase_plan` |
| `guide-hld.md`, `guide-lld.md` | guide | common + `problem_brief`, `phase_plan`, `focus` (pins: when and how to use `pin_note`) |
| `tester-lld.md` | tester | common + `problem_brief` |
| `judge-hld.md`, `judge-lld.md` | judge | common + `problem_brief`, `rubric` (pins: up to eight `pin_element` calls) |
| `coach.md` | coach | common + `problem_brief`, `teaching_md`, `scorecard_json` |
| `scribe.md` | scribe | common + `teaching_md` |
| `brief-writer.md` | brief-writer | common + `section_list`, `example_problem` |
| `brief-checker.md` | brief-checker | common + `example_problem` |
| `checker.md` | checker | common only |

`focus` is empty for a normal round. For a round on one debrief gap (`Session.focus`) it is a paragraph naming the
gap and quoting the judge's "what good looks like", so the guide steers every step toward it. When the gap's step is
known it also names that step and says the gap counts as practised when that step passes with no "I'm stuck" on it.

Common variables: `date` (YYYY-MM-DD), `problem_title`, `track` ("hld"/"lld"), `mode`, `duration_min`,
`candidate_profile` (read from `<studyRoot>/ABOUT_ME.md` when present, else `content/candidate.md`). The bar comes from one line of that profile, `Target: SDE-2; stretch: senior; company: Series A to C startup`, read by `src/shared/target.ts`. Each part is optional and defaults to the value shown; the line is matched only as `Target:` at the start of a line, so other wording never changes the bar. It fills `target_level`, `stretch_level` and `target_company`, and the same variables fill the rubric text before it enters a prompt. The page never names a fixed level: it says "target level" and "stretch level" (the Library result badge reads "Result at your target level", and the top score word is "Stretch signal"). The judge copies the two level names into `verdict.targetLevel` and `verdict.stretchLevel`, and the debrief shows them; the stored verdict keys stay `sde2` (the target level call) and `senior` (the stretch level call). `problem_brief` is the problem file body.
`teaching_md` is the study root's `TEACHING.md`, read fresh at role start. `rubric` is
`content/rubrics/<track>.md`. `phase_plan` is one line per phase: `- <label>: about <n> min — <goal>`.

Rubric dimension ids (fixed; the UI labels them):
- HLD: `navigation`, `design`, `depth`, `scale_reliability`, `communication`, `drive_time`.
- LLD: `requirements`, `working_code`, `design`, `extensibility`, `edge_cases`, `concurrency`, `code_quality`, `communication_time`.

### 5.4 The message envelope

The model never sees raw candidate text alone. Every candidate message to the interviewer, guide or coach is
wrapped by the engine:

```
<context>
time: 12:34 of 45:00 · phase: api (planned 7:00–11:00)
behind plan: 1:34 past the planned end of this phase          (interview mode, only from 30 s past the planned end)
steps: passed: Requirements · not passed yet: Core entities, API, High-level design, Deep dives   (guided mode only)
board: changed since you last looked (version 14)
<board>
(graph text from graphToText)
</board>
notes: written step text, changed since you last looked
<notes>
[Requirements]
(his text for that step)
</notes>
code: 142 lines, changed · last check: 2 errors, 1 warning          (LLD only)
last run: exit 0 in 41 ms, 18 lines of output                       (LLD only, when a run happened since the last message)
events: candidate moved to phase "design" at 12:10                  (only if any happened)
</context>
<candidate>
(the candidate's message, verbatim)
</candidate>
```

`board:` says `unchanged (version 14)` and omits the `<board>` block when nothing changed since the
interviewer's previous envelope. The coach envelope has no `time:` line. `steps:` (`stepStatusLine` in
`src/server/engine/step-verdict.ts`) lists the guided steps that have a pass and those that do not, in rail order, or
reads `every step has passed`; it is on every guide turn, so the guide never states the steps from memory.

`<notes>` holds written step text a session holds (`Session.stepNotes`, set through `notes.update`), one labelled part
per phase that has text. It appears only when it changed since the interviewer's previous envelope, and the models
treat it like words he said. A "check this step" request leaves the notes out of its context and carries that step's
text in its own `<notes>` block, then the checker's reading of the step (section 5.11), then the pin targets list.

Other engine turns use their own tags: `<start>` opens the round (the interviewer answers with the brief's
opening prompt), `<request>` carries a guided "check this step", "hint" or "I'm stuck" and the coach's opening, and
`<replay>` restarts a conversation after a failure with the transcript so far, saying the round is already open.

Clock events are sent as their own turn:

```
<clock>
time: 12:00 of 45:00 · phase: requirements (planned 0:00–5:00) · candidate's last message: 2:10 ago
Say one short line only if a real interviewer would speak now. Otherwise reply with exactly <silent/>.
</clock>
```

A reply that is exactly `<silent/>` (after trimming) is not shown and not stored. Any `<silent/>` inside a
longer reply is stripped.

### 5.5 Clock and checkpoints

Round time = wall time since `startedAt` minus `pausedMs` (and minus the current pause). The browser renders
the countdown locally from `PublicSession.clock`; the server sends a fresh `session.state` on every pause,
resume and phase change.

A round pauses in four ways, and `Session.pauseReason` records which:
- `user`: the user pressed Pause (`session.pause`, interview and guided rounds alike).
- `away`: the round was `live` and had no open socket for `AWAY_PAUSE_MS` (60 seconds). A socket that attaches inside
  the window cancels the timer. A socket that attaches later finds the round paused and does not resume it; the user
  does, with `session.resume`. If the interviewer is mid-reply when the window ends, that reply finishes and is
  stored first, and the pause follows it. A round that is opened with no socket (the browser closed right after
  starting it) is held to the same window.
- `error`: a model error (section 5.6).
- `restart`: the server started while the round was `live` (section 5.6).

Pausing sets status `paused`, `pauseStartedAt` and `pauseReason`, stops the clock and holds every checkpoint below;
`session.resume` adds the pause to `pausedMs`, clears `pauseReason`, sets status `live` and re-arms the checkpoints. A
paused round refuses chat, hints and step checks until it is resumed. Both the user and the away pause leave a hidden
note for the interviewer's next message, and so does a step move by the candidate. The notes are kept in
`Session.pendingEvents`, saved with the session, left out of the browser's copy, and cleared once the interviewer
has them, so a restart keeps them. A paused round that holds notes is not dropped from memory. `pauseReason` is `null` whenever the status is not `paused`. Pausing closes the
idle interviewer conversation process rather than keeping the subprocess alive; on resume, a new conversation instance
resumes from `session.sdk.interviewerSessionId`.

Checkpoints (each fires at most once, only while status is `live`, never while the interviewer is mid-reply;
if it is mid-reply, fire right after):
- Every phase end time from `phasePlan` while the candidate is still in that phase: a `<clock>` nudge event.
- Extension point (HLD: duration − 10 min; LLD: duration − 15 min): a `<clock>` event telling the
  interviewer to deliver the extension now in one short message, choosing from the brief's Curveballs or
  Extensions section. Store it as `session.extension`.
- Five minutes left: a `<clock>` event; the interviewer may warn the candidate in one line.
- Silence (both modes): when the candidate has sent nothing, and the board, the code and the step notes have not
  changed, for a window (`SILENCE_WINDOW_MS` in `src/server/engine/clock.ts`: HLD 4 minutes in an interview and 6 in
  a guided round, LLD 8 and 10, because quiet coding is normal), a `<clock>` event asks for one short check-in line
  with no hint. A message, typing or dictating in the chat box (`chat.composing`), a board, code or notes edit, a
  code run, a guided button, a step move and a resume each start a new quiet stretch, and so does a shown interviewer
  line other than the check-in itself; a server start counts as activity too. Each stretch gets at most one
  check-in, marked once its turn has gone through. The runtime keeps one pending silence checkpoint and reads
  activity when it falls: if the round was not quiet for the whole window, it re-arms at the end of the new window.
  It is armed a minute away from the other pending clock events of the current step and of the round, so the two
  rarely speak back to back. A check-in that falls while the interviewer is mid-reply waits for the reply, and is
  dropped when that reply was shown; one that falls while nobody is in the room is dropped, and it comes about five
  seconds after someone is back.
- Time up: status becomes `ended`; the interviewer gets a `<clock>` event to close in one or two sentences
  with no feedback, or `<silent/>` when its last reply already closed the round; then the debrief starts. The page sends its last board and code edits as the clock reaches
  zero, so for 2 seconds after a time-up end the server still takes `board.update` and `code.update`, and the
  debrief waits for the window to close. After it, and after any other end, both are refused with `not_live`.

Guided mode has no extension checkpoint and no time-up end: the clock counts up and the candidate ends it. It keeps
the `phase_end` checkpoint of every step except the last (`planCheckpoints` in `src/server/engine/clock.ts`), and one
`overtime` checkpoint at the planned length: the guide says in one line that the planned time is reached and leaves
the choice to finish the step or end the round; it is never `<silent/>`. A hidden clock note records it, so a line a
restart cut off still comes, and a move-on offer that falls within a minute of it is dropped. It adds
one `phase_over` offer, which depends on time in the step and not on the round clock. The offer for a step falls when
his total time in that step, summed over every visit from `phaseHistory` with pauses left out, reaches twice the step's
planned minutes (`phaseOverCheckpoint` and `timeInPhase`). When he enters a step that has not had its offer, the
runtime schedules it at now plus twice the plan minus the time already spent there, on the same scheduler as the other
checkpoints. When he leaves, the pending offer is dropped, and it is scheduled again on his return. Each step gets at
most one offer per round: a hidden clock note in the transcript records it, so a restart does not repeat it. The last
step has no next step and gets none. The `phase_over` turn asks the guide for one short line that offers to move on;
it is never `<silent/>`. A step that has already passed gets no offer, because the "Move on" button is there.

### 5.6 Failure handling

- Any model error during a live round (rate limit, network, process exit): status `paused` with `pauseReason:
  "error"` (the clock stops), `agent.status` with `state: "error"` and a plain message; the browser shows a banner
  with "Retry". Retry =
  `session.resume`: re-create the streaming query with `resume: <sdkSessionId>`; if that fails, start a new
  query whose first user message replays the transcript so far (compact form) and says the round continues.
- On server start, any session still `live` becomes `paused` with `pauseReason: "restart"` and `pauseStartedAt` = its
  last saved time. A session file written before `pauseReason` existed loads with `null`, or with `"restart"` when
  its status is `paused`; a stray reason on a session that is not paused is dropped on load.
- `session.json` is written atomically (temp file + rename) after every transcript entry, phase change,
  status change and scorecard.
- The app-owned transcript is the source of truth. The SDK session is a cache.

### 5.7 Debrief pipeline

On end: status `debriefing`, `debrief.progress` updates, then:
1. **Collect.** Request a final PNG (`board.png.request`; store `board-final.png`). Freeze the code file
   (copy to the session folder as `final.cpp`).
2. **Test (LLD).** Run the tester with the brief's "Demo scenarios". It reads the code, writes one harness,
   runs it with `run_harness`, fixes its own harness errors up to 3 times, and returns scenario results. A
   failed scenario may carry `cause`, a few words on its root cause, with the same text on every scenario that fails
   for the same bug; the server drops a cause on a passing scenario or one with no word in it, joins its lines and cuts it to 160 characters, and gives every failed scenario without a cause "Did not compile" when the file did not compile. The scorecard's `lldScenarios` are the tester's results, or empty when the tester did not run. A
   compile failure of the candidate's own file is a valid result (`compiled: false`), not an error.
3. **Judge.** One structured call. User message contains: the transcript (each line `[mm:ss] role: text`,
   hidden system entries included as `[mm:ss] (event) ...`), phase timing (planned vs actual), hints given,
   the extension, any written step text (`<notes>`), `<step_windows>` (each step id he visited with its
   `mm:ss–mm:ss` spans from `phaseHistory`, so the judge can tell which lines belong to which step), the final graph text, the PNG as an image block, LLD final code with line numbers and the
   tester results. Validate with `ScorecardSchema`. Besides the dimensions, the judge returns `steps`: per step
   he reached, `took` (one to five points, each a plain sentence, the rubric dimension it moved and an exact
   evidence quote from that step) and `missing` (what the target level answer had in that step that his did not). The
   step readings agree with the dimension scores and add no new scoring. The judge also pins up to eight board
   elements with `pin_element` (held or gap). Each judge attempt collects its own pins, and the pins of the scorecard
   that is kept replace any earlier judge pins in `Session.pins`.
4. **Check.** Quote check (section 9.2) over the dimension quotes and the step quotes (`stepQuoteChecks`, keyed
   by step id and index); written step text counts as the candidate's own words. Steps whose id is not a phase of
   the track are dropped, a repeated step keeps its first entry, and steps are sorted into phase order. A card with
   more than five gaps (`MAX_GAPS`) drops the least severe, the last of the lowest severity first, and the kept gaps
   stay in the judge's order; a saved scorecard with more gaps loads unchanged. A saved scorecard without `steps` loads with an empty list. If more than 30% of quotes fail, run the judge once more with a note
   listing the failed quotes; keep the better result. Lint the prose fields (`verdict.summary`, gaps,
   strengths) with `lintProse`; store issues in `lintIssues` (shown only in a small dev note).
5. **Readiness (guided rounds only).** The server computes `scorecard.readiness = { call: "ready"|"not_yet", reasons[] }`
   with a fixed rule (`computeReadiness` in `src/server/engine/readiness.ts`), never the model. Each failed condition adds
   one plain sentence: the steps that have no `pass` in `Session.stepVerdicts` (named by their labels); the steps in
   `Session.assists` (named by label); any hint at level 3 ("3 hints, including 1 at level 3."); and an active time
   (end minus start minus pauses) above 1.5 times the round's planned duration ("The round took 80 minutes against a
   45-minute plan."). The call is `ready` only when there are no reasons. The judge, the dimension scores, the gaps, the
   coach and the tracker mark (`[~]`) work as before, and `verdict.sde2` stays in the data, but the page shows no hire
   verdict for a guided round that has a readiness call. `GET /api/sessions` and the Library list carry `readiness.call`
   for the badge. Sessions saved before the field existed have none and show their verdict.
6. Add `phaseTiming` and `quoteChecks`, save, status `debriefed`, send `debrief.ready` and a fresh
   `session.state` (which now includes `reference`).
7. On repeated failure: status `failed`, keep everything, offer `debrief.retry`.

### 5.8 Coach and bookkeeping

- The coach waits for the candidate, because an opening nobody reads still costs a model turn. It starts when they
  press "Start with the coach" in the empty coach panel (`coach.open`, which sends the opening once and only while the
  chat has no coach or candidate line; after a failed opening, a second press runs it again), press "Teach me this" or
  send a first message (which replaces an opening still queued from a failed press). A coach message that a restart cut
  off before its reply is answered when the round loads. Its first reply is the opening,
  written from the scorecard (summary in two or three sentences, then "let's start with" the gap the first message
  names, or the top gap), following TEACHING.md section 2 and the problem
  session step 6 (teach each gap directly, about ten minutes each). While
  the room has no connected sockets, the idle coach conversation process is closed after one minute and resumes
  from `session.sdk.coachSessionId` when activity continues.
- A gap round marks its source gap practised. Each scorecard gap may carry `step`, the step its answer is about (the
  judge's tag, kept only when it names a step of the track) or the step its `drill` trains (`requirements`
  to Requirements or Clarify, `walk` to High-level design, `capacity`, `deep_dive` and `tradeoff` to Deep dives on
  system design, `lld_skeleton` to Skeleton) when the two agree or only one is known. A gap whose tag and drill
  disagree, a gap about how the round was run (`aboutTheRound`), and a gap with no tag whose drill trains no single
  step (a machine coding `tradeoff`) have no step and are never marked. On system design a Deep dives gap is marked
  by any passed deep dive, because that step passes on one. When the gap
  round's guide records a pass on that step and the round holds no "I'm stuck" assist on it, the server sets
  `Session.gapPractice[title] = { sessionId, at }` on the source round, through its open room when one holds it and
  saved at once. An "I'm stuck" on that step after the pass, or a discard of the gap round, clears the entry, and
  only the gap round that set an entry can clear it. The first gap round that practised a gap keeps the link; when its
  entry is cleared, another gap round on that gap that still meets the rule takes it over. A gap round that opens
  and still meets the rule writes its entry again, and a source round that opens drops an entry whose gap round no
  longer exists. Writes to one source run one at a time. The field is optional,
  sessions saved before it load without it, and it is kept apart from `gapProgress`, so the coach's records and the
  chat reading of older rounds never change.
- The coach records its place on each scorecard gap in `Session.gapProgress`, keyed by the exact gap title:
  `{ by: "coach" | "candidate", state: "started" | "taught" | "core_only", at }`. `by` is who first opened the gap
  and never changes. Sessions saved before the field existed load with `{}` and are not backfilled. `session.state`
  carries it, so the debrief page reads it directly.
- The `set_gap` tool takes `{ title, state }`. The title is capped at 300 characters and, after trimming, must equal
  one `scorecard.gaps[].title`; any other title, an unknown state or an extra field returns a short tool error and
  changes nothing. The coach calls it with `started` in the same turn it opens a gap, whether it moved on itself or
  he clicked "Teach me this"; with `taught` once his answer to its check holds; and with `core_only` when he chose
  the core idea now and the rest as a topic session later.
- A coach message that equals `teachMessage(gap)` exactly after trimming (`Teach me this gap: <title>`, one function
  in `src/shared/gaps.ts` used by the server and the browser) records that gap as `by: "candidate"`,
  `state: "started"` when it has no record. An existing record is left alone. The coach is told to carry on from
  where it is when the message names the gap it is already teaching, and to switch to the named gap otherwise.
- When a gap becomes the current one (`set_gap` with `started`, or the button message) and it is not already the
  most recently announced gap, the room appends a system line `Now on: <title>` (kind `gap`) to the coach channel.
  It is saved in the transcript, shown as a divider in the coach chat like the interview's "Moved to ..." lines, and
  never sent to the model as a candidate message.
- A gap estimated at over about ten minutes starts with a question from the coach: the full lesson now, or the core
  idea now and the rest as a topic session later. For the second choice the coach teaches the core idea, says plainly
  that it is the core idea only and what the topic session will cover, records `core_only`, and says the notes draft
  will add it to his tracker.
- The scribe input also carries any written step text, any step notepads a session holds (labelled as a summary to
  check against the transcript), and the step checklist with what was covered and where. The draft and its result are recorded on
  `Session.studyNotes` (proposal id, status, number of saved changes, save time), so a reload and the History page
  still show whether the notes were saved.
- "Draft study notes" runs the scribe (section 10) and sends `bookkeeping.proposal`. The user ticks ops and
  clicks Save: `bookkeeping.apply`.

### 5.9 FakeDriver (`SPARMATE_FAKE_AGENT=1`)

Same interface as the Claude driver, no network, deterministic, fast (stream a reply in a few chunks over
about 300 ms):
- interviewer/guide: first reply is the brief's "Opening prompt"; later replies are short phase-aware lines;
  answers `<silent/>` to most clock events, with a check-in line on silence and a planned-length line in guided
  mode; delivers a canned extension at the extension checkpoint; calls
  `set_phase` when the candidate's message contains "let's move to <phase label>".
- tester: three scenarios, one pass and two fails that share one cause (all three fail, with the cause "Did not compile", when the code does not compile).
- judge: a valid scorecard whose quotes are copied from real candidate lines (so quote checks pass), plus one
  deliberately invented quote (so the UI shows a failed check).
- coach: canned two-paragraph replies. The opening calls `set_gap` on the top gap and `read_transcript`, and says how many lines of the round it read.
- scribe: ops built from the session (a tracker mark update for the problem's bullet, a session log row, a
  review entry, a notes file create or append).
- brief-writer: copies the URL shortener fixture with a new id and title.
- checker: reads whole words only. An item is `covered` when one of his lines, a frame label, a code line or a line of
  his written answer holds at least half of the item's words, `partial` when it holds fewer, and it quotes that text
  exactly, cut at a word boundary. It also claims one
  more item with a quote he never said, so every run exercises the server's quote check.
- guide: on "Check this step" it calls `pin_note` with an id that is not on the board (refused), then pins the first
  labelled box, and calls `step_verdict` (`not_yet` with a gap on the first check of a step, `pass` on the next, and
  `not_yet` again when the server refuses that pass). An
  "I'm stuck" request gets a short model answer. judge: pins the first labelled element as held and the second as gap.

Keep the FakeDriver in its own file so the Claude driver has no test-only branches.

### 5.10 Library list and recommendation

`GET /api/problems` builds `ProblemSummary[]` from `content/problems/**` plus `DATA_DIR/custom-problems/`,
tracker marks (section 10.1) and app history:
- `badge: "redo"` when the mark is `[~]` and the latest attempt (app history, dated by the day it ended, or the day
  it began when it has no end time) is 7 or more days old, or there
  is no app attempt and the tracker bullet's newest date suffix is 7 or more days old.
- `badge: "next"` on exactly one problem: the first `[ ]` problem, in tracker order, in the track opposite to
  the most recent session's track (app history first, else the last Session Log row: "B3" means LLD, "C2"
  means HLD). Tracker order = the order of bullets in the section.
- `summary`: the first sentence of the problem's "Opening prompt", which the candidate hears anyway. Nothing from
  a hidden section is used.

### 5.10a Today's session

`selectToday` in `src/shared/today.ts` is a pure function of the clock, the weekly plan (`Settings.weeklyPlan`, Monday
first), the problem list and the history. It answers with the day's kind, one hero, the other unfinished rounds and the
redo queue. The order of its rules:

1. A round paused within the last 24 hours (or still marked live) is the hero on any day, including a rest day. The
   primary action is Finish. When several qualify, the newest wins and the rest go to the Unfinished card.
2. A rest day shows a calm rest hero. A DSA day shows "Solve on LeetCode" with a link to `https://leetcode.com/problemset/`
   and, when a scored round has a gap the coach has not finished, a 20-minute gap round on the newest such gap.
3. On an HLD or LLD day the order is: a due redo of that track, then an unfinished (older than 24 hours) round of that
   track, then the next new problem of that track. The next new problem is the server's recommendation when it is on
   the track, else the first `[ ]` non-custom problem of the track in list order (the list order follows the tracker).
   With nothing on that track it falls back to the other track.
4. On a redo day the oldest due redo of any track leads. With none due, the hero is a new problem on the track with
   fewer rounds in the last 14 days.
5. A problem with an open round is never offered as a redo or as a new problem. Its round is the way back to it, and
   a redo of that problem waits until the round ends.
6. An unfinished round with less than 5 minutes of clock used offers Discard in place of End and debrief.
7. The mode is guided when the last attempt at the problem was a guided round with readiness `not_yet`, else interview.

The hero's warning line comes from `largestOverrun`: the one step of the last scorecard's phase timing that ran at
least 3 minutes and 1.5 times over its plan. With no such step the line is left out.

`src/shared/progress.ts` holds the Progress derivations: the focus skill (lowest average score over the newest three
scored interview rounds, or guided rounds when there is no interview round), the per-skill rows for each mode, and the
week's counts. A round counts on the local day it ended (its creation day when it has no end time), the same day the
week strip on Today uses, so a round that began on a Sunday and ended on a Tuesday belongs to the week of the Tuesday.
A finished round on a problem tried before counts as a redo on Progress ("Redos"), and the strip still marks a track
day done by any finished round of that track, so a redo of an HLD problem on an HLD day is both.

### 5.11 HTTP and WebSocket (ENGINE agent)

REST endpoints (JSON):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/bootstrap` | `BootstrapResponse`. Same-origin only (no CORS headers anywhere). |
| GET | `/api/problems` | `ProblemSummary[]` |
| POST | `/api/custom-problems` | `PrepareCustomProblemRequest` (`{ prompt, track }`) -> `{ jobId }`. Starts async research and verification job. 409 conflict if a job is in-flight. Preparation has an 8-minute time limit after which the job is aborted and marked failed. |
| GET | `/api/custom-problems/:jobId` | `CustomProblemJobStatus` (`{ id, stage, searches, pages, problemId?, title?, track?, sourcesCount?, checksCount?, corrections?, confidence?, costUsd?, error? }`). `stage` is `researching`, `writing`, `checking`, `ready`, `failed` or `cancelled`. |
| DELETE | `/api/custom-problems/:jobId` | Cancels a running custom problem preparation job, aborts its model process, and marks the job `cancelled`. Same Host, Origin and CSRF checks as other writes. Answers the updated status, or 404 if not found. |
| POST | `/api/sessions` | `CreateSessionRequest` -> `{ sessionId }`. Custom prompt runs the brief-writer first (can take a minute). LLD creates the attempt file. A `focus` (gap title and "what good looks like") is allowed only with `problemId` and mode `guided`; it starts a 20-minute guided round and is kept on the session. The focus may name its `sourceSessionId`: when that id has the session id format, names a round of the same problem with a scorecard, and that scorecard holds a gap with exactly this title, the session keeps `focus.source = { sessionId, gapTitle, step }`; otherwise the round starts with no link. |
| GET | `/api/sessions` | history: `SessionHistoryItem[]` (`{ id, problemId, title, track, mode, createdAt, status, verdict, readiness, pause, notesSaved, clock, scores, phaseTiming, gaps }`), newest first. `pause` is `{ reason, pausedAt, timeLeftMs }` while paused (`timeLeftMs` is null in a guided round), else null. `notesSaved` is true once study notes were written, and stays true when a new draft starts (`notesWereSaved`). `clock` is the raw round clock (`startedAt`, `pausedMs`, `pauseStartedAt`, `durationMs`). A scored round also carries `scores` (`{ id, name, score }[]`), `phaseTiming` and `gaps` (`{ title, goodLooksLike, severity, done }[]`), so the pages need no per-round fetch. Every field after `notesSaved` is optional, and a round saved by an older version loads without them. |
| GET | `/api/sessions/:id` | `PublicSession` |
| POST | `/api/sessions/:id/end` | Ends a live or paused round that nobody has open and starts its debrief. Answers `{ ok: true }`. `404` for an id that fails the id regex or a round that does not exist; `409` when the round already ended. Same Host, Origin and CSRF checks as every other write. |
| DELETE | `/api/sessions/:id` | Discard the round (below). Answers `{ ok: true }`. `404` for an id that fails the id regex or a round that does not exist; `409` while the status is `debriefing`. Same Host, Origin and CSRF checks as every other write. |
| GET | `/api/sessions/:id/board` | `{ version, elements }` |
| GET | `/api/sessions/:id/board-final.png` | image |
| GET | `/api/sessions/:id/code` | `{ version, content, path }` (LLD) |
| GET | `/api/settings`, PUT `/api/settings` | `Settings` (strict zod schema: unknown keys are rejected). Besides models, effort, durations and theme it holds `weeklyPlan` (7 entries, Monday first, each `hld`, `lld`, `dsa`, `redo` or `rest`; default `dsa, hld, dsa, hld, dsa, lld, redo`), `leetcodeUsername` (optional, 1 to 40 of letters, digits, `_` and `-`), `dsaCountFrom` (optional local day `YYYY-MM-DD`; a real day, not in the future; the server sets today when a username is saved without one) and `dsaWeeklyGoal` (integer 1 to 30, default 3). A settings file saved before these keys loads with the defaults. |
| GET | `/api/dsa` | `DsaResponse`: `username`, `status` (`ok`, `stale`, `no_username`, `not_found` or `error`), `fetchedAt`, `countFrom`, `pass` (distinct problems solved since `countFrom`: `solved`, `easy`, `medium`, `hard`, and `unread` for problems whose difficulty is not known, so the four add up), `topics` (`{ name, slug, solved }`, most solved first, from the ledger), `week` (`solved`, `mediums`, `perDay` with 7 entries, Monday first, local time), `recent` (up to 10 `{ title, slug, difficulty, solvedAt }`, newest first, `difficulty` null until read), `lifetimeSolved` (everything on the account, earlier years included; shown only as one quiet line in the side panel) `weeklyGoal`, `failure` (`{ reason, at }` with `timeout`, `unreachable`, `unexpected_reply`, `busy` or `not_found`; set when the numbers are stale or missing) and `nextReadAt` (before this time a read-again returns the saved numbers). A name that stops resolving after a good read gives `stale` with reason `not_found` and the saved numbers. It reads LeetCode when the last read is at least 15 minutes old. |
| POST | `/api/dsa/refresh` | The same answer after a "read again". The 15-minute wait still applies; after a failed read the wait is 15 seconds instead of 2 minutes. Same Host, Origin and CSRF checks as every write. |
| GET | `/api/usage` | `UsageResponse`: overall totals (with `drillCost`, the part of the cost that drill grading spent) and breakdowns (by session, problem, role, model, day for last 30 days), cache hit rate, and `trackingSince`. Each problem row also has `roundCost` and `drillCost`, which add up to `cost`. `totals.rounds` and each problem's `rounds` count only rounds with calls in the ledger that are still saved; `totals.discardedRounds` counts rounds that spent calls and were discarded, their cost stays in every total, and a `bySession` row of such a round has `discarded: true`. `unassigned` holds `preparation` (the brief-writer and brief-checker calls of custom questions, which belong to no problem) and `other` (any other call without a problem), each a problem-shaped row or null, so the rows by problem plus these add up to the total. `drills` holds `cost`, `calls`, `failedCalls`, `attempts` (graded attempts that are still on record), `unfinished` (`{ attempts, cost, calls }` for drills with calls that never became a graded attempt on record, because the user started them over, the grade failed, or they are still open: their cost stays in `cost`, and they are in neither `attempts`, `byKind.attempts` nor `byAttempt`), `legacyAttempts` (attempts saved before calls were recorded per attempt, which have no cost row), `byKind` (`{ kind, cost, calls, attempts }`, highest cost first; `kind` null for rows written before kinds were recorded), `byAttempt` (`{ attemptId, kind, problemId, problemTitle, date, cost, calls, failedCalls, durationMs }`, newest first, at most 200) and `earlier` (`{ cost, calls }` for grader calls recorded before attempts had ids). A drill call is a row with role `grader` or with a drill attempt id; its `drillAttemptId` (16 lower-case hex characters) and `drillKind` (1 to 40 lower-case letters and underscores) are read from the ledger only when they match, otherwise null. |
| GET | `/api/gym` | `GymSummary`: the drill queue (each row names the problem of its next attempt, the title of its changed constraint or null, and the problem of the round that showed the gap), due count, usable problems and week stats. It also holds `closed` (closed drills as `{ id, gapTitle, drill, title, originProblemTitle, closedOn }`, newest first, at most 50; `closedOn` is the day the drill closed) and `points` (see "Drills feed Progress", oldest first). |
| GET | `/api/gym/drills/:drillId` | `DrillDetail` for one queued drill: `today` and `item` (`id`, `drill`, `title`, `gapTitle`, `status`, `passes`, `dueOn`, `originProblemTitle`, `problemId`, `problemTitle` and `variantTitle` of the next attempt, and `proofs`, the problems and changed constraints that earned an Interview-ready result, as readable labels), then `attempts`, the finished attempts that counted for the drill, newest first. An attempt row holds `id`, `at`, `problemTitle`, `variantTitle`, `outcome`, `firstOutcome`, `revised`, `scores` (`{ id, label, core, score }` in the order of the rubric; a score for a criterion the rubric no longer has is left out), `seconds`, `costUsd` (the sum of its grader calls in the usage ledger, or null when the ledger has none) and `legacy`. 400 when the id is not 16 lower-case hex characters; 404 for an id that is not in the schedule. An open attempt is never listed. |
| GET | `/api/gym/attempts?limit=` | The newest finished attempts of every kind, free drills included, as the same row plus `drill`, `title` and `drillId` (null for a free drill). `limit` is a whole number from 1 to 100 and defaults to 30. The query is strict: an unknown key, a repeated key or a value that is not a whole number in range is a 400, and a value is never clamped. |
| GET | `/api/gym/attempts/:attemptId` | `AttemptView` for display: `task`, `changed` (or null), `answers`, `turns` and `grades` (`outcome`, labelled `scores`, `wentWell`, `improve`, `yourLine`). A grade holds `strong`, the line on what a strong answer says, only when no open queued drill of the same kind exists, because that drill would ask the candidate the same question again, and only when the attempt can no longer be revised; otherwise the field is absent. A strong line that copies six or more words in a row from the key is saved empty and never shown; when the field would be returned, the grade holds `noStrong: true` instead, and the page says "No line was saved for this attempt." The answer key and the text of the brief are never returned. 400 for a bad id; 404 for an unknown attempt, an open attempt, a legacy attempt (it has no body) and an attempt whose body file is missing. |
| POST | `/api/gym/prompt` | `DrillPrompt` for `{ drill, problemId, drillId? }`. For a dialogue drill with an open attempt of today for the same kind, problem, changed constraint and queued drill, it also holds `open: { attemptId, turns: { role, text }[], asked, of }`. For a queued drill that is not due yet it holds `early: { dueOn, today }` (today is the server's day), because such an attempt is graded but moves no schedule. 404 for a problem never played or a queued drill that is not open; 400 for a drill that does not fit the track; 409 when `drillId` names a drill whose next attempt is on another problem ("This drill moved to another problem. Open it again from Practice."). |
| POST | `/api/gym/submit` | For `{ drill, problemId, drillId?, variant?, answer, elapsedSeconds? }`: a written drill answers `{ kind: "result", ...DrillResult }`; a dialogue drill answers `{ kind: "question", attemptId, question, asked: 1, of: 2 }`. 409 for a queued drill whose next attempt is on another problem, while the drill is being graded, and for a dialogue drill that already has an answer in progress ("This drill already has an answer in progress."); 502 when the grader fails. |
| POST | `/api/gym/reply` | `{ kind: "question", ... }` or `{ kind: "result", ...DrillResult }` for `{ attemptId, answer, elapsedSeconds? }` (strict body, answer 1 to 8000 characters): the candidate's reply to the interviewer. 404 for an unknown attempt or a drill that left the queue; 409 for an attempt that is not an open dialogue of today, for a queued drill whose pick moved, and while a reply is being graded; 502 when the grader fails, with the attempt left as it was so the reply can be sent again. |
| POST | `/api/gym/abandon` | `{ ok: true }` for `{ attemptId }` (strict body): removes an open dialogue attempt and its body file so the drill can start over. It changes no schedule. 404 for an unknown attempt; 409 for an attempt that is done, written or being graded. |
| POST | `/api/gym/revise` | `DrillResult` for `{ attemptId, answer, elapsedSeconds? }`: one revision of a finished attempt. 404 for an unknown attempt; 409 when it is legacy, a dialogue drill, already revised, already Interview-ready, from another day or being graded; 502 when the grader fails. |
| GET | `/api/sessions/:id/usage` | `SessionUsageResponse`: round totals and per-role breakdown. |
| GET | `/api/tts/status` | `{ available: boolean }` |
| POST | `/api/tts` | `{ text, voice, speed }` (zod strict) -> `audio/wav` bytes, `Cache-Control: no-store`. Queued requests whose HTTP client disconnects are dropped. The Kokoro worker idles out and stops after 3 minutes without requests. |

WebSocket: `GET /ws/session/:id` upgrade. Check Origin and Host before accepting. First message must be
`hello` with the CSRF token within 5 seconds. Then the server sends `session.state` and streams. Every client
message is parsed with `ClientMsgSchema`; an invalid message gets an `error` and the socket closes. Per-socket
rate cap `LIMITS.messagesPerSecond`. Server heartbeat sends a ping every 20 seconds; dropping a socket that misses
two pongs triggers detach and allows the away-pause timer to see the room as empty. Several sockets on one session
(two tabs) all receive broadcasts.

Behaviour of client messages:
- `chat.send` (interview channel): append the candidate entry, send `chat.message` with `clientMsgId` (the
  browser replaces its optimistic copy), queue the envelope for the interviewer or guide. While the model is
  replying, later messages wait in order. Coach channel goes to the coach.
- `board.update`: if `version` is newer than the stored one, store `board.json`, rebuild the graph (after the frame
  membership pass of section 7.2), store `graphText` in the session, broadcast `board.graph` to other sockets. Mark
  "changed since the interviewer last looked".
- `board.png.result`: resolves a pending PNG request by `requestId`.
- `notes.update` (`{ phase, text, version }`): `phase` must belong to the session's track (else a `bad_phase`
  error); `text` is at most 8,000 characters (a longer one is an invalid message). While the round is live or
  paused and `version` is higher than `Session.stepNotesVersion`, store the text under that phase, save it (debounced
  like the board) and send `notes.changed { phase, text, version }` to the other sockets. Older versions are
  ignored. `session.state` always carries `stepNotes` and `stepNotesVersion`.

**Step checker.** Every step has a checklist (`Session.checklist`), derived when the session is created from the
problem brief by `deriveChecklist` (`src/shared/checklist.ts`): HLD requirements from the numbered lines of "Expected
requirements", core entities from the "Core entities:" bullets of "API and entities", API from the other bullets of
that section (endpoints and messages), design from the "Walk one ..." lines of "Reference design", and deep dives from
the `###` headings of "Deep dives" plus one fixed item for the curveball that does not name it. "Capacity math" is the
answer key for numbers in the deep dives and adds no items. LLD: clarify from "Expected
requirements", entities from the code-span names of "Entities and relationships", behaviour from "Behaviour and states",
thin slice from the first demo scenario and fill out from the rest; skeleton and extension have fixed items. A step whose
sections yield nothing gets its goal as the one item. Item ids are `<phase>-<n>`. Every shipped brief gives each step
read from its sections (`BRIEF_STEPS`) at least two items, so an HLD brief has two or more "Walk one ..." lines;
a unit test enforces it in `npm run verify`, and `scripts/check-problems.ts` reports it per file.

"Expected requirements" holds a short Core and Extras. HLD briefs have a `Core, functional:` line with about three
numbered items and a `Core, non-functional:` line with three to five; LLD briefs have one `Core:` line with five or six.
Each Core item ends with `*Ask: <question>*`, the question that uncovers it without stating the answer; the parser strips
it from the label and keeps it as the item's `ask`. Extras are `- ` bullets under `Extras (credit when he names one,
never a gap):`, so they never become checklist items. The Core matches what a real round pins down in about five
minutes, and it is what the guide checks the requirements step against.

The checker role reads one step against its checklist. It runs:
- at once for the step he leaves, and for the current step when the round ends;
- in a guided round, for the current step when he asks for a step check (`guided.feedback`), before the guide answers
  (below);
- in a guided round, for any step the guide names in a `recheck_step` call;
- in a guided round, for a step the guide calls `pass` on, when its evidence changed since the last reading.
It never runs while he talks, draws or types code in a step. A list that ticks as he works acts as a hint, and one
reading per step is all the debrief and the study notes need.
A step where he said nothing, drew nothing in its frame, wrote no answer for it and (LLD) has no step code is skipped, so a step he only passes
through runs no check. A check asked for while one runs for the same step becomes one follow-up with the newest
evidence, and a caller that waits for the check also waits for that follow-up. A check whose evidence (his chat lines,
the frame text, the step's code, his written answer) did not change since the last finished check is skipped, unless an image is due.

A re-read (`recheck_step`) reads the step from scratch. It runs even when the evidence did not change, it attaches the
frame image when the frame has content, and its result replaces the step's items instead of adding to them. When the
step has no evidence at all, the re-read makes no model call: the step becomes `done` with no items and `checkedAt` set
to now. Only a re-read takes a tick away.

**Step code (LLD).** `codeScopeFor` in `src/shared/stepCode.ts` gives each step its code. The design steps (clarify,
entities, behaviour) read only the code he wrote while that step was on the rail. The build steps (skeleton, thin slice,
fill out, extension) read the whole file. On every change to the attempt file while the round is live or paused, from
the editor (`code.update`) or from outside (the file watcher), the server takes the trimmed text of each non-blank line
that the previous content did not hold (`newLines`). When the rail is on a design step, it adds those lines to
`Session.stepCode[phase]` and drops from that list the lines that are no longer in the file, so half-typed fragments do
not pile up. Each list keeps at most 5,000 lines, newest last, and is saved with the session. A design step's code is
every line of the current file whose trimmed text is in its list, with its line number in the file (`stepCodeText`).
`stepCode` stays on the server: `session.state` leaves it out. When a live or paused LLD session loads without
`stepCode`, every non-blank line of its file is credited to the clarify step, because the method writes the clarify
answer at the top of the file before any other code.

Its input is the step's label, goal and checklist, the step's interview chat (every visit, by round time from
`phaseHistory`; hidden and phase-change entries left out), the frame text (`frameEvidence` in
`src/shared/graph/frames.ts`: the frame's nodes, free text and drawings, and every edge with an end in the frame, from a
graph of the whole scene so an arrow to another frame still counts as joined), and in an LLD round the step's code
(each line with its number in the file, capped at 60,000 characters), and his written answer for the step
(`Session.stepNotes[phase]`) when he wrote one. An HLD board with no step frames is read whole for
every step. A PNG of the step's frame (`board.png.request` with `frameId`) is attached only when the frame holds
freehand strokes or images, an arrow not joined at both ends, or a shape with no label, once when he leaves the step,
and on a re-read when the frame has content. The judge still gets the whole board image.

The answer is untrusted. For each item claimed `covered` or `partial`, the quote must be found (the quote-check
folding of section 9.2) in one of his own chat lines of the step (the line's round time becomes "said at mm:ss"), in
the frame text, in the step's code without its line numbers, or in his written answer for the step (source `notes`). A board claim with an empty quote counts only when the
image was attached. Anything else is dropped. Across the automatic checks, coverage only rises: a covered item keeps
where it was first covered. The entry in `Session.stepChecks[phase]` becomes `checking` while a call runs, then `done`
(with `checkedAt` and `usedImage`) or back to its earlier state, and each change is sent as `session.state`. A
`checking` entry loaded from disk becomes `done` when it had a finished check, else `failed`. The call is recorded on
the usage ledger as role `checker`. Only the guide's step feedback waits for it; nothing else in the round does.

**"Check this step" order.** On `guided.feedback` the server starts the check of the current step, then queues the
guide's request turn at once, so the turn keeps its place among his messages. The interview channel waits for the
check to settle before it builds that turn, for at most 30 s; after that it goes ahead with the last finished check.
While it waits, the channel reports `agent.status` `thinking`, the state in which the page disables its buttons. A pause
during the wait leaves the turn queued until he resumes; an end or a discard drops it. The request body carries the
step's checklist as the checker last read it, after a line that gives the round time of that reading: one line per item
with its id, label, state, where it was found (said at mm:ss, on the board, in the code, in the written answer) and what
a partial item lacks. It tells the guide that the list is evidence that may lag his latest work, how many items a pass
needs, and that the server refuses a pass the reading does not support. The request tells the guide to call `step_verdict` for the step before it writes the verdict, with one gap on
`not_yet` (only a count once the step's checks give only a count), and to call it again with `not_yet` when the server
refuses a pass. When no check of
the step has finished, the body says so instead.

`session.state` carries the checklist as `steps` (`publicSteps` in `src/server/engine/public.ts`), never `checklist` or
`stepChecks`. A debrief gets every item with its label, state and where it was covered. Every live round, guided or
interview, gets an empty `steps` until the round ends, because the list comes from the hidden brief and even a count of
covered items tells him whether a step is done. A guided round shows him the guide's `stepVerdicts` instead (a
count-only "not yet" says how many items are open only after two named gaps on that step), and an
`assistCount` (how many times he asked for a model answer; the steps stay on the server until the debrief). `pins`
follows the checklist rule: none in an interview round, the guide's in a guided round, all of them once the round is
over.
Sessions saved before `stepVerdicts` and `assists` existed load without them, and a guided session without them renders as before.

Sessions that hold `stepSummaries` (a notepad per step: `proposed` and `agreed` lines) keep them; the debrief and the
scribe read them.

- `code.update`: if newer, credit its new lines to the design step on the rail (step code, above), write the attempt
  file (atomic), remember its hash (to ignore our own watcher event), debounce a syntax check (1.5 s) and send
  `code.diagnostics`. An update that is not newer than the server's version is dropped and its sender alone gets
  `code.rejected { version, held }`, where `held` is the version the server holds.
- File watcher: on an external change to the attempt file (your editor), read it, credit its new lines as above, bump the
  version, broadcast `code.external`, run the syntax check.
- `code.run`: compile and run (section 8), store `code.lastRun`, send `code.run.result`, add a hidden `run`
  note for the next envelope.
- `chat.composing`: the interview chat box changed, typed or dictated; the page sends it at most every 30 seconds.
  It only starts a new quiet stretch for the silence check-in (section 5.5).
- `phase.set`: validate, record, broadcast `phase.changed` and `session.state`; mention in the next envelope.
- `guided.feedback` / `guided.hint` / `guided.stuck`: guided mode in a live round only (else an error, as for the
  others); send the guide a `<request>` turn naming the step and what is asked (feedback on this step, ending in a
  `step_verdict`; the next rung of the hint ladder, recorded with `note_hint`, aimed at the most important open item
  once the step's checks give only a count, and after H3 a pointer to "I'm stuck" instead of a model answer; or, for
  `guided.stuck`, a short model
  answer of at most about 150 words with no tables and no quizzes, then one line asking him to redo the step in his
  own words). The feedback turn waits for the step's check first ("Check this step" order, above). `guided.stuck` makes
  the server itself append `{ at, phase }` to `Session.assists`, so the record never depends on the model; the guide
  does not also call `note_hint` for it.
- `session.pause` / `session.resume`: pause works in both modes (`pauseReason: "user"`). Resume lifts any pause,
  retries after an error, and is the only way out of an away or restart pause.
- `session.discard`: discards the round (below). A refusal arrives as an `error` message with code `discard_refused`.
- `session.end`: interview mode skips the closing line and starts the debrief at once.
- `debrief.retry`, `bookkeeping.draft`, `bookkeeping.apply`: as in sections 5.7 and 10.
- `coach.open`: asks for the coach's opening (section 5.8). Before the debrief it is refused; once the coach chat has
  started, it changes nothing.

**Discard** (`session.discard` over the socket, `DELETE /api/sessions/:id` over REST; both call
`SessionManager.discard`). It is refused while the status is `debriefing`, because the judge is running. Otherwise:
1. The round's agents, clock, file watcher and timers stop without saving, and writes already under way finish.
2. `DATA_DIR/sessions/<id>/` is deleted. The path is built from the id after the id regex, resolved with `realpath`,
   and must be a direct child of the sessions folder, so a symlink cannot lead the delete elsewhere. The round
   leaves the history list, and a save that arrives afterwards is ignored.
3. For an LLD round, the attempt file under `lld/` is deleted only if it still holds exactly the one-line header it
   was created with (section 8.1). Anything else in it is the candidate's code, and the file stays.
   `TRACKER.md`, `REVIEW.md` and `notes/` are never touched.
4. Every socket on the session receives `{ type: "session.discarded" }` and is closed with code `4404`, so the
   browser does not reconnect.

---

## 6. Security (ENGINE agent owns enforcement; everyone follows it)

1. Bind `127.0.0.1` only.
2. Host allowlist on every request and upgrade: `127.0.0.1:<PORT>`, `localhost:<PORT>`, and the dev server
   `127.0.0.1:5173`, `localhost:5173`. Anything else gets `421`. (Defeats DNS rebinding.)
3. Origin allowlist (same four origins, `http://`) on every non-GET request and every WebSocket upgrade.
   A missing Origin on a non-GET request is rejected.
4. CSRF token: 32 random bytes (base64url) per server start, from `GET /api/bootstrap`, required as
   `x-csrf-token` on non-GET requests and in the WS `hello`. Compare with `crypto.timingSafeEqual`.
5. Headers on every response: the CSP already in `src/server/index.ts`, `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`.
   No CORS headers.
6. Validate every body and message with zod strict schemas (unknown keys rejected) and the size caps in
   `LIMITS`. Ids and slugs by regex before they touch a path.
7. Paths: build every file path from validated ids; resolve with `realpath` and check it stays inside its
   root (study root, data dir or the temp build root). Bookkeeping may write only `TRACKER.md`, `REVIEW.md`
   and `notes/*.md`; LLD code only `lld/<folder>/attempt-*.cpp`. The only deletions are a discarded round's folder
   under the sessions folder and its untouched attempt file (section 5.11).
8. Child processes: `spawn` / `execFile` with argument arrays, never a shell string. Timeouts, output caps,
   process-group kill, minimal environment.
9. Model output is untrusted: rendered as Markdown with no raw HTML (react-markdown without `rehype-raw`),
   never executed, except the tester's harness, which runs only through section 8's sandboxed runner.
10. Generic error messages to the browser; details only in the server log, with deny-listed terms and
    tokens redacted.

---

## 7. The board

### 7.1 Browser side (WORKSPACE agent)

`src/web/board/Board.tsx` wraps Excalidraw 0.18.1:
- `aiEnabled={false}`. Light or dark theme from settings. Hide the image tool (`UIOptions.tools.image: false`).
- Load the saved scene through `initialData` (an `updateScene` right after mount is overwritten by Excalidraw's
  own initialisation; found in the smoke test).
- A component palette in a slim left sidebar inserts labelled shapes with `convertToExcalidrawElements`, each
  with `customData: { kind }`, placed at the viewport centre with a small offset per insert. HLD kinds:
  client, load_balancer, api_gateway, service, worker, database, cache, queue, object_storage, cdn,
  search_index, external. Each kind has its own shape and colour (database = ellipse, queue = a wide rectangle
  with a dashed stroke, and so on). LLD palette: "class" (a rectangle whose label has three parts: name,
  fields, methods), "interface" (same with «interface»), "enum", plus arrow presets (inherits: solid line;
  implements: dashed; owns: solid with a diamond start if available, otherwise labelled "owns"; uses: dashed
  labelled "uses").
- `onSceneChange` is called at most once per 1.5 s with the non-deleted elements and an incrementing version.
- **Step frames.** A fresh board (version 0, no step frames) starts with one Excalidraw frame per step that is answered
  on the board, laid out by `src/shared/stepFrames.ts`, named after the step and tagged `customData: { step }`. HLD:
  Requirements, Core entities and API in a row above High-level design and Deep dives. LLD: Entities and States (the behaviour step); the other LLD steps are answered in the code. The frames
  go in through `initialData` and are sent with the first scene report. A palette insert that lands inside a step frame
  is put in that frame.
- `showStep(step)` pans and zooms to a step's frame (`scrollToContent` with `fitToViewport`, animated unless reduced
  motion is on); `showStep(null)` shows the whole board. The board opens on the current step's frame.
- **Pins.** `pins` are drawn over the canvas as numbered buttons, at the top-right corner of a box or the middle of an
  arrow, placed with `sceneCoordsToViewportCoords` and moved on every scroll, zoom and scene change. Hover or focus shows
  the note; a click keeps it open; Escape closes it without reaching the room's Escape shortcut. The note is plain text.
  A pin whose element was deleted is not drawn.
- `exportPng(frameId?)` uses `exportToBlob` (`maxWidthOrHeight: 1568`, white background) after `document.fonts.ready`,
  and returns base64 without the data-URL prefix. With a frame id it exports that frame only, cropped to its edges.
- Test hook, only when the URL has `?testhooks=1`: `window.__irBoard = { insertShape(kind, label), connect(fromLabel, toLabel, label), elements() }`.

### 7.2 Graph builder (MODULES agent): `src/shared/graph/sceneToGraph.ts`

`sceneToGraph(elements)` returns a `BoardGraph`; `graphToText(graph)` renders it for the models; both pure.
Rules:
1. Drop `isDeleted` elements.
2. Collapse groups: the node key of a grouped element is `groupIds.at(-1)` (the outermost group). A group with
   any container shape becomes one node whose label is the joined text inside the group.
3. Labels, in order: text with `containerId === shape.id`; text in the same outermost group; free text whose
   centre lies inside the shape (smallest containing shape wins); otherwise empty (and a warning).
   Prefer `originalText` over `text`. Collapse whitespace.
4. Edges: `arrow` and `line` elements. Map `startBinding.elementId` / `endBinding.elementId` up to node keys
   (text bound to a shape counts as that shape). If a binding is missing, use the nearest node whose bounds
   are within 40 px of that end point and mark the edge `guessed`; if none, `dangling`. Edge label = text with
   `containerId === arrow.id`. Direction from `startArrowhead` / `endArrowhead`. Style from `strokeStyle`.
5. Frames: `frame` / `magicframe` elements give names (`name`, or "Frame n"); members by `frameId`. Before the graph is
   built, `withFrameMembership` puts every element whose centre lies inside a frame into the smallest such frame when
   it has no `frameId` (Excalidraw assigns membership only for pointer gestures); bound text follows its container.
6. `freedraw` and `image` elements become `opaque` entries.
7. Warnings: unlabeled node, dangling edge, node with no edges (only when there are 3 or more nodes).
8. `graphToText` output, stable order (by frame, then top-to-bottom, left-to-right):

```
Nodes:
- [Load balancer] (kind: load_balancer)
- [API service] (kind: service)
- [Postgres] (kind: database) in frame "High-level design"
Edges:
- [Load balancer] -> [API service] "HTTPS"
- [API service] -> [Postgres] "SQL" (dashed)
- [Worker] -> ? (dangling)
Text on the board:
- "Link { code, longUrl, expiresAt }" in frame "Core entities"
Not readable as text: 2 freehand strokes
Warnings: node [Cache] has no connections
```

Tests use fixture scenes made with `convertToExcalidrawElements` output shapes, including: bound labels,
arrow labels, a library-style group (several primitives plus a text sharing the outer group), an arrow bound
to a primitive inside a group, frames, a dangling arrow, a freedraw stroke and deleted elements.

---

## 8. LLD code and the C++ runner

### 8.1 The attempt file

Created at session start: `lld/<lldFolder>/attempt-YYYY-MM-DD.cpp` (add `-2`, `-3` if it exists), with one
line: `// <Problem title> — <YYYY-MM-DD>`. Until the candidate writes code, that line is all it holds. It is a
normal file the user can open in an editor at the same time (`lld/compile_flags.txt` gives clangd C++17).

### 8.2 Compile and run (MODULES agent): `src/server/runner/cpp.ts`

- Compiler: `/usr/bin/clang++` (Apple clang). Flags for every build: `-std=c++17 -Wall -Wextra -g -O0
  -fno-color-diagnostics -fdiagnostics-print-source-range-info
  -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_DEBUG`.
- Syntax check: the same flags plus `-fsyntax-only`; 20 s timeout.
- Run: compile to a temp folder (`DATA_DIR/runtime/cpp/<random>/`), run the binary with a 5 s time limit, no
  stdin, cap stdout and stderr at 64 KB each (keep the head, say it was cut).
- Harness run: copy the candidate file into the temp folder as `candidate.cpp`, write `harness.cpp`:

```cpp
#define main candidate_main
#include "candidate.cpp"
#undef main
// harness written by the tester follows
```

  then `#line 1 "harness.cpp"` and the tester's code (which defines `int main()`); compile with the base
  flags plus `-fsanitize=undefined` (and `-fsanitize=address -fno-omit-frame-pointer` when a one-time probe
  shows the toolchain's AddressSanitizer works; Apple clang 16 on macOS 27 aborts every ASan program before
  `main()`, so it is off there); run with a 10 s time limit.
- Start report: every built program (a run, a harness run and the sanitizer probe) links `runner_hook.cpp`, which
  the runner writes into the build folder and puts before the user's sources. Its report runs before any user code:
  on macOS it is the first initializer, because initializers run in link order; on Linux it is the first
  `.preinit_array` entry, so it runs before a user pre-initializer or `constructor(0)` too. It writes one byte to
  fd 3, a pipe from the runner. A program's time limit starts at that byte, not at the spawn: loading a fresh binary
  goes through the system's first-launch checks, which took about 0.3 s on the machine this was measured on and
  queued past a second when several programs started at once. The run's `durationMs` counts from the byte as well.
  A program that has not reported within 10 s is stopped, `timedOut` is set, and stderr says it did not start in
  time. A program that defines its own version of a C library call the hook makes (such as `write()`) takes over
  that call and can delay its report, but only up to the 10 s start-up limit. The pipe is untrusted: a later byte
  changes nothing, and closing the pipe starts the limit at once. So a program can delay its own start or end its
  own run, but the run never passes 10 s plus its limit, and the CPU rlimit still applies. On macOS the hook moves
  the pipe from fd 3 to a free descriptor from 100 up (close-on-exec), so a program's own writes to fd 3, or a file
  it opens there, are never read as a report. When `main()` ends with `pthread_exit()` and the hook's thread is the
  last one left, the hook calls `exit(0)`, as the last thread would. The hook has internal linkage only and
  compiles without warnings, so it never shows in the user's diagnostics. The compiler keeps its limit from the
  spawn.
- Diagnostics: `parseClangDiagnostics(stderr, filePath)` in `src/shared/clang.ts`, keeping only lines for the
  compiled file (skip notes inside system headers). Regex on lines of at most 2,000 characters.
- Sandbox: the compiler and every produced binary run in an isolated sandbox with no network access and no file
  writes outside their temp build folder. Program output and diagnostics go back to a model, so neither the compiler
  nor the program may read the user's files. If no safe sandbox is available at runtime, compiling and running are
  explicitly refused rather than done unsandboxed.
  - macOS, programs: `/usr/bin/sandbox-exec -p <profile>` (Seatbelt) allows writes only in the build folder and the
    standard devices (`/dev/null`, `/dev/tty`, `/dev/stdout`, `/dev/stderr`, `/dev/dtracehelper`), denies reading
    file contents under the home folder except the build folder, and denies `process-fork`, because macOS has no
    per-sandbox process limit and a child that calls `setsid()` would leave the process group and outlive the
    timeout. Threads are unaffected.
  - macOS, compiler: reads are an allow-list. File contents are readable only from the system (`/usr`, `/System`),
    the active toolchain (Command Line Tools or the selected Xcode bundle, and the install prefix of a compiler
    outside them unless that prefix would open the home folder), the build folder, the named input files, and the
    few fixed-size devices and link files the toolchain reads itself (`/dev/null`, not `/dev/zero` or
    `/dev/urandom`, so an `#include` cannot read forever). This stops `#include` and `.incbin` from pulling in any
    other file. Forking stays allowed because the compiler driver starts the linker.
  - macOS limits: both wrap the command in `/bin/sh` with `ulimit -f` (16 MB for a program, 256 MB for the compiler)
    and `ulimit -t` (10 s CPU for a program; the compile timeout plus 5 s for the compiler). macOS enforces no
    memory rlimit (`ulimit -v`, `-m` and `-d` are refused), so the hook in every built program starts a thread that
    reads the program's physical footprint (`task_info`, `phys_footprint`) every 2 ms and, above 1 GB, writes `m`
    on the status pipe and kills the program. The footprint counts compressed and swapped pages, which the resident
    size leaves out. The runner also polls the resident memory of the whole process group every 100 ms with `ps`;
    that poll is the only memory check for the compiler (2 GB) and a backstop for a program that stops its own
    thread. Either way the group is killed and the result says the memory limit was passed.
  - Linux (containers or host): Bubblewrap (`bwrap`) with private namespaces (`--unshare-all`), a minimal read-only
    system root (`/usr`, `/etc`), only `/dev/null`, `/dev/zero`, `/dev/random` and `/dev/urandom` as devices, a
    private `/tmp`, **no `/proc`** (the container's `/proc` would expose the server's environment and its token, and
    a rootless container cannot mount a fresh one; the sanitizer's resulting "cannot read executable name" warning is
    removed from the run's stderr), and an isolated writable build directory (`--bind <dir> <dir>`). The compiler
    also gets its named input files and its install prefix mounted read-only. `prlimit` sets the limits: a program
    gets 1 GB address space, 10 s CPU, 64 processes and 16 MB file size; the compiler gets 4 GB address space, the
    compile timeout plus 5 s CPU, 64 processes and 256 MB file size.
- Kill the whole process group on timeout. Delete the temp folder afterwards.

### 8.3 Browser side (WORKSPACE agent)

`src/web/code/CodeEditor.tsx` (Monaco, C++, every suggestion and autocomplete off, no minimap, markers from
`diagnostics`, external `value` changes applied without losing the cursor when possible) and
`src/web/code/Console.tsx` (Run button, compile errors list with click-to-jump, program output, exit code,
duration, "timed out" and "output was cut" notes).

---

## 9. Judge checks (MODULES agent)

### 9.1 `lintProse(text)` in `src/shared/lint.ts`

Implements TEACHING.md section 2's mechanical checks on prose (ignore fenced code blocks, inline code and table
rows): more than one em-dash in a paragraph; the symbols `→ ≈ ⇒ ×` in a sentence; a sentence starting with
"That's", "This is" or "It's" (report as a soft issue); a paragraph over 300 words. Returns a list of short
issue strings.

### 9.2 `checkQuotes(scorecard, sources)` in `src/shared/quotes.ts`

A quote is verified when its normalised form (Unicode NFKC, curly quotes to straight, whitespace collapsed,
lower case, surrounding quote marks and trailing punctuation trimmed) is a substring of the normalised source
text: candidate messages for `candidate`, graph text for `board`, code for `code`. An ellipsis (`...` or `…`)
inside a quote splits it into parts that must all appear, in order.

---

## 10. Bookkeeping (MODULES agent builds the mechanics; ENGINE agent wires the scribe)

### 10.1 Tracker parsing: `src/server/study/tracker.ts`

- A section is matched by a heading line that starts with the given `section` text (headings carry emoji, for
  example `### C2. Classic HLD Problems 🔴`). The section ends at the next heading of the same or higher level,
  or a `---` line.
- A bullet line is `- [m] <text>` with an optional ` → <suffix>`. `bullet` matches when the text before
  ` → ` equals it exactly (after trimming). Sub-bullets are indented two spaces.
- `findBullet(tracker, section, bullet)` returns the line index, mark and suffix, or null.
- `readMarks(tracker)` returns marks for every bullet in a section, in order.

### 10.2 Scribe inputs (built by the engine, deterministic)

The scribe gets: TEACHING.md (whole), the problem's tracker section text, the last three Session Log rows, the
Gaps table header plus its last three rows, the REVIEW.md header plus its last entry, `notes/_TEMPLATE.md`,
the existing notes file for this problem if any, the problem brief, the scorecard, any written step text, any step
notepads, the step checklist with what was covered and where, the transcript and the coach transcript. Both
transcripts use the same lines as `read_transcript`: a recorded hint shows its topic without its level, other hidden
notes are left out, and a line break inside an entry starts an indented line.

### 10.3 Op semantics: `src/server/study/bookkeeping.ts`

`planProposal(studyRoot, sessionId, ops, guard)` returns a `Proposal`; `applyProposal(studyRoot, proposal,
opIds, guard)` writes. Rules:
- `tracker_update_bullet`: exactly one matching bullet in the section, or the op is blocked. `mark` replaces
  only the mark; `appendSuffix` is appended to the line (with ` → ` added in front when the line has no suffix
  yet and the suffix does not start with `→`; with ` · ` when it already has one).
- `tracker_add_subbullet`: inserted after the parent bullet's last existing sub-bullet as
  `  - [ ] <text> (added)` (do not double the "(added)").
- `tracker_append_session_log_row`: appended as the last row of the table under `# Session Log`; pipes inside
  cells escaped as `\|`.
- `tracker_append_gap_row`: appended as the last row of the table under `# Gaps Found & Filled`.
- `review_append_entry`: appended at the end of `REVIEW.md` after a `---` separator line, the way existing
  entries are separated.
- `notes_create`: blocked if the file exists. `notes_append`: blocked if it does not exist; appended after a
  blank line.
- Every op's resulting text is checked with the privacy guard; a hit blocks that op with the reason.
- The proposal stores the sha256 of each target file. Apply recomputes from the current file; if a hash
  changed, the whole proposal becomes `stale` and nothing is written ("the file changed since the draft;
  draft again"). Writes are atomic (temp file + rename) and keep the file's trailing newline.
- Diffs are unified diffs (the `diff` package, `createTwoFilesPatch`, 3 lines of context) per file.

---

## 11. Privacy guard (MODULES agent): `src/server/guard/privacy.ts`

`loadPrivacyGuard({ claudeJsonPath, denylistPath })` builds the term list at runtime and never writes it
anywhere:
- From `~/.claude.json` (`oauthAccount.emailAddress`): the full address, the part before `@`, and the domain's
  first label (for `a.b@company.co.in`: the address, `a.b`, `company`) when it is 3 or more characters and not
  a common mail provider (gmail, outlook, hotmail, yahoo, icloud, proton, protonmail, live, me).
- From the deny-list file, one term per line, `#` comments allowed. Missing file is fine.
- `findViolations(text)` matches case-insensitively on word boundaries and returns the matched terms.
- `redact(text)` replaces matches with `[redacted]` (for logs).
Unit tests use a temp `claude.json` and deny-list; they must not read the real home folder.

---

## 12. The browser app (SHELL agent, except board/ and code/)

Plain, calm, IDE-like. Tailwind 4 (`@import "tailwindcss"` is in `styles.css`). Light and dark themes. Every
control reachable by keyboard; visible focus; contrast at WCAG AA. No external fonts or images.

### 12.1 Screens

**Main bar** (every page except the room, the debrief and the start flow)
- "Sparmate" and three links: Today, Practice and Progress. The current page is underlined. A "Jump to…" box opens
  the command palette, and a Menu button holds Settings, Usage and the keyboard shortcuts, with the Test mode pill
  beside it. On a phone the links move to a bottom tab bar with a Jump tab. The Practice link shows the number of
  due drills, and nothing when none is due. The old addresses `/library`, `/library/new`, `/gym`, `/dsa` and `/history`
  are replaced in place by `/practice`, `/practice/new`, `/practice/drills`, `/progress#dsa` and `/progress#history`.

**Today `/`**
- Kicker date and the day's title ("System design day", "Machine coding day", "DSA day", "Redo day", "Rest day"). A
  quiet week strip top right marks today and shows each day's kind from the weekly plan.
- The hero card is the session `selectToday` picks (section 5.10a): chips ("Redo due" or "New problem", the track), the
  problem title large, one sentence why, a facts row (Mode, Round, Debrief), at most one warning line, the one filled
  primary button, "See the plan" and a quiet "Pick another problem" link to Practice. "See the plan" opens a side
  panel with the mode switch, the step plan with its minutes and the minutes of the last try, the last try's result, and
  a link to the last debrief. A round to finish shows Finish as the primary action. A DSA day shows "Open LeetCode"
  (new tab, `rel="noopener noreferrer"`).
- Side column: a "Drills due" card with the number of due drills and their total minutes, up to three rows (the gap,
  and the drill kind with its minutes and the problem of its next attempt, with a "Changed constraint" tag when
  one applies) each with a Start button, and an "Open Practice" link; an Unfinished card for the newest unfinished round (title, paused date, clock used of the total with a
  bar, Finish, and End and debrief, or Discard under 5 minutes of clock), with "N more unfinished rounds" linking to
  History; a link card "N more redos" to Progress. End and debrief calls `POST /api/sessions/:id/end` and opens the round.

**Practice, Rounds `/practice`**
- A segmented switch, Rounds and Drills, sits under the title; Drills carries the number due. `/practice` opens Rounds and `/practice/drills` opens Drills.
- Track switch HLD, LLD and My questions with counts; filter Not tried first (default), Redo due, All. Rows hold a status
  mark, title, difficulty and the state on two lines: the state word (Not tried, Partly done, Redo due, Round open or
  Done, the same word the Status fact shows in the panel) and a small detail, which is "Due since 8 Nov" for a redo and
  the last try's result and day (such as "Not yet · 3 Nov") for other tried problems. Rows are grouped Not tried, then
  Tried before. A row has no button: selecting it fills the right panel with
  the chips, the title, the interviewer's opening line, the Status, Round and Debrief facts, the Interview or Guided
  switch (default from the mode rule), one primary Start button and a small caption. A problem with an open round shows
  "Finish the open round" in place of Start.
- "Practise any question" (top right) opens `/practice/new`: a textarea for a pasted prompt, an HLD/LLD toggle and a
  Prepare button. It shows multi-stage preparation progress ("Researching: N searches, M pages", "Writing the brief",
  "Checking facts"). Once ready it shows a setup card with the problem title, track, sources count, checks count,
  corrections applied, a confidence note, and "Start interview" and "Guided" buttons, without revealing the hidden brief.
  The debrief's reference section renders the verified research sources with secure outbound links (`target="_blank"`,
  `rel="noreferrer noopener"`).

**Progress `/progress`**
- Header row with "This week": Rounds finished of planned, Redos of planned, Drills as interview-ready of attempted this week (free drills
  included), and DSA mediums as this week's count of the goal ("2 of 3"),
  or "—" with an info tip when no profile has been read.
- Main card "Focus this week": the lowest skill from the newest scored rounds, its score out of 4, one supporting number,
  and one chart with a bar per step, planned minutes against used minutes, from the newest scorecard's phase timing. The
  primary button is "Practise this gap" (a 20-minute guided round on the newest open gap whose text names the skill) or,
  with no such gap, "Start a round" to Today.
- Side cards beside it: the counters above and Next redos with the next two and their dates, "See all N" opening a
  side panel with the full queue.
- The page is one scroll with a sub-navigation of four sections: This week, Skills, DSA and History. The Skills section
  holds a "Level per skill" card and a "Drills by kind" card. "Level per skill" has a Guided and Interview switch (never
  mixed), a 1 to 4 track per skill with the target bar marked, one dot per round (the newest bold), the skill's level as
  its number to one decimal, and an info tip ("Your last 3 rounds, plus drills from the last 30 days at a lower
  weight.") that also explains the scale.
- Drills feed Progress. A drill point is one finished, non-legacy attempt that has scores: its day, kind, the skill the
  kind trains on the track of its problem (`drillSkill`; the trade-off takes the track of the attempt's problem), the
  mean of the scores of its first grade, its outcome and whether it was a first try (Interview-ready with no revision).
  `GymSummary.points` holds the points of the last 90 days (today included), at most 500, oldest first; an attempt whose
  problem is gone and whose kind serves both tracks is left out. A skill's **level** is the mean of the scores of the
  newest 3 rounds that scored the skill (weight 1 each) and the drill points for that skill from the last 30 days (today
  included, weight 0.25 each). When the drills would weigh more than 1 together (more than 4), each weighs 1 divided by
  their number, so all drills together weigh one round. The level is rounded to one decimal; with no drill point it is the
  plain mean of those rounds, and the row tone follows it (3 or more green, 2 up to 3 amber, below 2 red). A skill that
  has drills and no scored round has no row. Drills join the rows of the mode that `scoredRounds` picks (Interview when
  there is an interview round, otherwise Guided); the rows of the other mode are rounds only. Each row also draws its last
  8 drills as small diamonds on the same 1 to 4 track, under the dots, coloured by their own score, each with the label
  "Drill, <kind title>, <score>, <outcome>".
- A "Drills by kind" card under Skills: one row for each kind that has a point, with the last 8 outcomes oldest first as
  pips (green for Interview-ready, amber for Getting there, red for Needs work, each with its words for a screen reader),
  the attempts of the last 30 days, and the share of those that were ready on the first try. A row links to Practice,
  Drills. With no point the card says no drill has been graded yet; when the summary cannot be read it says so.

**Progress, History `/progress#history`**
- Every round, newest first: date, problem and track, mode, a result chip (the verdict as its plain label, or "Ready" or
  "Not yet" for a guided round with a readiness call, or the status), a link (Finish for a live or paused round, else
  Open debrief or Open) and a "Discard" button. A debriefed round shows "Notes saved" or "Notes not saved". An unfinished
  round carries an "Unfinished" chip. Discard asks first, with the same confirm text as the room, then calls
  `DELETE /api/sessions/:id`. It is disabled while the status is Debriefing.

**Practice, Drills `/practice/drills`**
- The next due drill is the hero: title, problem, length, due day, Interview-ready results (three pips, with an info tip on how a gap closes), the one-line task and "Start drill". "Also due" lists the next three due drills and says how many more wait. "All drills" opens a side panel with the six drill kinds, then the problems that can supply the drill. With nothing due the hero says so and "All drills" is the one primary button. With no round played and no custom problem, the page explains that drills start after the first round, and that a question prepared on the Prepare page can be drilled at once, with no round played ("Prepare a question" sits next to "Pick a round in Practice"). A drill kind with no usable problem reads "Play a round or prepare a question of this track first".
- Drill kinds are fixed: `capacity`, `walk`, `requirements`, `deep_dive`, `tradeoff` ("Defend a trade-off") and `lld_skeleton`. Capacity, walk and requirements take 10 minutes; the other three take 15. Capacity, walk and requirements serve system design only, the LLD skeleton serves machine coding only, and the deep dive serves system design. The trade-off serves both tracks, so a kind lists the tracks it serves (`DRILL_INFO[kind].tracks`). Each kind reads one section of the problem brief: capacity keys on "Capacity math" and prompts with the numeric lines of "Hidden facts"; walk keys on "Reference design"; requirements prompts with the opening prompt only and keys on "Expected requirements" plus the held-back facts, so it grades the questions and settled requirements the candidate writes, each with the answer or number the candidate assumes, because nobody answers in a drill; deep dive keys on one "Deep dives" entry, chosen by words shared with the gap (with no shared word, the entries rotate); the trade-off on system design keys on one top-level bullet of "Accepted alternatives" (`- **Name.** text` with its sub-bullets; the title is the bold lead without its closing dot, and each title names one decision). A bullet whose title is "Smaller choices" or starts with "Other" gathers small unrelated choices, so it is never a topic. The task is `The topic is "<title>". Say what you would choose for this problem, give the reason from its requirements, and say what would make you choose differently.` The entry is the one whose title shares the most four-letter word stems with the gap's title; the gap's reason and the entry's text are not read, and the common words ("without", "reason", "choice", "option", "design", "picked", "explain" and the usual filler words) never count. With no shared stem the entries rotate by a count: for a queued drill the number of finished attempts that counted for it, so its topic holds until one is done; for a free drill the number of finished attempts of that kind on the problem. A problem fits with at least one entry. The trade-off on machine coding asks about the whole "Patterns that fit" section at once, because a pattern's name would give the answer away ("Name the design patterns you would use in this problem and the ones you would leave out, each with the reason from the requirements."), shows the same "What you know" facts block as the LLD skeleton, and keys on that section; the LLD skeleton prompts with the facts and keys on "Entities and relationships" and "Behaviour and states". The skeleton is a plain-text answer graded on structure, not the C++ editor. The bullets of "Hidden facts" state facts only, because a drill shows them as written; a note to the interviewer (what to hold back, when to give a number, what to accept, anything about the candidate, the extensions or the curveballs) sits on its own plain line after the list, starting with "For the interviewer:". The interviewer, tester, judge and coach read the whole brief, and the tester and judge prompts say those lines apply to them too. The brief writer and the brief checker keep to that, and a test holds every shipped brief to it. As a backstop for older custom briefs, a drill shows the bullets through `shownFacts` (the first 40,000 characters of the section, at most 60 bullets of up to 2,000 characters): a bullet whose label is "Extensions", "Curveballs", "Note" or names the interviewer is left out, with the bullets indented under it; ", if asked" in a label is cut; a bracketed aside that names the candidate, the extension step or the extensions, a curveball or the interviewer, or says "if asked", "do not mention" or "do not volunteer", is cut; and a sentence is left out when it tells the interviewer what to hold back ("Do not mention ...", "Never reveal ...", "hold back", "until asked"), what to accept or give ("Accept it/either/any ...", "If asked ...", "Give no figure ...", "Only give ..."), what to do if the candidate proposes or asks ("If they propose ...", "let them argue"), or names "the candidate", the extension step, a curveball or a numbered scenario. A dot after "e.g." or before a closing quote does not end a sentence, curly apostrophes count as plain ones, and the label stays; a bullet with nothing left after its label is left out. Text of a brief is untrusted: sections are read up to 40,000 characters, by plain line scanning, with capped entry counts and lengths.
- Each kind has a rubric (`DRILL_RUBRIC`): the round scorecard skill it trains and three to five named criteria, some marked core. `drillSkill(kind, track)` gives the skill, because the trade-off trains `depth` on system design and `design` on machine coding. The grader scores each criterion from 1 to 4 (1 missing or wrong, 2 partly there, 3 at the bar, 4 strong) on the candidate's reasoning; the key is a reference, so a different design or number that holds up with a reason earns full credit. Capacity trains `scale_reliability` (picks the numbers that decide, math is about right, each number ends in a decision: core; states its assumptions), walk trains `design` (full path in the right order, each box has a job: core; says what is read and written where, names the slow or weak step), requirements trains `navigation` (core functions, quality needs as numbers, asks the questions that change the design: core; says what is out of scope), deep dive trains `depth` (says what breaks in the naive way, a mechanism that works one level deeper, holds up under the follow-up: core; states the cost), the trade-off trains `depth` or `design` (takes a clear position, the reason uses this problem's needs, holds or changes position for a good reason: core; says when the other option wins) and the LLD skeleton trains `design` (right classes, each rule has one owner, signatures express the behaviour: core; relations and states, room for the next change). The server, not the model, sets the outcome: **Interview-ready** when every core criterion is 3 or more and none is 1; **Needs work** when a core criterion is 1 or two or more core criteria are below 3; **Getting there** otherwise. A deep-dive row saved with three scores, from before the follow-up criterion, is judged on the three it has. The grader's reply is rejected, and asked for again once, unless its score ids are exactly the kind's criteria once each. Feedback is short: up to two lines of what went well, one or two of what to improve, the candidate's own line (quote-checked against all the candidate's turns; a misquote, or a line that only says the candidate does not know with fewer than three other words besides filler (straight or curly apostrophes alike), gives way to the first line of four words or more that says something, when there is one) and one line of what a strong answer says, in the grader's own words. Feedback speaks to the candidate as "you": the grader prompt asks for it, and the server turns "the candidate's" into "your", "the candidate is/was/has/does" into "you are/were/have/do", "the candidate" before a modal or one of a fixed list of past-tense verbs into "you", "the candidate's right/wrong/correct/not" into "you are ...", and any other "the candidate" that opens a clause into "your answer". An improve line names the kind of thing that is missing and how many, never the items: the prompt asks for it, and for a line that asks for more (it gives a command such as "Add", "Name" or "Ask", or says something is "missing", "left out" or "never asked"), the server cuts at an example list that comes after the ask ("such as", "for example", "for instance", "e.g.", "i.e.", "including", "namely", also in a bracket) or at the colon or dash before the items; when the list is an aside followed by ", but ..." only the aside goes, and a cut that leaves under four words drops the line. A later sentence of the line that starts "Also add ..." (or name, ask, say and the like) is dropped. In any other line only an aside closed by a comma (", including ..., ") is cut. Lists with "like" or "plus", items named as what the answer "does not say", and an "Also ..." entry of their own are stopped by the prompt only. A feedback line that rates a number against the key ("near the right size", "the right ballpark", "close to the key", "matches the key") is dropped, and so is a went-well line about numbers (a digit, or words such as rate, size, estimate, total, math) that praises them as right, correct, accurate, sound or reasonable, because it tells the candidate how close the key is; when the capacity drill's "Math is about right" scores below 3, every went-well line about numbers is dropped too. Any feedback line that shares six or more words in a row with the answer key is dropped. So is a line that gives part of the key away in its own words: one that holds a number from the key, or three words of six letters or more from it, that the candidate did not write and the drill did not show (`dropKeyReveals`). The candidate revises right after the feedback, so feedback points at the gap and never supplies the answer; when no improve line is left, the server writes "Work on this: <criterion>." for the lowest scored criterion. The strong line is saved in the attempt body. The result of a submit, a reply or a revision never holds it; `GET /api/gym/attempts/:attemptId` returns it only under the rule in the route table.
- The deep dive and the trade-off run as a short dialogue (`dialogue: true` in `DRILL_INFO`), like an interviewer who probes. `POST /api/gym/submit` takes the opening answer, opens the attempt row (`status: "open"`) and asks the grader for the first follow-up question; the answer is `{ kind: "question", attemptId, question, asked: 1, of: 2 }` and the body file holds the turns so far. `POST /api/gym/reply` takes `{ attemptId, asked, answer, elapsedSeconds? }`: the candidate's reply and `asked`, the number of the question it answers (1 to `MAX_FOLLOW_UPS`, which is 2). The server answers 409 ("This conversation moved on. Reload to continue.") unless `asked` equals the number of questions asked so far, so a second tab, or a request sent twice, never answers a question the candidate did not see. After the first reply the grader says whether one more question is needed (`{ another, question }`); when it is, and fewer than two were asked, the server returns the second question. Otherwise, and always after the second reply, it grades the whole conversation with the kind's rubric. The grader message holds the conversation as a `<transcript>` block, every turn escaped, and the interviewer's questions use the prompt `drill-follow-up` with the role `grader`. A question is model output: a strict schema with caps, control characters stripped, the length clipped and private names redacted. A question asks one thing and builds on the candidate's words, so the server checks it before use (`reviewQuestion`), in this order, and the first broken rule is the reason. Key: it shares six or more words in a row with the answer key that the candidate did not write and the drill did not show (a topic title the drill shows does not count), or it holds, from the key and not from the candidate's turns or the drill, a number of three digits or more, two words of six letters or more, or two words of four letters or more side by side as the key has them. Words are compared on a light stem ("refill" meets "refills"), and plain words of every capacity or failure question (second, minute, write, read, request, client, server, user, retry, timeout, fail, succeed, crash and the like) and filler words never count. Opener: it opens, after at most a short lead-in such as "So," or "I think", with "The hardest (trickiest, difficult, key, main, real, core...) part (problem, issue, challenge, thing, bit...)", "The challenge here" or "The crux". Statement: it says "your <subject> is a ..." where the subject is the whole design (design, approach, plan, solution, system...), or where the words after hold a key word of seven letters or more, or two key words side by side, that the candidate did not write; after "if", "when", "since" or "because" it sets up a case, so only the key words count. Long: it is longer than the 300 characters the page shows. Two: a quote opens and never closes, or it holds more than one question mark outside a quote, any text after the question mark, more than one sentence when it has no question mark at all, or, in the sentence that asks, a second question after a real question start (", and" with a question word, "if", "whether" or a verb; "and why?", "and how would", "and what happens", "and how many"; ", or what", ", and then what", ", and also how", "(and how"; or a semicolon before a question word). Private names are redacted before the length is clipped. A flawed question is asked for again once, in the same budget of two calls, with the rejected question and the reason; the second call may also say that no more question is needed. When the second reply is flawed too, or one call fails and the other reply is flawed, the server cuts a reply down: the text up to the first question mark, without a joined second question and without a dash, semicolon or bracket left before the mark. It tries the second reply, then the first, and when neither is a clean question with closed quotes it shows "What is the weakest part of what you just said?". That fixed question is asked at most once in a conversation: when it would come a second time, no further question is asked and the conversation is graded. Questions and results are checked for key text as above. The candidate's reply is added to the saved turns only after the grader call succeeded, so a 502 leaves the attempt as it was. A failed first question removes the open row, as a failed grade does. The schedule, the next pick and the item update run at grade time exactly as for a written drill; `seconds` is the sum over the calls. A dialogue attempt has no revision (`canRevise` is false). Every grader call of one attempt carries the same `drillAttemptId` and `drillKind` in its usage. A submit, a reply and an abandon take one lock per target (the queued drill, or the kind and problem of a free drill), so no two of them run at once for one target: a call that finds the lock taken gets 409. A submit never drops an open row that is being worked on or whose body already holds a grade (it gets 409); it drops only an open row whose body is missing or cannot continue, and the body file goes with the row. The step that moves the schedule changes nothing and answers 409 when the attempt's row is no longer there. A reply is graded on the content saved for the attempt (problem, changed constraint and topic from the attempt row and body), never on the queued item's newer pick: when the item's problem or changed constraint moved, the reply gets 409, and a graded attempt counts for the item only while the item's pick still equals the attempt's. `POST /api/gym/prompt` returns `open` for a dialogue attempt still open today (`{ attemptId, openedAt, turns, asked, of }`, where `openedAt` is the ISO time the attempt opened, so a resumed page counts its time from then), and then builds the prompt from the topic and changed constraint that attempt saved, so a reload continues the same conversation; a new submit while one is open gets 409 ("This drill already has an answer in progress."). The prompt of a deep dive or trade-off names its `topic`, and the page sends it back as `topic` (a string of up to 200 characters) with the opening answer. The server accepts it only when it equals a topic title the brief offers for that kind (for a changed constraint, the topic the brief builds for the item now), builds the content from it, and otherwise answers 409 ("This drill moved to another problem. Open it again from Practice."). That keeps a rotation that moved between the prompt and the submit from grading another topic than the candidate saw. The page, on a 404 from reply or abandon, on the 409 above for a reply, or on the 409 "already has an answer in progress" from submit, loads the prompt again and shows what the server holds. `POST /api/gym/abandon` removes an open attempt and its body file so the candidate can start over, and changes no schedule. When the schedule syncs, open rows from an earlier day are removed with their body files.
- Drills use only problems with a finished round (ended, debriefing, debriefed or failed; a live or paused round never counts) and custom problems. A gap about how the round was run queues nothing. The judge marks one with the optional `aboutTheRound` field. A title that ties time or pace to a step, the round or the question asked (staying in the round, running out of time, a step that ran long or over, too long or twenty minutes on a step, the round's time, staying on the question, a question or the curveball left unanswered, never reaching a step, a step held to its time box) overrules even the judge's `drill`. Otherwise a judge gap queues a drill: the gap's optional `drill` field when the kind serves the track, else a keyword match (`drillForGap`), else nothing. Before the keyword match, a title with words that usually mean the round but can also name a part of a design (pacing, pace, a time box, time management, stuck or stalled, remaining minutes, answering every question, out of time, unanswered, finished early) queues nothing. The topic rules run in order on the title, then on the title with its reason. On system design the capacity (with "numbers that decide" read in the title only), deep dive ("deep dive"), requirements and walk rules come first, then the trade-off rule (which includes a title about choosing), then the broad deep-dive words (mechanisms such as caching, sharding, failure or duplicates, and titles that say the answer stayed shallow, such as "the hard part" or "the first answer"). On machine coding a gap about a pattern, strategy, the extension or extensibility, a choice or a trade-off queues the trade-off, and a gap about entities, classes or modelling queues the LLD skeleton. The trade-off rules and the broad deep-dive words read the title only, because the reason a gap matters often names a topic it only touches on. A gap about explaining or communicating (the words "explain", "explaining", "explanation", "communicate", "communication" and "articulate" count alike) is the last resort on both tracks: it queues the trade-off only when no topic rule matched in either pass, and it reads the title only. The first build of the schedule queues only debriefs from the last 14 days and records `backfilledOn`; after that every round debriefed since queues its drills, however long the candidate stayed away. A drill queued late falls due that day, never in the past. A file saved before the marker counts as built. Gaps from gap-practice rounds queue drills too. State lives in `DATA_DIR/drills.json`, format version 2 (strict schema, atomic write, up to 2000 items and 20000 attempt rows). An item keeps `originProblemId` (the problem of the round that showed the gap, never changed), `problemId` (the problem of its next attempt, picked by the server), `variant` (the id of the changed constraint of the next attempt, or null) and `readyOn` (the proof keys of the ready results, emptied when the count starts again; a proof key is the problem id, or `<problem id>#<variant id>` for a changed constraint). An attempt row is the index entry: id, open time, day, drill, problem, queued item, `status` (`open` while grading or while a dialogue goes on, then `done`), outcome (`ready`, `getting_there` or `needs_work`), rubric scores, time taken and a `legacy` flag. Each attempt also saves a body file, `DATA_DIR/drill-attempts/<id>.json` (folder mode 0700, strict schema, atomic write): the task, the topic, the changed-constraint question when there was one (`changed`), the candidate's answers, any dialogue turns and the grades. A file that matches neither version, or is not JSON, is kept as `drills.json.bad` and the schedule starts empty. A version 1 file is converted on load: every item and attempt is kept, its attempts become `legacy` rows with no body file, `pass` becomes `ready` and `not_yet` becomes `needs_work`, and the original text is kept once as `drills.v1.json`. If the converted file cannot be written, the app still starts on the converted drills.
- Schedule, in local days: due the day after the debrief. The ready count is the number of Interview-ready results in a row (stored as `passes`). A first-try Interview-ready result adds 1 and moves the next drill out 3 days after the first and 7 after the second; the third closes the drill only when the ready results (`readyOn`, with this one) cover at least two different proof keys, or when the picker's next pick for the item asks a proof key that is already among the ready results and the one just played, so it has nothing new to offer. Otherwise the count stays at 2 and the drill returns in 3 days on another problem or a changed constraint. An Interview-ready result that came after a revision adds 1, never above 2, brings the drill back in 2 days and can never close it. Getting there leaves the count as it is and brings the drill back in 2 days. Needs work resets the count to 0, empties the list of ready problems and brings the drill back the next day. A free drill that matches a queued drill (same kind, the problem of the item's next attempt, and an item with no changed constraint) counts for it only when that drill is due; an attempt before its day, and any other free drill, is logged and changes no schedule. A second submit for a drill still being graded gets 409. Due reads as "Due today", "Overdue", "Tomorrow" or the date; each row names its gap, and a deep dive names its topic. Every finished attempt is logged for the week stat (Interview-ready counts as ready); an attempt whose grading fails leaves no row. An open row never counts.
- `GET /api/gym` returns the queue (each row names the problem of the next attempt, `variantTitle` and `originProblemTitle`), the due count, the usable problems with the drills each supports, the week's interview-ready and attempted counts, the closed drills and the drill points. `POST /api/gym/prompt` returns the prompt without the answer key. `POST /api/gym/submit` takes the target, an answer (1 to 8000 characters) and optionally `elapsedSeconds` (0 to 7200, the time the browser measured), the `variant` the prompt named and the `topic` the prompt named. It opens an attempt row before the grader runs, grades the answer with the `grader` role, saves the body file, marks the row done with its outcome, first scores, time and the item's state before the attempt (`itemBefore`, only when the attempt counted for a queued item) in the same save that moves the schedule, and returns the attempt id, the outcome, the first outcome and whether it was revised, the criteria with their labels, core flags and scores, the went-well and improve lines, the candidate's own line, whether a revision is still allowed (`canRevise`), the ready count, the next due day and the next due drill. `POST /api/gym/revise` takes `{ attemptId, answer, elapsedSeconds? }` and grades one revised answer for a finished attempt. It is allowed only when the row is done, not legacy, not yet revised, not Interview-ready and from today; otherwise it answers 409, and 404 for an unknown id. It rebuilds the task and key from the saved problem and topic, grades the revision on its own with the same rubric, and keeps the better outcome as the final one; the row gets `revised`, `firstOutcome`, the final `outcome` and the added time, and the body file gets the second answer and grade. When the final outcome is better and the attempt counted for a queued drill that is still open, the item is worked out again from `itemBefore` as a revised result; otherwise the schedule does not change. A second request for the same attempt while one is being graded gets 409, and a grader failure leaves everything as it was (502). Bodies are strict, ids are validated, the strong line is never in a result, and nothing is read from a path built from an id.
- Each repeat of a queued drill uses another problem, and the server picks it (`engine/drill-pick.ts`). The first attempt is the origin problem. The pool of an item is every playable problem of its track that has the material for the kind (the same played-or-custom rule as every drill, so an unplayed library problem is never picked); for a deep dive the problem must also have a "Deep dives" entry whose title shares a four-letter word stem with the gap's title. The entry's text and the gap's reason never admit an entry; they only rank the entries whose titles match, and the same rule picks a queued item's topic. Only the first 40,000 characters of the section are read. A repeat takes the pool without the problem of the item's last counted attempt, in this order: problems the item never used, then the one used longest ago, then the one with the fewest finished attempts of the kind, then the lowest id. When that list is empty, the item stays on the last-used problem (the origin when it has no attempt) and alternates between the plain problem and its changed constraints: it takes the proof key this item used least on that problem, a tie going to the last changed constraint of the brief, and never the proof key of its last counted attempt while another exists. A brief with no changed constraint repeats the problem as written. A deep dive only alternates between the changed constraints that fit its topic: the topic is the "Deep dives" entry whose title matches the gap, and a change fits when its `Fits:` line names that title. Each curveball of a system design brief ends with its own line `Fits: <deep dive title>; <deep dive title>` (or `Fits: none`): the deep dives the change directly bears on. The line is not part of the key, every shipped brief has it, and a test holds every title on it to a deep dive of the same brief. A brief without the line (an older custom brief) falls back to a shared four-letter word stem between the topic's title and the change's title and question. With no matching topic or no fitting change the item repeats the plain problem. A capacity drill prefers changed constraints whose question holds a digit and falls back to all of them. The pick is saved on the item (`problemId`, `variant`) in the same update that moves the schedule, after every counted attempt, and each read of the queue picks again for an open item whose saved problem is no longer playable, no longer fits the kind, whose saved variant is no longer in the brief or, for a deep dive, no longer fits its topic (unless an open attempt of the item still uses that pick, which keeps it until the attempt ends), or whose saved proof key equals the proof key of its last counted attempt while the picker can offer a different one. The queue row, the prompt and the submit read the saved pick.
- A changed constraint (variant) comes from the brief's "Curveballs" section (system design) or "Extensions" section (machine coding). Each numbered item is one entry: the bold lead is the title (a closing parenthetical is dropped, and an entry whose title holds the word "Expect" is skipped), the text before `Expect:` is the question the candidate sees, and the text after it joins the answer key. Text before the first numbered item is ignored; an entry with no bold title or no `Expect:`, or one that says it was seen or used already, is skipped; at most 8 entries are read and their lengths are capped. The variant id is a slug of the title (lower-case letters, digits and hyphens, at most 80 characters) and is matched against the brief's own parsed entries, never used in a path. The item asks the entry it used least on that problem, and a tie goes to the last entry of the brief. With a variant the prompt gains a "What changed" block with the question and `variant: { id, title }`; a deep dive keeps the gap's own topic and its "The topic" block, its task is `Take "<topic>" after the change below: say what breaks first, what you would build instead, and what it costs.`, and its key is the topic's levels plus the `Expect:` text, so two gaps on one problem that match different topics ask two different tasks with one change (an attempt saved when the change itself was the deep dive's topic, and that title is no deep dive of the brief, rebuilds that way); the task asks only what the change moves (one wording per kind; the capacity wording is "The situation changed as below. Work out the numbers that matter now, and say what each one forces."). The trade-off on system design names a choice: its topic is the "Accepted alternatives" entry whose title shares the most word stems with the change (else the first entry), and the task is `Your choice was about "<title>". The situation changed as below. Say whether you keep that choice or change it, and defend it.` with the hint "Say whether you keep the choice or change it, and give the reason from the change."; its key is the whole section plus the `Expect:` text. The trade-off on machine coding asks "The requirement below is new. Say which patterns you would use or drop now, each with the reason." with the same "What you know" block, and the key is the normal key plus "After the change, a strong answer covers:" and the `Expect:` text. The `Expect:` text never leaves the server; a revision rebuilds the same variant key from the attempt row, and when that variant is no longer in the brief it answers 409.
- A queued drill's request must name the item's saved problem, otherwise the answer is 409 "This drill moved to another problem. Open it again from Practice.". The submit body also carries `variant`, the id the prompt named (an id pattern, at most 80 characters, or null); for a queued drill it must equal the item's saved variant or the answer is 409 with the same message, so a tab that opened an older prompt is never graded on another one. The answer is graded on the content built for that checked pick. A free drill is never a variant, and a free submit with a non-null `variant` is 400.
- `/gym/drill/:drill/:problemId[/:drillId]` is full screen like a round, without the main bar: the task and material on the left, a monospace answer box on the right, and a soft countdown that shows overtime and never blocks. The countdown of a new answer starts with the first change to the answer box (typing or pasting), so reading the task costs no time; until then it shows the full time and "starts when you type". "Start over", and a conversation that ended in another window, empty the box and wait for the first change again. A resumed conversation counts from when it opened, and a revision from the click on "Revise your answer". The result of an early try says "This was an early try. It does not change your schedule." and a free drill says "This was a free drill. ..." A queued drill opened before its day says under the problem name "Due tomorrow. An early try is practice only." (or the due date instead of "tomorrow"). Leaving with an unsent answer, or an edited unsent revision, asks first. For a dialogue drill the page says under the answer box that one or two follow-up questions come before the result. After the opening answer the right side is a short thread (your answer, then the interviewer's question, in order, every line rendered as text), a "Your reply" box, "Send reply" and the line "Question 1 of up to 2"; the countdown keeps running, and leaving with an unsent reply asks first. A reload continues the open attempt from the prompt's `open` block, and a quiet "Start over" asks first, then abandons it. The result screen of a dialogue drill has no revise button and shows "The conversation", the turns in order, below "Your line". The result screen shows the outcome (Interview-ready, Getting there or Needs work) as its title, the problem, Interview-ready results with the pips and when the drill comes back, a list of the criteria (label, a four-step meter, the score as "n of 4", core criteria marked; the meter is green at 3 or 4, amber at 2 and red at 1, the same tones as the Progress skill rows), "What went well", "What to improve" and "Your line". When a revision is allowed, "Revise your answer" is the primary button: it shows the answer box again with the first answer in it and the feedback beside it, and "Submit revision" grades it once. After a revision the result shows the final outcome and "After a revision. First try: <outcome>.". Without a revision, the one primary button is "Next drill" when another is due, else "Back to Practice".
- The fake agent grades by word overlap with the key (three or more long key words score every criterion 3, one or two lift only the first core criterion to 2, none scores core criteria 1 and the rest 2), so the whole flow runs without a model.

**Drill history `/practice/drills/:drillId`**
- A page in the normal frame (the main bar marks Practice) with a back link to Practice, Drills. The header names the gap, the drill kind and the status ("Open" or "Closed"), with "Start drill" while it is open, and under it the same early note when the drill is not due yet. A facts card shows the Interview-ready results with the pips, when the drill comes back ("Gap closed" once closed), the problem of the next attempt (with the "Changed constraint" tag) and the problems it has used, then the problems and changed constraints it earned a ready result on.
- Below it, the attempts as a list, newest first: date, problem (with the "Changed constraint" tag), the outcome label (with "after a revision" when it was revised), a compact strip of the score of each criterion (the same tones as the meters), the time taken and the cost from the usage ledger (a missing time or cost is left out, and a row with no scores, time or cost says "No scores, time or cost recorded" once). A row is a button (`aria-expanded`) that opens in place and then loads the attempt: the task, "What changed" (rendered as the brief's Markdown), each answer (first try and revision) or the conversation turns, the criteria meters, "What went well", "What to improve", "Your line", and "What a strong answer says" only when the server sent it. A revised attempt shows both grades. An attempt with no body says "No detail was saved for this attempt." Every model line renders as text.
- Loading shows skeletons; a failed read shows an alert with "Try again"; an unknown drill says it is not in the schedule; a drill with no attempt says so.
- Practice, Drills links to it: the hero and each "Also due" row carry a "History" link, a "Closed drills" card below them lists the closed drills (five, then "Show all N"), and a "Recent attempts" card lists the newest 20 attempts of every kind, free drills included, with the same expanding rows and, for a queued drill, a link to its history.

**Progress, DSA `/progress#dsa`**
- DSA measures the current pass, never the account's history. A hero shows "Mediums this week" as N of the weekly goal,
  "N problems this week" under the number and a Monday-first strip captioned "Problems solved each day" (days that are DSA days in the weekly plan are outlined and a small legend says so; today has a ring outside the cell) and
  one primary button, "Open LeetCode" (`https://leetcode.com/problemset/`, new tab, `rel="noopener noreferrer"`). The side
  card "This pass" says "N problems since <date>" and lists "Not touched yet": the common interview topics with no
  solve in the ledger (Array, String, Hash Table, Two Pointers, Sliding Window, Stack, Binary Search, Linked List, Tree,
  Graph, Heap, Backtracking, Dynamic Programming, Greedy, Trie, Union Find). When all have a solve it is "Fewest solved",
  the three lowest as bars. "All topics and problems" opens a side panel with solved by difficulty since the date, every
  topic from the ledger as bars, the recent solves (each links to the problem) and, at the bottom, "Lifetime on LeetCode:
  N solved, includes earlier years". The header carries an info tip (counts of practice, not a readiness call) and "From
  LeetCode, read <time>" with a tip (public profile, the last numbers stay when a read fails, no login). States: no
  username (button to Settings), not found ("No public LeetCode profile named X"), stale (the numbers with the date of
  the last read, the reason in one sentence, a quiet note and "Read again", which stays disabled with "Try again in N s"
  until the server allows a read), error with no data ("LeetCode could not be read", "Read again").
- Today on a DSA day adds "N of goal mediums this week" under the hero text.

**How DSA is read.** The server calls `POST https://leetcode.com/graphql` (fixed host, no login, a generic user agent, 8 s
  timeout, no redirects, 512 KiB reply cap, every reply checked with a strict zod schema). The endpoint is unofficial and can
  change. It reads `matchedUser` (lifetime totals), `recentAcSubmissionList` (only the newest 20 accepted solves) and
  `question` (difficulty and topic tags, once per problem and kept for good). Each read merges the new solves into a ledger
  keyed by problem and time and keeps repeat solves of one problem as separate entries. The ledger holds the newest 5000
  entries and is not cut at `dsaCountFrom`; the response filters by that day, so moving it later and back loses nothing.
  A problem LeetCode returns nothing for is cached as missing and counted as "not read yet". The last failed read is saved
  with its reason, so a restart still knows why the numbers are old. More than 20 solves between two reads can be missed. The ledger and the problem cache live in
  `data/leetcode.json` (written atomically; an invalid file is ignored and rebuilt). At most one read runs per username,
  a read happens at most every 15 minutes, and the server reads once at start when a username is set. The week counts distinct problems since local
  Monday 00:00; topic counts and the pass count distinct problems since `dsaCountFrom`. A change of username starts a new ledger.

**Room `/session/:id`** (status `live` or `paused`)
- Top bar: title, mode chip, the phase rail (click a phase to move there; shows each phase's planned minutes;
  the current phase is highlighted; time spent so far per phase), the timer (`mm:ss` left; amber under 5 min;
  red at 0; counts up in guided mode), "Pause" while live and "Resume" while paused (both modes), "End interview"
  and a small "More round actions" menu that holds "Discard round". The confirm for End interview says it ends the
  round and runs the scored debrief. The confirm for Discard round says the transcript, board and score are deleted,
  there is no debrief, the study files are not touched, and, for an LLD round, the attempt file is kept if it has
  code in it. When the server sends `session.discarded`, the page goes to Today. Leaving a live interview round asks
  for confirmation and says the round pauses about a minute after the last tab closes.
- HLD: the board fills the main area; the chat panel is on the right (about 380 px, resizable is optional).
- LLD: the main area has tabs "Code" and "Class diagram" (the board with the LLD palette); the console sits
  under the editor; the chat panel is on the right. A small line shows the attempt file path so the user can
  open it in your editor.
- Chat panel: interviewer messages (Markdown) on the left, the candidate's on the right, system events as
  small grey lines (phase changes, runs, the extension), streaming text with a typing indicator, Enter to send
  and Shift+Enter for a new line, the input keeps focus after sending. Guided mode adds "Check this step", "Hint" and "I'm stuck" buttons; the last two share the disabled rules.
  When the current step has a `pass` and a next step exists, "Check this step" reads "Move on" and sends `phase.set` for
  the next step; he can still go back to a passed step. On the last step it stays "Check this step". Voice dialogue layers on top of text chat: continuous on-device speech-to-text (Ctrl+M or mic button)
  streams live interim transcripts into the input, with either auto-send after 2 seconds of silence or manual review
  before sending. Half-duplex is enabled by default: while a reply is spoken, speech recognition is paused (aborting
  recognition and discarding interim text) so speaker audio is not transcribed into the candidate's box, resuming
  when speaking ends. Pressing Esc or clicking "Stop speaking" interrupts speech output immediately and resumes the mic.
  An "I use headphones" setting enables full-duplex with voice barge-in. Spoken replies stream sentence by sentence
  via local Kokoro neural TTS (with automatic fallback to local speech synthesis), omitting code blocks ("code block omitted")
  and stripping Markdown formatting. Pausing the round halts both recognition and synthesis.
- Step bar: in a guided round the phase rail shows a passed mark per step the guide passed, and the header bar shows
  "n/m passed" beside the timer. An interview round shows neither. Clicking a step moves the phase and brings that step's frame into view; in an LLD round a step
  without a frame brings the Code tab forward instead.
- The work toolbar has "Show this step" (the current step's frame) and "Whole board" while the board is in view.
- Step verdict (live guided rounds only), a card at the top of the chat column, for the current step: "Passed" with a
  check, or "Not yet" followed by the guide's one gap (or, after two of them on a step outside the machine coding
  build steps, the server's count of what is open), shown as plain text. Before the first check it shows nothing.
  The checklist is not shown during the round, in either mode.
- Guided rounds show the guide's pins on the board.
- "What the interviewer sees" toggle: shows the current graph text (and its warnings). It makes the board's
  text form visible, so the user can fix an unlabeled box or a dangling arrow.
- Pause banner, chosen by `pauseReason`, with a "Resume" button on each: `away` says "Paused because the room was
  closed. Resume when you're ready."; `user` says "Paused."; `restart` says "Paused because the app restarted.";
  `error` (also shown whenever `agent.status` is `error`) is the error banner: the plain message and "Retry". Chat,
  "Check this step", "Hint" and "I'm stuck" are disabled while the round is paused.
- Reconnect the WebSocket with backoff; show "Reconnecting…" while down.

**Debrief `/session/:id`** (status `debriefing`, `debriefed`, `failed`)
- While `debriefing`: a progress list from `debrief.progress`.
- Verdict, compact: a small eyebrow, a headline at about 22 px, a coloured bar on the left edge by tone, and small text beside the headline. A guided round with a readiness call asks "Ready for interview mode?" and answers "Ready" or "Not yet", with the confidence beside it and the reasons joined on one or two lines (section 5.7). An interview round, or a guided round saved before the call existed, reads "At the <target level> bar" with the target-level call as the headline (plain labels: "Strong pass", "Pass", "Close, not yet", "Not yet"), the stretch-level call and the confidence as small text, and one plain sentence of meaning. Both level names are the round's own. The judge's summary sits in the Summary card.
- Scores: one strip of equal cells, one per dimension, each with its name, the score out of 4 and a four-segment meter. A score below 3 (the target level bar) is in the warning colour, a score of 3 or more in the success colour. The strip is one target that opens the Evidence tab; a tooltip says that scores run from 1 to 4.
- NEXT: one card that always names one action, with a progress line under it ("Gaps: N of M done" and, when any gap is with the coach, "K with the coach") and a segmented bar. Order: the current gap ("Answer the coach: <gap>" with "Go to chat" when the gap is with the coach, "Start: <gap>" with "Teach me this" when it is not started); when no gap is not started or with the coach, "Draft your study notes" (scrolls to Study notes); once notes are saved, a guided round that is ready gets "Try interview mode" (starts the same problem in interview mode), a guided round that is not yet ready gets "Practise the top gap" (the most serious gap not practised yet; with none, "Back to Today"), and any other round gets "Back to Today". It holds the only filled primary button on the page.
- Gaps to work on, ordered by severity. Each gap is in one of five states, read from `Session.gapProgress` and `Session.gapPractice`: not started (no record), with the coach (`started`, set by the coach or by him, or the "sent" mark), done (`taught`), for later (`core_only`) and practised (a `gapPractice` entry, which wins over any coach record). The current gap is the with-coach gap with the newest record time (the first in severity order when records carry no time), else the first gap not started, else none; a gap that is with the coach is never skipped. Only the current gap is expanded: a state badge, the title, the minutes, "Why it matters", "What good looks like", one button and a menu. Every other gap is one quiet line (a state dot, or a tick for done or practised, title, minutes, chevron) that opens on a click; several may be open. A closed line that is not done also carries its small button ("Teach me this", "Continue in chat" or "Finish the lesson", named with the gap's title for screen readers), so no gap has to be opened to be taught. A severity badge shows only when the gaps differ in severity.

  | State | Badge | Button | Menu |
  | --- | --- | --- | --- |
  | Not started | none | Teach me this | Practise this gap |
  | With the coach | With the coach | Continue in chat (scrolls the coach chat to that gap's "Now on" divider) | Restart lesson, Practise this gap |
  | Done | Done, with a tick | Practise this gap | Restart lesson |
  | For later | Core idea done, rest later | Finish the lesson | Practise this gap |
  | Practised | Practised, with a tick | Open the practice round (a link to the gap round) | Practise this gap |

  "Teach me this", "Finish the lesson" and "Restart lesson" send the same teach message. "Practise this gap" starts a 20-minute guided round on the same problem, aimed at that gap. The gaps step is complete only when every gap is done, for later or practised, and the history counts a practised gap as done, so Today and Progress stop offering it. A session with no records at all (saved before the field existed) is read from its coach chat instead: a "Teach me this" message marks a gap "with the coach".
- Study notes: a short hint, "Draft once the gaps are done. You can draft any time.", until notes have been saved once (`studyNotes.savedAt` is kept when a new draft starts). Drafting is never blocked. A draft says how many changes can be saved, in how many files, and how many cannot be applied; each change's box is named by its summary and file, and a blocked or unsaved change shows its reason. A summary names the change's own content (the sub-bullet text, the gap of a Gaps Found & Filled row, the heading of a REVIEW.md entry, a tracker mark in words), so several changes of one kind read apart. The summary is built from the op after redaction, so shortening it never splits a blocked term.
- Summary: the judge's summary, the strengths and the practice task in one card.
- Details, as tabs. Evidence has a "By step" and "By score" toggle plus the tracker mark in words ("Tracker: partly done") with its reason, where any `[~]`, `[x]` or `[ ]` in a saved reason is written out too, and, for LLD, the demo scenario table (pass or fail with detail). Above the table, each cause that two or more failed scenarios share gets one line, "N of M scenarios fail for one cause: <cause>.", with the scenario names, and a failed row shows its own cause under the detail; a scorecard saved without causes shows the table alone. By score shows each dimension with its score, evidence quotes with "Counts for you" or "Counts against you", the time, and a check mark or a "not found in transcript" warning from `quoteChecks`, and "what a 4 looks like" behind a disclosure. By step shows one card per step that the judge read, that has coverage, pins or notes: the step's frame as an image (exported in the browser from the saved board, cropped to the frame) with every pin numbered at its element, the checklist count with a ring, "What held", "What's missing", "Pinned on the board" and "Your notes from the round". Time shows planned against actual minutes per phase as horizontal bars, then the key moments. "What the judge saw" shows the final board PNG, the graph text, any written step text (read-only, one card per phase with text), LLD final code (read-only Monaco) and the judge's writing checks. "Reference" is closed by default and renders `reference.sections`.
- The coach chat on the right (same chat component, coach channel).
- "Study notes": "Draft study notes" -> the proposal, grouped by file, each op with a checkbox (blocked ops
  shown disabled with the reason), the unified diff per file (green and red lines, monospace), and "Save
  selected". Then a success or failure list. "Draft again" on a stale proposal. After a reload, a round whose notes
  were saved shows "Saved N changes to your study files on <date>" (or "Study notes saved on <date>" after a newer
  draft that saved nothing yet) with a "Draft again" button.

**Usage `/usage`**
- Linked from the Menu in the main bar, next to Settings.
- Totals: API-equivalent cost, input tokens, output tokens, cache hit rate, number of model calls, rounds tracked (rounds with calls in the ledger that are still saved, with "N discarded, cost kept" beside it when a discarded round spent calls). The
  ledger records a failed call as a row with `ok: false` (a row without `ok` reads as ok), and the totals count
  these as `failedCalls`, shown beside the call count. A model process that stops without a result still writes
  such a row. It carries the tokens of the assistant messages seen until then (each message id counted once) and
  is priced from them with `costEstimated: true`; with none seen, it has zero tokens, cost 0 and no estimate. A
  call the app closes or aborts itself, or one cut off when the server stops, writes no row. When the SDK gives
  no cost, the row is priced from its tokens with `costEstimated: true`, and an older row with tokens and a
  stored cost of 0 is priced at the dearest model the same way. The totals count these as `estimatedCalls`, and
  the cost shows "≈" when any call is estimated, with one line under it that says how many calls are priced from token counts. Days are bucketed in local time.
- Cost per day bar chart (last 30 days, plain SVG/CSS bars).
- A Drills section: drill cost, attempts and grader calls; a table by drill kind (the drill's title, or "Earlier drills" for rows without a kind) and a table by attempt (date, drill kind, problem, calls, cost) that shows the first 20 and a control to show the rest. With no drill call it shows one line saying so. Grader calls recorded before attempts had ids count in the totals and by kind, and appear as one note under the tables.
- Tables by problem (with separate rounds cost and drills cost beside the total, then a row for preparing your own questions (its split columns show a dash) and, if any, one for other calls, so the rows add up to the total), by round (each row of a kept round links to that round's debrief; a discarded round is marked and not linked), by role and by model.
- Drills: the Attempts figure counts graded drills that are still on record, and a line below says how many drills were not finished (started over, failed or still open) and what they cost. Legacy attempts (saved before costs were recorded) stay in the drill history and in the week count on Progress but have no cost, and a line says so, also when no drill has a call.
- Informational notes explaining API-equivalent cost vs Claude plan limits and tracking start date.
- Friendly empty state when no calls have been logged yet.

**Settings `/settings`**
- A left section nav (Weekly plan, DSA and LeetCode, Rounds, Models, Voice and theme, Study folder) and one "Save changes"
  button. Edits stay in a draft until Save; the theme applies on save. Sections: the weekly plan (one choice per day, with
  a reset to the default plan); the LeetCode username (1 to 40 letters, digits, underscores or hyphens, with "Profile found" or "No public LeetCode profile has this name" after the next read), "Count solves from" (a date input, not in the future; defaults to the day the username is first saved) and the weekly DSA goal; the HLD and
  LLD round lengths; models and effort per role; theme and voice options (speak replies on or off, speed, "I use
  headphones", and the voice input send mode: review before sending or auto-send after a pause); the study root path.
  Server settings are saved with PUT; voice options are stored in browser local storage. Leaving with unsaved edits asks
  "Leave without saving?" first, whether by an in-app link, the browser's Back or Forward (the router puts the settings
  address back and asks), or a reload or closed tab (the browser's own prompt).

### 12.2 Data flow

- `src/web/backend.ts` (not `api.ts`: the dev server's `/api` proxy would capture that path): `getBootstrap()` once (keep the CSRF token in memory only, never in storage), REST
  helpers that send `x-csrf-token`, and a `SessionSocket` class: connect, hello, typed `on(type, handler)`,
  `send(msg)`, reconnect with backoff, and a `connected` flag.
- Browser code imports only types from `src/shared/protocol.ts` and `types.ts`. Importing their values pulls in
  zod, whose load-time `eval` probe trips the CSP, so constants the browser needs live in `src/web/lib/contract.ts`.
- One hook per session page holds `PublicSession` plus streaming buffers. `chat.delta` appends to a
  temporary message; `chat.message` with the same `entry.id` replaces it.
- When the board calls `onSceneChange`, send `board.update`. When the server sends `board.png.request`, call
  the board's `exportPng(frameId)` and answer `board.png.result` (or the error).
- The session page loads the saved board for every status, so the debrief can draw each step's frame. When a round
  ends in the same page, the last scene the board reported replaces the loaded one.
- LLD: editor changes are sent as `code.update` debounced 500 ms. `code.diagnostics` and `code.run.result` feed the
  editor markers and the console. The editor and the file can both change (an outside edit bumps the server's
  version, and a dropped socket can lose updates), so the page keeps a ledger of the last text the server is known
  to hold and the texts it sent since, and settles by one rule: when the editor holds nothing the server lacks,
  the file's text replaces the editor value (`code.external` live, the fetched file after a reconnect or a
  `code.rejected`); when both changed, the editor text wins, is sent again above the server's version, and the
  page shows a notice that the file changed outside the editor and the editor text was kept. On `code.rejected`
  the page fetches the file and settles the same way, unless a newer text of its own is already sent or waiting.
- Test hooks with `?testhooks=1`: `window.__irShell = { sendChat(text), state() }`.

---

## 13. Content: prompts and rubrics (PROMPTS agent)

Files in section 5.3. Write for Claude Opus 5.5: direct, specific, with the reason behind each rule, no
shouting. Every role prompt:
- States the role and who the candidate is (`{{candidate_profile}}`).
- Says never to mention the user's email address, employer or any company, product or service names from
  automatic context, and to use plain technology names (Postgres, Kafka, Redis, Kubernetes).
- Describes the envelope (section 5.4) and the `<silent/>` rule where relevant.

Interviewer (interview mode), from TEACHING.md section 10 and the research:
- Opens with the brief's "Opening prompt", nothing else.
- 1 to 3 sentences per turn, one question at a time. Neutral acknowledgements only ("okay", "go on"). No
  praise, no pass or fail signals, no lectures, no bullet lists, no teaching, no rescuing while the clock runs.
- Before the candidate has asked anything, gives no fact and no leading probe; a design that starts at once gets a
  neutral reply such as "Wherever you like.", and a wrong assumption still gets its one-line correction.
- Answers clarifying questions from "Hidden facts", only what was asked. Invents a sensible fact consistent
  with the brief when asked something the brief does not cover, and keeps it consistent afterwards.
- Lets the candidate drive. Probes the biggest gap first, from the candidate's own words, one level deeper.
  Never invents a flaw; checks whether a point was already covered before raising it; raises each point once.
- Accepts any valid design: judges against the requirements, not the reference design.
- Uses the hint ladder only when the candidate is clearly stuck for a while (H1 points at an area, H2 names the
  concern, H3 offers two options) and records each with `note_hint` at the level it reads as (once it is
  unsticking him, a line that names the concern is an H2; outside a stuck moment the extension, the concurrency
  follow-up, "where does it break first" and a deeper probe are not hints), calling it before the reply text.
- Time: nudges at phase overruns via clock events (in a guided round, one offer to move on once his time in a step reaches twice its plan); checks in once, with no hint, when the silence event says he has been quiet; delivers the extension when told; closes once, without feedback.
- LLD: answers C++ syntax questions at once with a tiny snippet; never writes the candidate's design or
  code; may ask "run it and show me" and use `run_code`/`read_code` near the end; asks the concurrency
  follow-up if time allows.

Guide (guided mode), modelled on step-by-step guided practice:
- Works through the phase rail one step at a time. Asks the candidate for the step's output, then gives
  feedback on that step only when asked ("Check this step") or when the candidate says they are done with it:
  one thing that holds, then a `step_verdict`. Gives hints on request, one rung at a time.
- Checks in once, with no hint, when the silence event says he has been quiet, and says in one line when the round
  reaches its planned length, leaving him the choice to finish the step or end the round.
- Checks requirements against the brief's Core items and the Level bar; a missing Extra is never a gap. When a step
  meets the Level bar it calls `step_verdict` with `pass` and says so plainly; it never says "nearly done" or "close to
  done". Otherwise it names exactly one gap, the most important, as a missing question or a missing decision and not
  its answer, until the step's checks give only a count. It never raises a passed step again, and small items go to the debrief. In the deep dives, numbers need to
  be right to an order of magnitude, and only the numbers that drive a decision need their consequence.
- Gives a model answer only through "I'm stuck": about 150 words with no tables or quizzes, a line asking him to redo
  the step, never a `pass` and never a `note_hint`. A chat request for the answer ("just tell me", "teach me", "which
  classes do I need") or "no idea" gets one "Give me your first try, even a wrong one", then the next rung of the
  hint ladder; after H3 it points at "I'm stuck". In machine coding a syntax question is answered at once, and a
  design question gets one question, then a hint rung. After a step's second "Not yet" it says how many things are
  still open and names none, except on the machine coding build steps, where it still names the exact cause of a
  failing compile or run. Longer teaching waits for the coach after
  the round (TEACHING.md section 1 and 5). Keeps TEACHING.md section 2's prose rules.
- Knows how the step checklist works: a separate checker fills it from his chat in the step, the step's frame, his
  written answer for the step and, in LLD, the code he wrote while the step was on the rail (build steps read the
  whole file); every tick needs a quote the
  app finds there; it is evidence for the guide and feeds the debrief's step cards and the study-notes draft; he does
  not see it during the round; nobody ticks an item by hand. The guide's `step_verdict` is the call he sees, and the
  server refuses a pass the reading does not support. When the reading lags his work, the guide calls `recheck_step`
  for that step and never moves the rail to refresh it.
- Passes a step only on evidence: what he said in the step's chat, drew in its frame or wrote in its written answer
  (and, in LLD, typed and ran). A promise ("I will rename it") is not evidence, and a verdict changes only when the
  evidence changes. Chat counts as much as the frame, so it never asks him to copy a line onto the board. Before the
  last step's pass and before "press End" it names the steps not passed yet, from the `steps:` line.
- Answers an off-topic question with one line (after the round), then asks the open question again. After a right
  answer it says what holds and asks the next question, without adding the next level of the answer. It never writes
  the app's inner words: "the brief", "the checker", "the checklist", "the level bar", a level name or a hint name.
- The candidate moves the rail. The guide never calls `set_phase` in a reply to "Check this step"; it says the step
  passed and lets him move. It calls `set_phase` only when he says he is moving on or asks it to move the rail, or
  when his work has clearly sat in another step for a few minutes while the rail lags.

Tester (LLD): adapts each "Demo scenarios" item to the candidate's real classes and method names, writes one
harness, runs it, and reports per scenario. Never edits the candidate's file. If the candidate's API cannot
express a scenario, the scenario fails with the reason ("no way to exit with a ticket id"). Scenarios that fail for one
bug share one `cause` text.

Judge: scores strictly from evidence against `{{rubric}}` and the brief's "Level bar". Every score cites
verbatim quotes. Default to 2 until the evidence shows each 3-level signal, or all but one with the rest clear and
strong, in which case the missing signal becomes a low gap; real panels weigh the evidence as a whole. A missing
Extra requirement is never a gap. Politeness, length and confidence
never raise a score. Accept valid alternative designs. Hints given cap the related dimension (H2 caps at 3, H3
caps at 2). Guided rounds always get `trackerMark: "[~]"`. Interview rounds get `[x]` only when the round
finished in time, (LLD) the code compiled and passed the core scenarios, and no gap sits at the target level bar.
Writes `verdict.summary`, strengths and gaps in plain sentences that follow TEACHING.md section 2 (no
symbols in prose, at most one em-dash per paragraph).

Coach: follows `{{teaching_md}}` exactly (sections 0 to 3, 5, 10 and 12 matter most): teach each gap
directly, about ten minutes each, at most 300 words per turn, two or three ideas, then a question, diagrams
in fenced ASCII blocks, technology names only. May show a clean version of the part that went wrong (LLD) but
never rewrites the candidate's whole solution.

Scribe: produces ops (section 10) that follow TEACHING.md section 13 exactly. The notes file is reference
material for the problem, never a record of the round: built from the problem brief, the coach's lessons and
the scorecard's model answers, in a neutral voice, holding the prompt and questions to ask, requirements, the
capacity math or entities, the API, the reference design with a diagram, deep dives, accepted alternatives,
the extension, numbers, the tradeoff, where it breaks, the 60-second answer, the follow-up, the traps and the
target level bar. His run goes only into the tracker mark and suffix, a Session Log row in the existing style, a
REVIEW.md entry with three or four recall questions in the existing format, Gaps Found & Filled rows for
prerequisites that were taught, and `(added)` sub-bullets for real new gaps. When the notes file exists, the
scribe appends only reference material the file lacks, under a topic heading, or sends no notes op. Never rewrites or reorders tracker topics.

Brief-writer: turns a pasted prompt into a problem file with every required section (`{{section_list}}`),
using `{{example_problem}}` as the model for depth and tone.

Rubrics (`content/rubrics/hld.md`, `lld.md`): one section per dimension id (section 5.3), each with what a 1,
2, 3 and 4 look like at the target level bar and the red flags, plus the decision rules (`hire` at the target level, shown as "Pass": no
1s, the two core dimensions at 3 or more, at least four dimensions at 3 or more; LLD: working code below 3 caps the
verdict at `lean_no_hire`, shown as "Close, not yet"; concurrency scored only when relevant or asked). The rubric files
keep the judge's own terms; the screen shows the plain labels from `src/web/lib/verdict.ts`: `strong_hire` is "Strong
pass", `hire` is "Pass", `lean_no_hire` is "Close, not yet" and `no_hire` is "Not yet".

`content/candidate.md`: a short, neutral profile from TEACHING.md (experience, stack by technology name,
target role, his HLD and LLD methods, LLD in C++ with the agreed subset, and patterns to watch such as putting
the benefit in the cost slot of a tradeoff sentence, copy instead of reference, and `->` on an empty
`optional`). No employer or service names.

---

## 14. Testing and acceptance

Every agent: `npm run typecheck` passes, `npm test` passes, no edits outside owned paths, no new dependencies,
code comments follow the house rule (explain why, never what; no process or plan references; no persona
markers).

- MODULES: unit tests for the graph builder (every rule in 7.2), clang parsing (real Apple clang output
  captured from this machine), quote checks, prose lint, tracker parsing and every bookkeeping op against a
  temp copy of the real `TRACKER.md`, `REVIEW.md` and notes (copied into a temp folder by the test, never
  written in place), stale-hash refusal, the privacy guard, and the C++ runner (compile error, run, timeout,
  output cap, harness include trick, sandbox denies a write outside the folder and a network connect, a fork
  bomb and a `setsid()` child are stopped, a file over 16 MB and memory over the cap are stopped, and the compile
  sandbox refuses an `#include` or `.incbin` of a file outside the build folder and builds a normal program).
- ENGINE: with `SPARMATE_FAKE_AGENT=1`, `scripts/e2e/ws-fake-round.mjs` drives an HLD and an LLD round over the
  WebSocket (hello, chat, board update, code update and run for LLD, phase change, end), waits for the
  debrief, drafts bookkeeping against a temp `STUDY_ROOT`, applies it, and checks the files changed exactly as
  planned. `scripts/e2e/ws-fake-pause.mjs` runs the server with `SPARMATE_AWAY_MS` shortened and checks the user pause and
  resume in both modes, the away pause (and that a quick reconnect cancels it), discard over the WebSocket and over
  REST with the session folder gone afterwards, and the attempt-file rule for LLD rounds. Plus one real-model smoke script, `scripts/e2e/ws-real-smoke.mjs`, that runs three interviewer turns
  and a judge call on the URL shortener and prints timings.
- SHELL and WORKSPACE: `npm run build` succeeds; with the server in fake mode, the pages work in headless
  Chrome (`scripts/smoke-ui.mjs` shows the pattern: system Chrome through `puppeteer-core`, external requests
  blocked, console errors collected; ignore CSP reports for `https://esm.sh/` fonts, which Excalidraw lists as a
  fallback and the CSP blocks on purpose).
