import { useEffect, useState } from "react";
import type { Mode } from "../../shared/phases";
import type { SessionStatus } from "../../shared/types";
import { formatClock } from "../lib/format";
import { cn } from "./ui";

const FIVE_MINUTES = 5 * 60_000;

export function Timer({ mode, roundMs, durationMs, status }: { mode: Mode; roundMs: number; durationMs: number; status: SessionStatus }) {
  const guided = mode === "guided";
  const remaining = durationMs - roundMs;
  const level = guided ? "ok" : remaining <= 0 ? "over" : remaining < FIVE_MINUTES ? "low" : "ok";
  const paused = status === "paused";

  // The countdown itself is silent for screen readers; only the two moments that matter are spoken.
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    if (level === "low") setSpoken("Five minutes left.");
    else if (level === "over") setSpoken("Time is up.");
    else setSpoken("");
  }, [level]);

  return (
    <div className="flex items-center">
      <div
        role="timer"
        aria-live="off"
        aria-label={guided ? `Elapsed ${formatClock(roundMs)}` : `Time left ${formatClock(Math.max(0, remaining))}`}
        className={cn(
          "flex h-8 items-baseline gap-1.5 rounded-md px-2.5 pt-[3px] transition-colors duration-200",
          level === "over" && "tint bg-destructive-soft text-destructive",
          level === "low" && "tint bg-warning-soft text-warning",
          level === "ok" && "room-timer text-foreground",
          paused && level === "ok" && "text-warning",
        )}
      >
        <span className={cn("font-mono text-title font-bold tabular-nums", level === "ok" && !paused && "text-gradient")}>
          {formatClock(guided ? roundMs : Math.max(0, remaining))}
        </span>
        <span className="hidden text-meta font-semibold text-muted-foreground lg:inline">{guided ? "elapsed" : level === "over" ? "time up" : "left"}</span>
      </div>
      <span className="sr-only" role="status">
        {spoken}
      </span>
    </div>
  );
}
