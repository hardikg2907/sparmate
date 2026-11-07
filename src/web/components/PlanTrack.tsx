import { phasesFor, type Track } from "../../shared/phases";
import type { PublicStepCheck } from "../../shared/types";
import { formatClock, formatMinutes } from "../lib/format";
import type { PlanPhase } from "../lib/plan";
import { ringView } from "../lib/steps";
import { ChecklistItems } from "./ChecklistItems";
import { StepRing } from "./StepRing";
import { Tooltip, cn } from "./ui";

const MIN = 60_000;

/** m:ss without the leading zero, because the track has little room and minutes never need padding there. */
function shortClock(ms: number): string {
  return formatClock(ms).replace(/^0(\d)/, "$1");
}

function goalsOf(track: Track): Map<string, string> {
  return new Map(phasesFor(track).map((p) => [p.id, p.goal]));
}

// The checklist can run to a dozen items, so the tip scrolls inside the room left on screen.
const STEP_TIP_SURFACE =
  "surface-float max-h-[min(24rem,var(--radix-tooltip-content-available-height))] w-80 max-w-[calc(100vw-1rem)] items-start overflow-y-auto border border-border bg-popover font-normal text-popover-foreground";

/** The step's label and goal, then its checklist when the round shares one. Looking costs nothing: only a click moves the rail. */
function StepTip({ label, goal, step }: { label: string; goal: string | undefined; step: PublicStepCheck | undefined }) {
  if (!step) return <><span className="font-semibold">{label}.</span> {goal}.</>;
  return (
    <span className="block">
      <span className="block text-ui text-muted-foreground">
        <span className="font-semibold text-foreground">{label}.</span> {goal}.
      </span>
      <span className="mt-1.5 block border-t border-border pt-1">
        <ChecklistItems step={step} />
        {step.status === "checking" ? <span className="block px-1 pt-1 text-meta text-muted-foreground">Checking…</span> : null}
      </span>
    </span>
  );
}

/**
 * The round's plan drawn to scale, with the time spent in each phase, a needle for "now", and a ring per step for
 * how much of its checklist he has covered. Widths follow planned minutes, so a three-minute phase looks short and
 * a fifteen-minute one looks long.
 */
export function PlanTrack({
  plan,
  track,
  currentPhase,
  spent,
  roundMs,
  steps,
  onSelect,
  disabled,
}: {
  plan: readonly PlanPhase[];
  track: Track;
  currentPhase: string;
  /** Milliseconds spent per phase id. */
  spent: Record<string, number>;
  roundMs: number;
  steps?: Readonly<Record<string, PublicStepCheck>>;
  onSelect: (phaseId: string) => void;
  disabled?: boolean;
}) {
  const goals = goalsOf(track);
  const totalMs = plan.reduce((sum, p) => sum + p.minutes * MIN, 0) || 1;
  const needle = Math.min(1, Math.max(0, roundMs / totalMs));
  const currentIndex = plan.findIndex((p) => p.id === currentPhase);

  return (
    <nav aria-label="Interview phases" className="relative">
      <ol className="room-steps flex h-12 gap-1">
        {plan.map((phase, index) => {
          const plannedMs = phase.minutes * MIN;
          const spentMs = spent[phase.id] ?? 0;
          const current = phase.id === currentPhase;
          const visited = !current && (spentMs >= 1000 || index < currentIndex);
          const over = spentMs > plannedMs + 1000;
          const fill = Math.min(1, spentMs / plannedMs);
          const time = current
            ? `${shortClock(spentMs)} / ${formatMinutes(phase.minutes)}`
            : over
              ? `+${shortClock(spentMs - plannedMs)}`
              : spentMs >= 1000
                ? shortClock(spentMs)
                : `${formatMinutes(phase.minutes)} min`;
          return (
            <li key={phase.id} style={{ flexGrow: phase.minutes, flexBasis: 0 }} className="@container min-w-0">
              <Tooltip
                content={<StepTip label={phase.label} goal={goals.get(phase.id)} step={steps?.[phase.id]} />}
                side="top"
                className={steps?.[phase.id] ? STEP_TIP_SURFACE : undefined}
              >
                <button
                  type="button"
                  onClick={() => onSelect(phase.id)}
                  disabled={disabled}
                  aria-current={current ? "step" : undefined}
                  className="room-step flex h-full w-full flex-col justify-center gap-1.5 px-2 text-left disabled:cursor-default"
                  data-current={current || undefined}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {steps ? <StepRing view={ringView(steps[phase.id])} size={16} className="hidden @[5rem]:inline-grid" /> : null}
                    <span className={cn("truncate text-ui font-semibold", current ? "text-primary-soft-foreground" : visited ? "text-foreground" : "text-muted-foreground")}>{phase.label}</span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "ml-auto hidden shrink-0 font-mono text-meta tabular-nums",
                        current ? "@[8rem]:inline" : "@[9.5rem]:inline",
                        over ? "font-semibold text-warning" : current ? "text-primary-soft-foreground" : "text-faint",
                      )}
                    >
                      {time}
                    </span>
                    <span className="sr-only">
                      {current ? ", current phase" : ""}
                      {spentMs >= 1000 ? `, ${formatClock(spentMs)} spent of ${formatMinutes(phase.minutes)} minutes planned` : `, ${formatMinutes(phase.minutes)} minutes planned`}
                      {over ? ", over plan" : ""}
                    </span>
                  </span>
                  <span className={cn("relative block h-1 overflow-hidden rounded-full", over ? "plan-over" : "bg-muted")} aria-hidden="true">
                    {!over && fill > 0 ? <span className="room-progress" data-current={current || undefined} style={{ transform: `scaleX(${fill})` }} /> : null}
                  </span>
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ol>
      <span className="plan-needle pointer-events-none absolute bottom-0 h-3 w-0.5 -translate-x-1/2 rounded-full bg-primary" style={{ left: `${needle * 100}%` }} aria-hidden="true" />
    </nav>
  );
}

/** The plan alone, before a round starts: each phase to scale with its minutes, then the goals in order. */
export function PlanPreview({ plan, track }: { plan: readonly PlanPhase[]; track: Track }) {
  const goals = goalsOf(track);
  return (
    <div>
      <div className="flex h-9 overflow-hidden rounded-md border border-border" aria-hidden="true">
        {plan.map((phase, index) => (
          <div
            key={phase.id}
            style={{ flexGrow: phase.minutes, flexBasis: 0 }}
            className={cn("@container flex min-w-0 items-center gap-1 bg-muted px-1.5", index > 0 && "border-l border-border")}
          >
            <span className="truncate text-meta font-semibold text-foreground">{phase.label}</span>
            <span className="ml-auto hidden shrink-0 font-mono text-meta tabular-nums text-faint @[6rem]:inline">{formatMinutes(phase.minutes)}m</span>
          </div>
        ))}
      </div>
      <ol className="mt-3 space-y-1.5">
        {plan.map((phase, index) => (
          <li key={phase.id} className="grid grid-cols-[1.5rem_8.5rem_3.5rem_1fr] items-baseline gap-2 text-ui">
            <span className="font-mono text-meta text-faint">{index + 1}</span>
            <span className="font-semibold text-foreground">{phase.label}</span>
            <span className="font-mono text-meta tabular-nums text-muted-foreground">{formatMinutes(phase.minutes)} min</span>
            <span className="text-muted-foreground">{goals.get(phase.id)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

interface TimingRow {
  phase: string;
  label: string;
  plannedMinutes: number;
  actualMinutes: number;
}

/** A phase took noticeably longer than planned: a fifth more, and at least a minute. */
export function overPlan(row: TimingRow): boolean {
  return row.actualMinutes > row.plannedMinutes * 1.2 && row.actualMinutes - row.plannedMinutes >= 1;
}

/** The plan and the round as two tracks on one scale, so a phase that ate the next one is plain to see. */
export function PlanVsActual({ rows }: { rows: readonly TimingRow[] }) {
  const planned = rows.reduce((sum, r) => sum + r.plannedMinutes, 0);
  const actual = rows.reduce((sum, r) => sum + r.actualMinutes, 0);
  const scale = Math.max(planned, actual, 1);
  const line = (kind: "plan" | "actual") => (
    <div className="flex h-8 gap-px" style={{ width: `${((kind === "plan" ? planned : actual) / scale) * 100}%` }}>
      {rows.map((row) => {
        const minutes = kind === "plan" ? row.plannedMinutes : row.actualMinutes;
        if (minutes <= 0) return null;
        const over = kind === "actual" && overPlan(row);
        return (
          <div
            key={row.phase}
            title={`${row.label}: ${formatMinutes(minutes)} min`}
            style={{ flexGrow: minutes, flexBasis: 0 }}
            className={cn(
              "@container flex min-w-0 items-center rounded-xs px-1.5",
              kind === "plan" ? "bg-muted text-muted-foreground" : over ? "plan-over-solid text-foreground" : "bg-primary-soft text-primary-soft-foreground",
            )}
          >
            <span className="hidden truncate text-meta font-semibold @[3.5rem]:inline">{row.label}</span>
          </div>
        );
      })}
    </div>
  );
  return (
    <div aria-hidden="true" className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-1.5">
      <span className="text-ui text-muted-foreground">Plan</span>
      {line("plan")}
      <span className="text-ui text-muted-foreground">Your round</span>
      {line("actual")}
    </div>
  );
}
