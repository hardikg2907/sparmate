import type { Mode } from "../../shared/phases";
import type { BoardPin, PublicSession, Scorecard, TranscriptEntry } from "../../shared/types";
import { HLD_CHECKLIST, HLD_GRAPH_TEXT, LLD_CHECKLIST, LLD_GRAPH_TEXT, buildSession, coachEntry, entry, fixtureSteps, type FixtureChecklist } from "./sessions";

const pin = (id: string, elementId: string, phase: string, tone: BoardPin["tone"], note: string): BoardPin => ({
  id,
  elementId,
  phase,
  note,
  tone,
  by: tone === "note" ? "guide" : "judge",
  at: 0,
});

/** What the guide pinned while checking steps; an interview round gets none. */
const HLD_GUIDE_PINS: BoardPin[] = [
  pin("g1", "redis", "design", "note", "No eviction policy or TTL is stated for Redis."),
  pin("g2", "keygen", "design", "note", "Where do short codes come from? Nothing joins the key generator yet."),
];
const LLD_GUIDE_PINS: BoardPin[] = [pin("g1", "ticket", "entities", "note", "Who closes a ticket, and can it close twice?")];

const HLD_JUDGE_PINS: BoardPin[] = [
  pin("j1", "req-latency", "requirements", "held", "The latency target has a number and a percentile."),
  pin("j2", "ent-clicks", "entities", "gap", "Say whether ClickCount is a counter or aggregated click events."),
  pin("j3", "pg", "design", "held", "The read path is clear: a cache miss falls back to Postgres."),
  pin("j4", "redirect", "design", "gap", "Say what happens when a redirect service instance dies."),
  pin("j5", "redis", "design", "gap", "No eviction policy or TTL for the hot set."),
];
const LLD_JUDGE_PINS: BoardPin[] = [
  pin("j1", "spot-free", "behaviour", "held", "The two spot states and the move between them are drawn."),
  pin("j2", "lot", "entities", "gap", "exit() trusts any ticket id, so an unknown ticket frees a spot."),
];

/** The debrief sees more of the round covered than the room does halfway through it. */
const HLD_DEBRIEF_CHECKLIST: FixtureChecklist = {
  items: HLD_CHECKLIST.items,
  cover: {
    ...HLD_CHECKLIST.cover,
    "requirements-6": ["covered", "chat", 90],
    "design-1": ["covered", "chat", 1012],
    "design-2": ["partial", "board", null, "the key generator is not joined"],
    "deep_dives-1": ["covered", "chat", 1500],
    "deep_dives-2": ["partial", "chat", 1800, "no plan for a Redis outage"],
    "deep_dives-4": ["covered", "chat", 2520],
  },
};

const MIN = 60_000;

// ---------------------------------------------------------------------------
// HLD, in the middle of a round

export function hldRoom(mode: Mode, status: "live" | "paused" = "live", pauseReason?: PublicSession["pauseReason"]): PublicSession {
  const roundMs = 17.5 * MIN;
  const base = Date.now() - roundMs;
  const guided = mode === "guided";
  const e = (id: string, at: number, role: TranscriptEntry["role"], text: string, extra?: Partial<TranscriptEntry>) => entry(base, id, at, role, text, extra);
  const transcript: TranscriptEntry[] = [
    e("t1", 0, "interviewer", "Let's design a URL shortener, something like bit.ly. Where would you like to start?"),
    e("t2", 20, "candidate", "Before I design anything, I want to pin down scope. Who creates links, and do we need custom aliases?"),
    e("t3", 38, "interviewer", "Anyone with an API key can create links. A custom alias is optional. An expiry date is optional too."),
    e("t4", 72, "candidate", "Next, scale. How many new links a month, and what is the read to write ratio?"),
    e(
      "t5",
      90,
      "interviewer",
      "About 100 million new links a month. Roughly 100 redirects for every link created.",
      guided
        ? {
            blocks: [
              {
                kind: "kv",
                rows: [
                  { key: "New links", value: "100M / month (~40 writes/s)" },
                  { key: "Redirects", value: "10B / month (~4,000 reads/s)" },
                  { key: "Read : write", value: "100 : 1" },
                ],
              },
            ],
          }
        : undefined,
    ),
    e("t6", 276, "system", "Moved to Core entities", { kind: "phase" }),
    e(
      "t7",
      290,
      "candidate",
      "I see two nouns. A Link holds the code, the long URL and the expiry, which means it is the row every redirect reads. A ClickCount holds one counter per code, which means clicks stay off the hot row.",
    ),
    e("t8", 322, "interviewer", "Okay, go on."),
    e("t9", 432, "system", "Moved to API", { kind: "phase" }),
    e("t10", 470, "candidate", "POST /v1/links takes the long URL, an optional alias and an optional expiry. GET /{code} answers with a redirect."),
    e(
      "t11",
      505,
      "interviewer",
      "Why a `302` and not a `301`? Think about what each one lets the browser do.",
      guided
        ? {
            blocks: [
              {
                kind: "options",
                items: [
                  {
                    label: "302 Found",
                    note: "Browsers hit our redirect service each time so clicks count and deletes take effect",
                    reply: "A 301 gets cached by browsers, so I could not count clicks or delete a link quickly. So I pick 302.",
                  },
                  {
                    label: "301 Moved Permanently",
                    note: "Browsers cache the destination indefinitely and bypass our servers",
                    reply: "I would pick 301 so repeat visits stay off our servers even if click counts lag.",
                  },
                ],
              },
            ],
          }
        : undefined,
    ),
    e("t12", 540, "candidate", "A 301 gets cached by browsers, so I could not count clicks or delete a link quickly. So I pick 302."),
    e("t13", 684, "system", "Moved to High-level design", { kind: "phase" }),
    e("t14", 720, "candidate", "My design has a CDN in front, then a stateless redirect service, Redis for the hot set, and Postgres as the source of truth. Let me draw it."),
    e(
      "t15",
      1000,
      "interviewer",
      "Walk me through one redirect, start to finish.",
      guided
        ? {
            blocks: [
              {
                kind: "anchor",
                target: { kind: "board", elementId: "redis" },
                label: "Redis hot-set cache",
                note: "Pinned note: state the TTL and what happens on a miss",
              },
              {
                kind: "options",
                action: "prefill",
                items: [
                  {
                    label: "Trace a hot-set cache hit first",
                    note: "Client -> CDN -> Redirect service -> Redis -> 302",
                    reply: "On a cache hit, the client hits the CDN, reaches a stateless redirect server, reads the long URL from Redis, and gets a 302.",
                  },
                  {
                    label: "Trace a cold miss all the way to Postgres",
                    note: "Include populating Redis and handling an expired row",
                    reply: "On a cache miss, the redirect server checks Redis, falls back to Postgres by primary key, populates Redis with a TTL, and returns 302.",
                  },
                ],
              },
            ],
          }
        : undefined,
    ),
  ];
  return buildSession({
    id: "20261030-1015-c2-url-shortener-fx01",
    problemId: "c2-url-shortener",
    title: "URL Shortener",
    track: "hld",
    mode,
    durationMin: 45,
    roundMs,
    status,
    pauseReason,
    phase: "design",
    phaseHistory: [
      { phase: "requirements", at: 0, by: "candidate" },
      { phase: "entities", at: 276_000, by: "candidate" },
      { phase: "api", at: 432_000, by: "candidate" },
      { phase: "design", at: 684_000, by: "candidate" },
    ],
    transcript,
    graphText: HLD_GRAPH_TEXT,
    steps: fixtureSteps(HLD_CHECKLIST, status, roundMs - 12_000),
    pins: mode === "guided" ? HLD_GUIDE_PINS : [],
  });
}

// ---------------------------------------------------------------------------
// LLD, in the middle of a round

export function lldRoom(mode: Mode, status: "live" | "paused" = "live", pauseReason?: PublicSession["pauseReason"]): PublicSession {
  const roundMs = 38.3 * MIN;
  const base = Date.now() - roundMs;
  const e = (id: string, at: number, role: TranscriptEntry["role"], text: string, extra?: Partial<TranscriptEntry>) => entry(base, id, at, role, text, extra);
  const transcript: TranscriptEntry[] = [
    e("t1", 0, "interviewer", "Design a parking lot. Build it as a running, in-memory C++ program, with a `main()` that shows it working."),
    e("t2", 25, "candidate", "Can two gates use the lot at the same moment, and does the driver pick the spot or does the system?"),
    e("t3", 48, "interviewer", "Entrances and exits run at the same moment. The system picks the spot."),
    e("t4", 80, "candidate", "How is the fee worked out, and does a lot ever have more than one floor?"),
    e("t5", 110, "interviewer", "A rate per vehicle type per hour, every started hour counts. Several floors, and the count must not be fixed in code."),
    e("t6", 380, "system", "Moved to Entities", { kind: "phase" }),
    e("t7", 420, "candidate", "Nouns: vehicle type (enum), spot, ticket, lot, pricing. The ticket is the hidden one: it ties a spot to an entry time."),
    e("t8", 1090, "system", "Moved to Behaviour", { kind: "phase" }),
    e("t9", 1780, "system", "Moved to Skeleton", { kind: "phase" }),
    e("t10", 2210, "system", "Moved to Thin slice", { kind: "phase" }),
    e("t11", 2260, "system", "Ran the code: compile failed with 1 error.", { kind: "run" }),
    e("t12", 2280, "candidate", "Right, I called exit before writing it. I will add it now."),
  ];
  return buildSession({
    id: "20261030-1020-b3-parking-lot-fx02",
    problemId: "b3-parking-lot",
    title: "Parking Lot",
    track: "lld",
    mode,
    durationMin: 120,
    roundMs,
    status,
    pauseReason,
    phase: "thin_slice",
    phaseHistory: [
      { phase: "clarify", at: 0, by: "candidate" },
      { phase: "entities", at: 380_000, by: "candidate" },
      { phase: "behaviour", at: 1_090_000, by: "candidate" },
      { phase: "skeleton", at: 1_780_000, by: "candidate" },
      { phase: "thin_slice", at: 2_210_000, by: "candidate" },
    ],
    transcript,
    graphText: LLD_GRAPH_TEXT,
    steps: fixtureSteps(LLD_CHECKLIST, status, roundMs - 40_000),
    pins: mode === "guided" ? LLD_GUIDE_PINS : [],
  });
}

// ---------------------------------------------------------------------------
// HLD debrief

export const HLD_SCORECARD: Scorecard = {
  verdict: {
    sde2: "hire",
    senior: "lean_no_hire",
    confidence: "medium",
    summary:
      "You led the early phases well. You asked targeted scope questions and turned each number into a design decision. You chose a 302 and gave two reasons.\n\nThe first design was complete in time. The depth was thinner. When asked how codes stay unique across 6 billion links, you named a counter but did not say how several servers would share it. You handled cache failure only after a nudge.",
  },
  dimensions: [
    {
      id: "navigation",
      name: "Problem navigation",
      score: 3,
      evidence: [
        { quote: "Before I design anything, I want to pin down scope. Who creates links, and do we need custom aliases?", source: "candidate", at: "00:20", polarity: "plus" },
        {
          quote: "I see two nouns. A Link holds the code, the long URL and the expiry, which means it is the row every redirect reads.",
          source: "candidate",
          at: "04:50",
          polarity: "plus",
        },
        { quote: "I will leave out real-time analytics for now and keep a click count.", source: "candidate", at: "02:05", polarity: "plus" },
      ],
      whatA4LooksLike: "A 4 names early that the redirect path is the hard part, states the latency target in numbers before drawing, and lists what is out of scope.",
    },
    {
      id: "design",
      name: "Solution design",
      score: 3,
      evidence: [
        { quote: "A 301 gets cached by browsers, so I could not count clicks or delete a link quickly. So I pick 302.", source: "candidate", at: "09:00", polarity: "plus" },
        { quote: '[Redirect service] -> [Redis] "lookup"', source: "board", at: "", polarity: "plus" },
        { quote: "Postgres stores the code, the long URL and the owner id. I have not decided the index yet.", source: "candidate", at: "15:10", polarity: "minus" },
      ],
      whatA4LooksLike: "A 4 picks the storage from the access pattern, says why the code is the primary key, and handles duplicate creates with an idempotency key.",
    },
    {
      id: "depth",
      name: "Technical depth",
      score: 2,
      evidence: [
        { quote: "I would use a counter and base62 encode it.", source: "candidate", at: "21:30", polarity: "minus" },
        { quote: "We can add more counters later if needed.", source: "candidate", at: "22:05", polarity: "minus" },
        { quote: "Redis holds the hot set, about 50 GB, so a small cluster is enough.", source: "candidate", at: "13:20", polarity: "plus" },
      ],
      whatA4LooksLike: "A 4 explains how several servers hand out ids without clashing, names the cost of the choice, and says what it gives up.",
    },
    {
      id: "scale_reliability",
      name: "Scale and reliability",
      score: 2,
      evidence: [
        { quote: "If Redis goes down, I guess the redirects go to Postgres.", source: "candidate", at: "29:40", polarity: "minus" },
        { quote: "A viral link is a hot key, so I would add a small in-process cache on each redirect server.", source: "candidate", at: "31:00", polarity: "plus" },
      ],
      whatA4LooksLike: "A 4 raises the cache failure unprompted, sizes the load that lands on Postgres in numbers, and names a way to degrade.",
    },
    {
      id: "communication",
      name: "Communication",
      score: 3,
      evidence: [
        { quote: "Let me walk one redirect through every box: client, CDN, redirect service, Redis, then Postgres on a miss.", source: "candidate", at: "17:20", polarity: "plus" },
      ],
      whatA4LooksLike: "A 4 signposts each move, checks in at each decision, and adapts when the interviewer adds a constraint.",
    },
    {
      id: "drive_time",
      name: "Driving and time",
      score: 4,
      evidence: [{ quote: "I have 20 minutes left, so I will do two deep dives: code generation and the cache.", source: "candidate", at: "24:00", polarity: "plus" }],
      whatA4LooksLike: "A 4 sets the agenda for the deep dives, finds the limits of its own design, and keeps every phase near its plan.",
    },
  ],
  strengths: [
    "You turned each number into a design decision, and said so with the words 'which means'.",
    "You chose a 302 and gave two reasons: click counting and fast deletion.",
    "You managed the clock and offered a plan for the deep dives without being asked.",
  ],
  gaps: [
    {
      title: "Unique codes across several servers",
      severity: "high",
      whyItMatters: "Every link needs a code that is never reused. One counter is a single point of failure, and it becomes a bottleneck once several servers create links.",
      whatGoodLooksLike: "Give each server a block of ids from a small coordinator, encode the id, and say what happens when a server dies holding an unused block.",
      teachMinutes: 12,
    },
    {
      title: "What happens when the cache tier is gone",
      severity: "medium",
      whyItMatters: "A cache hides load. When it vanishes, the database takes about 100 times more reads than it was sized for.",
      whatGoodLooksLike: "State the load on Postgres in numbers, then name a way to protect it, such as a request limit, or a warm standby cache.",
      teachMinutes: 14,
    },
    {
      title: "Index and key choice for the links table",
      severity: "medium",
      whyItMatters: "The redirect path is a lookup by code. The wrong key turns a point read into a scan.",
      whatGoodLooksLike: "Make the code the primary key, explain why, and say what the owner id index is for.",
      teachMinutes: 8,
    },
    {
      title: "Counting clicks without slowing the redirect",
      severity: "low",
      whyItMatters: "A write on every redirect would put 4,000 writes per second on the database.",
      whatGoodLooksLike: "Count in memory or in Redis, and flush totals in batches.",
      teachMinutes: 6,
    },
  ],
  timeline: [
    { at: "00:20", note: "Asked about scope before drawing anything." },
    { at: "11:24", note: "Started the high-level design, with the API step 12 seconds over its plan." },
    { at: "21:30", note: "Chose a counter for codes without discussing how servers share it." },
    { at: "29:40", note: "First answer on cache failure was thin. It improved after a nudge." },
  ],
  practiceTask: "Redraw the redirect path with the cache tier missing. Write down the p99 and the load on Postgres in numbers.",
  trackerMark: "[~]",
  trackerMarkReason: "Finished in time, but two dimensions are below the bar and one hint was used on cache failure.",
  lldScenarios: [],
  steps: [
    {
      phase: "requirements",
      took: [
        {
          point: "Pinned down scope and latency targets upfront before designing.",
          dimensionId: "navigation",
          evidence: {
            quote: "Before I design anything, I want to pin down scope. Who creates links, and do we need custom aliases?",
            source: "candidate",
            at: "00:20",
            polarity: "plus",
          },
        },
      ],
      missing: ["Did not state availability numbers or error budget."],
    },
    {
      phase: "entities",
      took: [
        {
          point: "Named the two nouns and tied each to how the redirect path reads it.",
          dimensionId: "navigation",
          evidence: {
            quote: "I see two nouns. A Link holds the code, the long URL and the expiry, which means it is the row every redirect reads.",
            source: "candidate",
            at: "04:50",
            polarity: "plus",
          },
        },
      ],
      missing: ["Did not say how ClickCount is updated."],
    },
  ],
  phaseTiming: [
    { phase: "requirements", label: "Requirements", plannedMinutes: 5, actualMinutes: 4.6 },
    { phase: "entities", label: "Core entities", plannedMinutes: 2, actualMinutes: 2.6 },
    { phase: "api", label: "API", plannedMinutes: 5, actualMinutes: 4.2 },
    { phase: "design", label: "High-level design", plannedMinutes: 13, actualMinutes: 12.4 },
    { phase: "deep_dives", label: "Deep dives", plannedMinutes: 20, actualMinutes: 20.2 },
  ],
  quoteChecks: [
    { dimensionId: "navigation", index: 0, verified: true },
    { dimensionId: "navigation", index: 1, verified: true },
    { dimensionId: "navigation", index: 2, verified: false },
    { dimensionId: "design", index: 0, verified: true },
    { dimensionId: "design", index: 1, verified: true },
    { dimensionId: "design", index: 2, verified: true },
    { dimensionId: "depth", index: 0, verified: true },
    { dimensionId: "depth", index: 1, verified: true },
    { dimensionId: "depth", index: 2, verified: true },
    { dimensionId: "scale_reliability", index: 0, verified: true },
    { dimensionId: "scale_reliability", index: 1, verified: true },
    { dimensionId: "communication", index: 0, verified: true },
    { dimensionId: "drive_time", index: 0, verified: true },
  ],
  stepQuoteChecks: [
    { phase: "requirements", index: 0, verified: true },
    { phase: "entities", index: 0, verified: true },
  ],
  lintIssues: [{ field: "verdict.summary", issue: "Paragraph has two em-dashes" }],
};

const HLD_REFERENCE: NonNullable<PublicSession["reference"]> = {
  sections: [
    {
      heading: "Expected requirements",
      markdown:
        "**Functional**\n\n1. Create a short link for a long URL, with an optional alias and expiry.\n2. Redirect a short link to its long URL.\n3. Delete a link. Expired and deleted links stop redirecting.\n4. Keep a basic click count.\n\n**Non-functional**\n\n1. A redirect adds under 50 ms at p99.\n2. 99.99% availability for redirects.\n3. Read-heavy: about 100 reads per write, with viral spikes.\n4. Every code is unique, forever.",
    },
    {
      heading: "Reference design",
      markdown:
        "```\n client -> CDN -> redirect service -> Redis (hot set)\n                       |\n                       +--> Postgres (source of truth)\n\n create service -> id block from coordinator -> base62 -> Postgres\n```\n\nThe redirect service is stateless, so it scales out. The code is the primary key. Each create server holds a block of ids, so no two servers hand out the same code.",
    },
    {
      heading: "Level bar",
      markdown:
        "At the target level, the candidate leads the first four steps, traces one request, and goes deep on one or two points when asked. A candidate at the stretch level raises the cache failure and the hot key without being asked.",
    },
  ],
};

export function hldDebrief(status: PublicSession["status"] = "debriefed"): PublicSession {
  const roundMs = 44.2 * MIN;
  const base = Date.now() - roundMs - 4 * MIN;
  const e = (id: string, at: number, role: TranscriptEntry["role"], text: string, extra?: Partial<TranscriptEntry>) => entry(base, id, at, role, text, extra);
  const c = (id: string, at: number, role: "coach" | "candidate", text: string, extra?: Partial<TranscriptEntry>) => coachEntry(base, id, at, role, text, extra);
  const divider = (id: string, at: number, title: string) => entry(base, id, at, "system", `Now on: ${title}`, { channel: "coach", kind: "gap" });
  const transcript: TranscriptEntry[] = [
    e("t1", 0, "interviewer", "Let's design a URL shortener, something like bit.ly. Where would you like to start?"),
    e("t2", 20, "candidate", "Before I design anything, I want to pin down scope. Who creates links, and do we need custom aliases?"),
    e("t3", 38, "interviewer", "Anyone with an API key can create links. A custom alias is optional."),
    divider("d1", roundMs / 1000, "Unique codes across several servers"),
    c(
      "c1",
      roundMs / 1000,
      "coach",
      "You finished the round in time, and your first design was complete. That is a solid base.\n\nThe main gap is how codes stay unique when several servers create links. Let's start there.\n\nImagine two redirect servers. Each holds a counter at 1,000. Both receive a create request in the same millisecond. What code does each one return?",
    ),
    c("c2", roundMs / 1000 + 40, "candidate", "They both return the same code, I think. So two links would share one short URL."),
    c(
      "c3",
      roundMs / 1000 + 62,
      "coach",
      "Right. That is the clash. Instead of each server owning a shared counter per request, a small coordinator hands each server a disjoint **block** of ids (say 1,000 at a time), and each server counts locally inside its block.\n\nWhat do you think happens to the unused ids in a block when a server crashes?",
      {
        blocks: [
          {
            kind: "diagram",
            layout: "flow",
            title: "Range allocation per create server",
            nodes: [
              { id: "coord", label: "Range coordinator", detail: "leases 1,000 ids" },
              { id: "srvA", label: "Create server A", detail: "1000..1999" },
              { id: "srvB", label: "Create server B", detail: "2000..2999" },
              { id: "pg", label: "Links table", detail: "base62 primary key" },
            ],
            edges: [
              { from: "coord", to: "srvA", label: "lease" },
              { from: "coord", to: "srvB", label: "lease" },
              { from: "srvA", to: "pg", label: "insert" },
              { from: "srvB", to: "pg", label: "insert" },
            ],
          },
          {
            kind: "callout",
            label: "Key invariant",
            text: "Disjoint `[start, end)` leases keep code generation lock-free on the hot write path.",
          },
        ],
      },
    ),
    c("c4", roundMs / 1000 + 100, "candidate", "They are lost, but that is fine. A gap in the codes costs nothing, and the next block starts above the last one."),
    divider("d2", roundMs / 1000 + 130, "What happens when the cache tier is gone"),
    c(
      "c5",
      roundMs / 1000 + 130,
      "coach",
      "Yes, that holds. Lost ids cost nothing, so no recovery step is needed.\n\nNext is the cache tier. This gap takes about 14 minutes. Do you want the full lesson now, or the core idea now and the rest as a topic session later?",
      {
        blocks: [
          {
            kind: "options",
            items: [
              { label: "Core idea now, the rest later.", note: "~4 min summary now, queue full lesson for later" },
              { label: "Full lesson now", note: "~14 min walkthrough with Postgres load math" },
            ],
          },
        ],
      },
    ),
    c("c6", roundMs / 1000 + 160, "candidate", "Core idea now, the rest later."),
    c(
      "c7",
      roundMs / 1000 + 190,
      "coach",
      "The core idea: with no cache, every redirect reads Postgres, so the load is about 100 times what the database was sized for. Protect it with a request limit before you add capacity.\n\nThis is the core idea only. The topic session will cover warm standby caches and request coalescing. The notes draft will add it to your tracker.",
      {
        blocks: [
          {
            kind: "anchor",
            target: { kind: "board", elementId: "redis" },
            label: "Redis hot-set cache",
            note: "High-level design frame — check fallback load on Postgres",
          },
          {
            kind: "callout",
            label: "Takeaway",
            text: "Cap fallback QPS at the redirect tier before a cold cache turns into a database outage.",
          },
        ],
      },
    ),
    divider("d3", roundMs / 1000 + 220, "Index and key choice for the links table"),
    c("c8", roundMs / 1000 + 220, "coach", "Next, the links table. The redirect path looks a link up by its code. Which column would you make the primary key, and why?", {
      blocks: [
        {
          kind: "options",
          action: "prefill",
          items: [
            {
              label: "code as primary key",
              note: "Single B-tree lookup on every redirect",
              reply: "I would make code the primary key because every redirect queries by code, avoiding a secondary-index hop.",
            },
            {
              label: "Surrogate bigint primary key + unique index on code",
              note: "Sequential inserts, extra index lookup on reads",
              reply: "I would use a bigint primary key for sequential inserts and put a unique index on code.",
            },
          ],
        },
      ],
    }),
  ];
  const session = buildSession({
    id: "20261030-1015-c2-url-shortener-fx03",
    problemId: "c2-url-shortener",
    title: "URL Shortener",
    track: "hld",
    mode: "interview",
    durationMin: 45,
    roundMs,
    status,
    phase: "deep_dives",
    phaseHistory: [
      { phase: "requirements", at: 0, by: "candidate" },
      { phase: "entities", at: 276_000, by: "candidate" },
      { phase: "api", at: 432_000, by: "candidate" },
      { phase: "design", at: 684_000, by: "candidate" },
      { phase: "deep_dives", at: 1_428_000, by: "candidate" },
    ],
    transcript,
    graphText: HLD_GRAPH_TEXT,
    steps: fixtureSteps(HLD_DEBRIEF_CHECKLIST, status, roundMs),
    pins: HLD_JUDGE_PINS,
  });
  const at = (offsetSec: number) => new Date(base + roundMs + offsetSec * 1000).toISOString();
  const gapProgress: PublicSession["gapProgress"] =
    status === "debriefed"
      ? {
          "Unique codes across several servers": { by: "coach", state: "taught", at: at(100) },
          "What happens when the cache tier is gone": { by: "coach", state: "core_only", at: at(190) },
          "Index and key choice for the links table": { by: "coach", state: "started", at: at(220) },
        }
      : {};
  return { ...session, gapProgress, scorecard: status === "debriefed" ? HLD_SCORECARD : null, reference: status === "debriefed" ? HLD_REFERENCE : null };
}

// ---------------------------------------------------------------------------
// LLD debrief

export const LLD_SCORECARD: Scorecard = {
  verdict: {
    sde2: "lean_no_hire",
    senior: "no_hire",
    confidence: "high",
    summary:
      "The design was clean. The ticket was found early, pricing was a strategy, and the first slice ran. The round lost its bar on correctness. Two scenarios that guard state failed: an unknown ticket freed a spot, and a second exit with the same ticket freed it twice.\n\nThe lock was in the right place, and the concurrency scenario passed.",
  },
  dimensions: [
    {
      id: "requirements",
      name: "Requirements",
      score: 3,
      evidence: [
        { quote: "Can two gates use the lot at the same moment, and does the driver pick the spot or does the system?", source: "candidate", at: "00:25", polarity: "plus" },
        { quote: "How is the fee worked out, and does a lot ever have more than one floor?", source: "candidate", at: "01:20", polarity: "plus" },
      ],
      whatA4LooksLike: "A 4 also asks which extension is likely, writes the out-of-scope list, and picks a minimal first slice out loud.",
    },
    {
      id: "working_code",
      name: "Working code",
      score: 2,
      evidence: [
        { quote: "int fee = lot.exit(ticket->id, 130);", source: "code", at: "", polarity: "minus" },
        { quote: "Right, I called exit before writing it. I will add it now.", source: "candidate", at: "38:00", polarity: "minus" },
      ],
      whatA4LooksLike: "A 4 has a clean first demo, survives surprise input, and has a driver that proves every state change.",
    },
    {
      id: "design",
      name: "Design",
      score: 3,
      evidence: [
        {
          quote: "Nouns: vehicle type (enum), spot, ticket, lot, pricing. The ticket is the hidden one: it ties a spot to an entry time.",
          source: "candidate",
          at: "07:00",
          polarity: "plus",
        },
        { quote: "class HourlyPricing : public PricingStrategy", source: "code", at: "", polarity: "plus" },
      ],
      whatA4LooksLike: "A 4 keeps dependencies one way and adds an interface only where a change is likely.",
    },
    {
      id: "extensibility",
      name: "Extensibility",
      score: 3,
      evidence: [{ quote: "A weekend rate is a new PricingStrategy, so the lot does not change.", source: "candidate", at: "78:10", polarity: "plus" }],
      whatA4LooksLike: "A 4 chains two changes and shows each stays in one place.",
    },
    {
      id: "edge_cases",
      name: "Edge cases",
      score: 2,
      evidence: [
        { quote: "tickets_[ticket.id] = ticket;", source: "code", at: "", polarity: "minus" },
        { quote: "I will check for a bad ticket id later.", source: "candidate", at: "95:30", polarity: "minus" },
      ],
      whatA4LooksLike: "A 4 lists the failure cases up front, rejects them without changing state, and states the invariants.",
    },
    {
      id: "concurrency",
      name: "Concurrency",
      score: 3,
      evidence: [{ quote: "std::lock_guard<std::mutex> lock(mutex_);", source: "code", at: "", polarity: "plus" }],
      whatA4LooksLike: "A 4 explains the lock scope, shows it cannot deadlock, and states the cost.",
    },
    {
      id: "code_quality",
      name: "Code quality",
      score: 3,
      evidence: [{ quote: "virtual ~PricingStrategy() = default;", source: "code", at: "", polarity: "plus" }],
      whatA4LooksLike: "A 4 injects the clock and tests the boundaries and the transitions.",
    },
    {
      id: "communication_time",
      name: "Communication and time",
      score: 2,
      evidence: [{ quote: "I want to finish the whole skeleton before I run anything.", source: "candidate", at: "29:40", polarity: "minus" }],
      whatA4LooksLike: "A 4 runs a vertical slice first, watches the clock, and says what more time would buy.",
    },
  ],
  strengths: ["You found the ticket as the hidden noun in the first ten minutes.", "Pricing was a policy from the start, so the weekend rate cost one new class."],
  gaps: [
    {
      title: "Check the ticket before freeing the spot",
      severity: "high",
      whyItMatters: "An unknown or used ticket must change nothing. Here it freed a spot that a new car then shared.",
      whatGoodLooksLike: "Look the ticket up, refuse unknown and closed tickets, and only then free the spot and close the ticket.",
      teachMinutes: 10,
    },
    {
      title: "Run the first slice before the skeleton is complete",
      severity: "medium",
      whyItMatters: "The first compile came 31 minutes in, so one missing method cost a long detour.",
      whatGoodLooksLike: "Write one happy path from main, run it, and then add the rest.",
      teachMinutes: 8,
    },
  ],
  timeline: [
    { at: "07:00", note: "Named the ticket as the hidden noun." },
    { at: "31:00", note: "First run failed to compile: exit() was never written." },
    { at: "95:30", note: "Postponed ticket validation, and ran out of time before returning to it." },
  ],
  practiceTask: "Add `exit` with full validation, then write three demo cases: an unknown ticket, a used ticket, and a ticket at minute 61.",
  trackerMark: "[~]",
  trackerMarkReason: "Two core scenarios fail, so the round cannot earn a full mark.",
  lldScenarios: [
    { name: "A car enters at minute 0 and gets spot 2", pass: true, detail: "Ticket 1, spot 2." },
    { name: "A motorcycle enters and gets spot 0", pass: true, detail: "Ticket 2, spot 0." },
    { name: "A truck enters and gets spot 4", pass: true, detail: "Ticket 3, spot 4." },
    { name: "A second truck gets spot 11", pass: true, detail: "Ticket 4, spot 11." },
    { name: "A third truck is rejected", pass: true, detail: "No ticket, state unchanged." },
    { name: "The first car exits at minute 130 and pays 150", pass: true, detail: "Fee 150, spot 2 free again." },
    { name: "A new car takes spot 2 again", pass: true, detail: "Ticket 5, spot 2." },
    { name: "Exit with an unknown ticket id is rejected", pass: false, detail: "exit(99, 10) returned 0 and freed spot 0. It should have returned an error and changed nothing." },
    {
      name: "Exiting the same ticket twice frees nothing twice",
      pass: false,
      detail: "The second exit freed spot 2 again. A new car then received a spot that was already taken.",
    },
    { name: "A fourth motorcycle takes the lowest free spot of any size", pass: true, detail: "Ticket 6, spot 3." },
    { name: "Fees at 1, 60 and 61 minutes", pass: true, detail: "20, 20 and 40 for a motorcycle." },
    { name: "Two threads admit 1,000 cars each into 500 spots", pass: true, detail: "500 tickets issued, no spot id appeared twice." },
  ],
  steps: [
    {
      phase: "clarify",
      took: [
        {
          point: "Asked concurrency and fee calculation questions early.",
          dimensionId: "requirements",
          evidence: {
            quote: "Can two gates use the lot at the same moment, and does the driver pick the spot or does the system?",
            source: "candidate",
            at: "00:25",
            polarity: "plus",
          },
        },
      ],
      missing: ["Did not explicitly clarify out-of-scope payment handling."],
    },
  ],
  phaseTiming: [
    { phase: "clarify", label: "Clarify", plannedMinutes: 7, actualMinutes: 6.3 },
    { phase: "entities", label: "Entities", plannedMinutes: 13, actualMinutes: 11.8 },
    { phase: "behaviour", label: "Behaviour", plannedMinutes: 13, actualMinutes: 11.5 },
    { phase: "skeleton", label: "Skeleton", plannedMinutes: 13, actualMinutes: 7.2 },
    { phase: "thin_slice", label: "Thin slice", plannedMinutes: 20, actualMinutes: 24.5 },
    { phase: "fill_out", label: "Fill out", plannedMinutes: 34, actualMinutes: 41.1 },
    { phase: "extend", label: "Extension", plannedMinutes: 20, actualMinutes: 17.6 },
  ],
  quoteChecks: [
    { dimensionId: "requirements", index: 0, verified: true },
    { dimensionId: "requirements", index: 1, verified: true },
    { dimensionId: "working_code", index: 0, verified: true },
    { dimensionId: "working_code", index: 1, verified: true },
    { dimensionId: "design", index: 0, verified: true },
    { dimensionId: "design", index: 1, verified: true },
    { dimensionId: "extensibility", index: 0, verified: true },
    { dimensionId: "edge_cases", index: 0, verified: true },
    { dimensionId: "edge_cases", index: 1, verified: false },
    { dimensionId: "concurrency", index: 0, verified: true },
    { dimensionId: "code_quality", index: 0, verified: true },
    { dimensionId: "communication_time", index: 0, verified: true },
  ],
  stepQuoteChecks: [{ phase: "clarify", index: 0, verified: true }],
};

const LLD_REFERENCE: NonNullable<PublicSession["reference"]> = {
  sections: [
    {
      heading: "Entities and relationships",
      markdown:
        "- `VehicleType`: an enum ordered by size. It is also the spot size.\n- `Spot`: id, floor, size, and the ticket that holds it.\n- `Ticket`: the hidden noun. Created at entry, closed at exit.\n- `ParkingLot`: owns the spots, the open tickets, the lock and the pricing rule.\n- `PricingStrategy`: the fee rule is a policy, so it is an interface.",
    },
    {
      heading: "Reference design",
      markdown:
        "```cpp\nstd::optional<Ticket> enter(VehicleType type, int minute);\nstd::optional<int> exit(int ticketId, int minute);\n```\n\nA flat vector of spots, sorted by floor and number, turns 'lowest floor, then lowest number' into one loop. A ticket stores the spot id, so exit is one lookup.",
    },
  ],
};

export function lldDebrief(status: PublicSession["status"] = "debriefed"): PublicSession {
  const roundMs = 118 * MIN;
  const base = Date.now() - roundMs - 4 * MIN;
  const e = (id: string, at: number, role: TranscriptEntry["role"], text: string, extra?: Partial<TranscriptEntry>) => entry(base, id, at, role, text, extra);
  const transcript: TranscriptEntry[] = [
    e("t1", 0, "interviewer", "Design a parking lot. Build it as a running, in-memory C++ program, with a `main()` that shows it working."),
    e("t2", 25, "candidate", "Can two gates use the lot at the same moment, and does the driver pick the spot or does the system?"),
    e("t3", 48, "interviewer", "Entrances and exits run at the same moment. The system picks the spot."),
    coachEntry(
      base,
      "c1",
      roundMs / 1000,
      "coach",
      "The design was clean, and the lock was in the right place. The round lost its bar on one thing: an unknown ticket freed a spot.\n\nLet's start there. What should `exit(99, 10)` do when ticket 99 was never issued?",
      {
        blocks: [
          {
            kind: "diagram",
            layout: "sequence",
            title: "How exit(99, 10) freed spot 0",
            actors: [
              { id: "caller", label: "Caller" },
              { id: "lot", label: "ParkingLot" },
              { id: "tickets", label: "tickets_" },
              { id: "spots", label: "spots_" },
            ],
            steps: [
              { from: "caller", to: "lot", label: "exit(99, 10)" },
              { from: "lot", to: "tickets", label: "operator[](99) inserts spotId = 0" },
              { from: "lot", to: "spots", label: "spots_[0].ticketId.reset()" },
              { from: "lot", to: "caller", label: "returns 0 (spot 0 now free)", style: "dashed" },
            ],
          },
          {
            kind: "anchor",
            target: { kind: "code", line: 60, endLine: 65 },
            label: "ParkingLot::exit(int ticketId, int minute)",
            note: "tickets_[ticketId] default-inserts before checking validity",
          },
          {
            kind: "anchor",
            target: { kind: "board", elementId: "lot" },
            label: "ParkingLot on the Entities frame",
            note: "Pinned gap: exit() trusts any ticket id",
          },
          {
            kind: "options",
            action: "prefill",
            items: [
              {
                label: "Return std::nullopt without mutating state",
                note: "Use tickets_.find(ticketId) and reject missing or closed tickets",
                reply: "Look up with tickets_.find(ticketId), reject missing or already-closed tickets, and return std::nullopt without touching spots_.",
              },
              {
                label: "Return -1 sentinel on invalid ticket",
                note: "Keep int return type and guard before resetting spot",
                reply: "Keep int exit(...) returning -1 when tickets_.find(ticketId) misses or ticket.open is false, before resetting spots_.",
              },
            ],
          },
        ],
      },
    ),
  ];
  const session = buildSession({
    id: "20261030-1020-b3-parking-lot-fx04",
    problemId: "b3-parking-lot",
    title: "Parking Lot",
    track: "lld",
    mode: "interview",
    durationMin: 120,
    roundMs,
    status,
    phase: "extend",
    phaseHistory: [
      { phase: "clarify", at: 0, by: "candidate" },
      { phase: "extend", at: 6_000_000, by: "candidate" },
    ],
    transcript,
    graphText: LLD_GRAPH_TEXT,
    steps: fixtureSteps(LLD_CHECKLIST, status, roundMs),
    pins: LLD_JUDGE_PINS,
  });
  return { ...session, scorecard: status === "debriefed" ? LLD_SCORECARD : null, reference: status === "debriefed" ? LLD_REFERENCE : null };
}
