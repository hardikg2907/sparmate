import { phasePlan } from "../../shared/phases";
import type { Mode, Track } from "../../shared/phases";
import type { BoardPin, CompileDiagnostic, PublicSession, PublicStepCheck, PublicStepItem, RunResult, StepSummary, TranscriptEntry } from "../../shared/types";

const MIN = 60_000;

export const HLD_GRAPH_TEXT = `Nodes:
- [Client] (kind: client)
- [CDN] (kind: cdn)
- [Redirect service] (kind: service)
- [Redis] (kind: cache)
- [Postgres] (kind: database)
- [Key generator] (kind: service)
Edges:
- [Client] -> [CDN] "GET /abc123"
- [CDN] -> [Redirect service] "cache miss"
- [Redirect service] -> [Redis] "lookup"
- [Redirect service] -> [Postgres] "on miss" (dashed)
Text on the board:
- "40 writes/s, 4,000 reads/s"
Warnings: node [Key generator] has no connections`;

export const LLD_GRAPH_TEXT = `Nodes:
- [ParkingLot] (kind: class)
- [Spot] (kind: class)
- [Ticket] (kind: class)
- [PricingStrategy] (kind: interface)
- [HourlyPricing] (kind: class)
Edges:
- [ParkingLot] -> [Spot] "owns"
- [ParkingLot] -> [Ticket] "owns"
- [ParkingLot] -> [PricingStrategy] "uses" (dashed)
- [HourlyPricing] -> [PricingStrategy] "implements" (dashed)`;

export const LLD_CODE = `// Parking Lot — 2026-10-30
#include <iostream>
#include <map>
#include <mutex>
#include <optional>
#include <vector>

enum class VehicleType { Motorcycle, Car, Truck };

struct Spot {
  int id;
  int floor;
  VehicleType size;
  std::optional<int> ticketId;
};

struct Ticket {
  int id;
  VehicleType type;
  int spotId;
  int entryMinute;
  bool open = true;
};

class PricingStrategy {
 public:
  virtual ~PricingStrategy() = default;
  virtual int fee(VehicleType type, int minutes) const = 0;
};

class HourlyPricing : public PricingStrategy {
 public:
  int fee(VehicleType type, int minutes) const override {
    int hours = (minutes + 59) / 60;
    return hours * rate_.at(type);
  }

 private:
  std::map<VehicleType, int> rate_{{VehicleType::Motorcycle, 20}, {VehicleType::Car, 50}, {VehicleType::Truck, 100}};
};

class ParkingLot {
 public:
  explicit ParkingLot(std::vector<Spot> spots) : spots_(std::move(spots)) {}

  std::optional<Ticket> enter(VehicleType type, int minute) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (auto& spot : spots_) {
      if (!spot.ticketId && spot.size >= type) {
        Ticket ticket{nextTicketId_++, type, spot.id, minute};
        spot.ticketId = ticket.id;
        tickets_[ticket.id] = ticket;
        return ticket;
      }
    }
    return std::nullopt;
  }

 private:
  std::vector<Spot> spots_;
  std::map<int, Ticket> tickets_;
  std::mutex mutex_;
  int nextTicketId_ = 1;
};

int main() {
  ParkingLot lot({{0, 1, VehicleType::Car, std::nullopt}});
  auto ticket = lot.enter(VehicleType::Car, 0);
  std::cout << "ticket " << ticket->id << " spot " << ticket->spotId << "\\n";
  int fee = lot.exit(ticket->id, 130);
  return 0;
}
`;

/** The file as it stood when the round ended: `exit` exists, but it trusts the ticket id it is given. */
export const LLD_FINAL_CODE = LLD_CODE.replace(
  " private:\n  std::vector<Spot> spots_;",
  `  int exit(int ticketId, int minute) {
    std::lock_guard<std::mutex> lock(mutex_);
    Ticket& ticket = tickets_[ticketId];
    spots_[ticket.spotId].ticketId.reset();
    return HourlyPricing().fee(ticket.type, minute - ticket.entryMinute);
  }

 private:
  std::vector<Spot> spots_;`,
).replace("int fee = lot.exit(ticket->id, 130);", 'std::cout << "fee " << lot.exit(ticket->id, 130) << "\\n";');

function lineOf(source: string, needle: string): { line: number; column: number } {
  const lines = source.split("\n");
  const at = lines.findIndex((l) => l.includes(needle));
  return { line: at + 1, column: (lines[at] ?? "").indexOf(needle) + 1 };
}

const EXIT_AT = lineOf(LLD_CODE, "lot.exit");
const FEE_AT = lineOf(LLD_CODE, "int fee");

export const LLD_DIAGNOSTICS: CompileDiagnostic[] = [
  { line: EXIT_AT.line, column: EXIT_AT.column + 8, endLine: EXIT_AT.line, endColumn: EXIT_AT.column + 12, severity: "error", message: "no member named 'exit' in 'ParkingLot'" },
  { line: FEE_AT.line, column: FEE_AT.column + 4, endLine: FEE_AT.line, endColumn: FEE_AT.column + 7, severity: "warning", message: "unused variable 'fee' [-Wunused-variable]" },
];

export const LLD_FAILED_RUN: RunResult = {
  at: 31 * MIN,
  compile: {
    ok: false,
    diagnostics: LLD_DIAGNOSTICS,
    stderr: `candidate.cpp:${EXIT_AT.line}:${EXIT_AT.column + 8}: error: no member named 'exit' in 'ParkingLot'`,
    durationMs: 812,
  },
  run: null,
};

export const LLD_GOOD_RUN: RunResult = {
  at: 33 * MIN,
  compile: { ok: true, diagnostics: [], stderr: "", durationMs: 904 },
  run: { exitCode: 0, signal: null, stdout: "ticket 1 spot 0\n", stderr: "", timedOut: false, durationMs: 6 },
};

interface BuildOptions {
  id: string;
  problemId: string;
  title: string;
  track: Track;
  mode: Mode;
  durationMin: number;
  /** Round time in ms at the moment the page opens. */
  roundMs: number;
  status: PublicSession["status"];
  /** Why a paused round is paused; defaults to the user's own pause. */
  pauseReason?: PublicSession["pauseReason"];
  phase: string;
  phaseHistory: { phase: string; at: number; by: "candidate" | "interviewer" }[];
  transcript: TranscriptEntry[];
  graphText: string;
  steps?: Record<string, PublicStepCheck>;
  pins?: BoardPin[];
}

const HLD_NOTES: Record<string, string> = {
  requirements: "Functional: shorten a URL, redirect, custom alias.\nNon-functional: redirect p99 under 50 ms, 99.99% available, links never reused.",
  entities: "Link: the code, the long URL, the expiry. ClickCount: one counter per code.",
};

const LLD_NOTES: Record<string, string> = {
  clarify: "Multi-floor lot, three spot sizes, pay on exit. Out of scope: reservations.",
  entities: "Class: Lot, Floor, Spot, Ticket. Enum: SpotSize. Not stored: the fee (computed). Hidden noun: the rate card.",
};

const HLD_SUMMARIES: Record<string, StepSummary> = {
  requirements: {
    status: "done",
    proposed: ["Shorten a URL, redirect, custom alias", "Redirect p99 under 50 ms, 99.99% available", "Links are never reused"],
    agreed: ["Links never expire", "No analytics in scope", "Custom aliases up to 16 characters"],
  },
  entities: { status: "pending", proposed: [], agreed: [] },
};

const LLD_SUMMARIES: Record<string, StepSummary> = {
  clarify: {
    status: "done",
    proposed: ["Multi-floor lot, three spot sizes", "Pay on exit, hourly rate"],
    agreed: ["Reservations are out of scope", "A large vehicle never takes a small spot"],
  },
};

export function buildSession(o: BuildOptions): PublicSession {
  const now = Date.now();
  const live = o.status === "live" || o.status === "paused";
  // A finished round ended four minutes ago, so its start is further back by that much.
  const endedAgo = live ? 0 : 4 * MIN;
  const startedAt = new Date(now - o.roundMs - endedAgo).toISOString();
  const endedAt = live ? null : new Date(now - endedAgo).toISOString();
  return {
    id: o.id,
    problemId: o.problemId,
    title: o.title,
    track: o.track,
    mode: o.mode,
    custom: false,
    createdAt: startedAt,
    durationMs: o.durationMin * MIN,
    startedAt,
    pausedMs: 0,
    pauseStartedAt: o.status === "paused" ? new Date(now - 30_000).toISOString() : null,
    pauseReason: o.status === "paused" ? (o.pauseReason ?? "user") : null,
    endedAt,
    status: o.status,
    phase: o.phase,
    phaseHistory: o.phaseHistory,
    transcript: o.transcript,
    hints: [],
    extension: null,
    board: { version: 14, graphText: o.graphText, updatedAt: o.roundMs - 20_000 },
    stepNotes: {},
    stepNotesVersion: 0,
    stepSummaries: {},
    steps: o.steps ?? {},
    assistCount: 0,
    pins: o.pins ?? [],
    focus: null,
    gapProgress: {},
    studyNotes: null,
    code: o.track === "lld" ? { path: "lld/parking-lot/attempt-2026-10-30.cpp", version: 9, lastRun: o.status === "live" ? LLD_FAILED_RUN : LLD_GOOD_RUN } : null,
    scorecard: null,
    models: { interviewer: "claude-opus-5-5", judge: "claude-opus-5-5" },
    clock: {
      startedAt,
      pausedMs: 0,
      pauseStartedAt: o.status === "paused" ? new Date(now - 30_000).toISOString() : null,
      durationMs: o.durationMin * MIN,
      serverNow: new Date(now).toISOString(),
    },
    phasePlan: phasePlan(o.track, o.durationMin),
    reference: null,
  };
}

export function entry(startedAtMs: number, id: string, atSec: number, role: TranscriptEntry["role"], text: string, extra: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id,
    at: atSec * 1000,
    wall: new Date(startedAtMs + atSec * 1000).toISOString(),
    channel: "interview",
    role,
    text,
    ...extra,
  };
}

export function coachEntry(startedAtMs: number, id: string, atSec: number, role: "coach" | "candidate", text: string): TranscriptEntry {
  return entry(startedAtMs, id, atSec, role, text, { channel: "coach" });
}

/** A round saved before the checklist, with the written step text and notepads it held then (`?legacy=1`). */
export function withLegacyNotes(session: PublicSession): PublicSession {
  return {
    ...session,
    stepNotes: session.track === "hld" ? HLD_NOTES : LLD_NOTES,
    stepNotesVersion: 3,
    stepSummaries: session.track === "hld" ? HLD_SUMMARIES : LLD_SUMMARIES,
    steps: {},
    assistCount: 0,
    pins: [],
  };
}

type Cover = [state: "covered" | "partial", source: "chat" | "board" | "code", atSec: number | null, detail?: string];

export interface FixtureChecklist {
  items: Record<string, string[]>;
  /** By item id ("design-2"); an item not listed is missing. */
  cover: Record<string, Cover>;
}

/**
 * The checklist as the server would send it: only once the round is over, and then every label. A live round, in any
 * mode, sends none.
 */
export function fixtureSteps(list: FixtureChecklist, status: PublicSession["status"], checkedAtMs: number): Record<string, PublicStepCheck> {
  const out: Record<string, PublicStepCheck> = {};
  if (!["debriefing", "debriefed", "failed"].includes(status)) return out;
  for (const [phase, labels] of Object.entries(list.items)) {
    const all: PublicStepItem[] = labels.map((label, i) => {
      const id = `${phase}-${i + 1}`;
      const c = list.cover[id];
      return {
        id,
        label,
        question: false,
        state: c ? c[0] : "missing",
        source: c ? c[1] : null,
        at: c && c[2] !== null ? c[2] * 1000 : null,
        detail: c && c[0] === "partial" ? (c[3] ?? null) : null,
      };
    });
    const touched = all.some((i) => i.state !== "missing");
    out[phase] = {
      status: touched ? "done" : "idle",
      checkedAt: touched ? checkedAtMs : null,
      usedImage: phase === "design" || phase === "behaviour",
      items: all,
      covered: all.filter((i) => i.state === "covered").length,
      partial: all.filter((i) => i.state === "partial").length,
      total: all.length,
    };
  }
  return out;
}

export const HLD_CHECKLIST: FixtureChecklist = {
  items: {
    requirements: [
      "Create a short link for a long URL, with an optional custom alias and an optional expiry",
      "Redirect a short link to its long URL",
      "Delete a link (owner only); expired and deleted links stop redirecting",
      "Redirect adds under 50 ms at p99",
      "99.99% availability for redirects",
      "Read-heavy: about 100 reads per write, with viral spikes",
    ],
    entities: ["Link", "ClickCount"],
    api: ["POST /urls", "GET /{code}", "DELETE /urls/{code}"],
    design: ["Walk one redirect through every box", "Walk one create through every box"],
    deep_dives: ["Generating unique short codes", "Fast, highly available redirects", "Counting clicks without slowing redirects", "The curveball handled"],
  },
  cover: {
    "requirements-1": ["covered", "chat", 20],
    "requirements-2": ["covered", "board", null],
    "requirements-4": ["covered", "board", null],
    "requirements-5": ["covered", "board", null],
    "requirements-6": ["partial", "chat", 72, "no read to write ratio stated"],
    "entities-1": ["covered", "chat", 290],
    "entities-2": ["covered", "chat", 290],
    "api-1": ["covered", "board", null],
    "api-2": ["covered", "chat", 470],
    "design-1": ["partial", "board", null, "the key generator is not joined"],
  },
};

export const LLD_CHECKLIST: FixtureChecklist = {
  items: {
    clarify: [
      "Configure floors, spots per floor with sizes, gates and rates at setup",
      "Entry: assign the first free fitting spot and return a ticket; reject when nothing fits",
      "Exit: compute the fee, free the spot, close the ticket",
      "Invalid or already-used tickets are rejected without changing state",
      "Safe under concurrent entry and exit calls",
    ],
    entities: ["VehicleType", "Spot", "Ticket", "ParkingLot", "PricingStrategy"],
    behaviour: ["enter(type, time)", "exit(ticketId, time)", "A spot has two states, free and taken", "Every method takes the same lock"],
    skeleton: ["Classes and signatures that compile"],
    thin_slice: ["Demo: A car enters at minute 0: it gets spot 2 (floor 1, first car spot)"],
    fill_out: ["Demo: A third truck enters: rejected, no ticket", "Demo: The car exits at minute 130: fee 150", "Demo: Exit with a ticket id that was never issued: rejected"],
    extend: ["The new requirement restated", "The demo runs after the change"],
  },
  cover: {
    "clarify-1": ["covered", "chat", 80],
    "clarify-2": ["covered", "chat", 25],
    "clarify-5": ["covered", "chat", 25],
    "entities-1": ["covered", "chat", 420],
    "entities-2": ["covered", "board", null],
    "entities-3": ["covered", "board", null],
    "entities-4": ["covered", "board", null],
    "entities-5": ["covered", "board", null],
    "behaviour-1": ["covered", "code", null],
    "behaviour-3": ["covered", "board", null],
    "behaviour-4": ["partial", "code", null, "reads take no lock"],
    "skeleton-1": ["covered", "code", null],
    "thin_slice-1": ["partial", "code", null, "exit() is called before it exists"],
  },
};
