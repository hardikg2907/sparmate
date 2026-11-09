import { phasesFor, type Track } from "../../shared/phases";
import { formatClock, formatMinutes } from "../lib/format";
import { railPosition, railWeights, type PlanPhase } from "../lib/plan";
import { CheckIcon } from "./icons";
import { Tooltip, cn } from "./ui";

const MIN = 60_000;

/** m:ss without the leading zero, because the track has little room and minutes never need padding there. */
function shortClock(ms: number): string {
  return formatClock(ms).replace(/^0(\d)/, "$1");
}

function goalsOf(track: Track): Map<string, string> {
  return new Map(phasesFor(track).map((p) => [p.id, p.goal]));
}

/**
 * The round's plan drawn to scale in one row, with the time spent in each phase and a needle for "now". Widths follow
 * planned minutes (with a floor so a short phase still shows a name). Finished steps are solid, the current one is lit
 * and carries its label and clock above it, and the rest show a short label. A guided round marks each passed step.
 * On a narrow screen only the current step shows.
 */
export function PlanTrack({
  plan,
  track,
  currentPhase,
  spent,
  roundMs,
  passed,
  onSelect,
  disabled,
}: {
  plan: readonly PlanPhase[];
  track: Track;
  currentPhase: string;
  /** Milliseconds spent per phase id. */
  spent: Record<string, number>;
  roundMs: number;
  /** Step ids the guide passed. Given in a live guided round. */
  passed?: ReadonlySet<string>;
  onSelect: (phaseId: string) => void;
  disabled?: boolean;
}) {
  const goals = goalsOf(track);
  const weights = railWeights(plan);
  const needle = railPosition(plan, roundMs);
  const currentIndex = plan.findIndex((p) => p.id === currentPhase);

  return (
    <nav aria-label="Interview phases" className="plan-track relative min-w-0 flex-1 pt-[18px]">
      <ol className="flex h-5 gap-0.5">
        {plan.map((phase, index) => {
          const plannedMs = phase.minutes * MIN;
          const spentMs = spent[phase.id] ?? 0;
          const current = phase.id === currentPhase;
          const done = !current && (spentMs >= 1000 || index < currentIndex);
          const over = spentMs > plannedMs + 1000;
          const fill = Math.min(1, spentMs / plannedMs);
          const time = `${shortClock(spentMs)} / ${formatMinutes(phase.minutes)}`;
          const isPassed = passed?.has(phase.id) ?? false;
          return (
            <li key={phase.id} style={{ flexGrow: weights[index], flexBasis: 0 }} className={cn("relative min-w-0", !current && "max-md:hidden")}>
              <Tooltip
                content={
                  <>
                    <span className="font-semibold">{phase.label}.</span> {goals.get(phase.id)}.
                  </>
                }
                side="bottom"
              >
                <button
                  type="button"
                  onClick={() => onSelect(phase.id)}
                  disabled={disabled}
                  aria-current={current ? "step" : undefined}
                  className="plan-seg flex h-full w-full items-center gap-1 px-1.5 text-left disabled:cursor-default"
                  data-current={current || undefined}
                  data-done={done || undefined}
                >
                  {current ? (
                    <span className={cn("relative block h-full w-full", over && "plan-over")} aria-hidden="true">
                      {over ? null : <span className="room-progress" data-current style={{ transform: `scaleX(${fill})` }} />}
                    </span>
                  ) : (
                    <>
                      {isPassed ? <CheckIcon size={10} className="shrink-0" /> : null}
                      <span className="truncate text-meta font-semibold">{phase.label}</span>
                    </>
                  )}
                  <span className="sr-only">
                    {phase.label}
                    {current ? ", current phase" : ""}
                    {isPassed ? ", passed" : ""}
                    {spentMs >= 1000 ? `, ${formatClock(spentMs)} spent of ${formatMinutes(phase.minutes)} minutes planned` : `, ${formatMinutes(phase.minutes)} minutes planned`}
                    {over ? ", over plan" : ""}
                  </span>
                </button>
              </Tooltip>
              {current ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute bottom-[calc(100%+1px)] flex items-baseline gap-1.5 whitespace-nowrap text-meta leading-none",
                    index > plan.length / 2 ? "right-0" : "left-0",
                  )}
                >
                  <span className="font-semibold text-primary-text">{phase.label}</span>
                  <span className={cn("font-mono tabular-nums", over ? "font-semibold text-warning" : "text-muted-foreground")}>{time}</span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <span
        className="plan-needle pointer-events-none absolute top-[14px] h-[26px] w-0.5 -translate-x-1/2 rounded-full bg-primary max-md:hidden"
        style={{ left: `${needle * 100}%` }}
        aria-hidden="true"
      />
    </nav>
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
