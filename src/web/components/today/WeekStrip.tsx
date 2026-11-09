import { useEffect, useRef, useState } from "react";
import type { DayKind } from "../../../shared/week";
import type { DayState, WeekDay, WeekSummary } from "../../lib/weekDays";
import { MinusIcon, CheckIcon } from "../icons";
import { cn } from "../ui";

export const KIND_LABEL: Record<DayKind, string> = { hld: "HLD", lld: "LLD", dsa: "DSA", redo: "Redo", rest: "Rest" };

const STATE_TEXT: Record<Exclude<DayState, "today">, string> = { done: "done", missed: "missed", planned: "planned", rest: "rest day" };

/** What the cell says to a screen reader, since the tick and the dash are drawn only. */
function stateText(day: WeekDay): string {
  if (day.state === "today") return day.done ? "today, done" : "today";
  if (day.state === "planned" && day.kind === "dsa" && day.past) return "not confirmed";
  return STATE_TEXT[day.state];
}

const CELL: Record<DayState, string> = {
  done: "border-border bg-primary-soft text-primary-soft-foreground",
  missed: "border-dashed border-border-strong bg-transparent text-faint",
  today: "border-primary bg-btn-primary text-btn-primary-foreground ring-2 ring-primary/40",
  planned: "border-border bg-raised text-foreground",
  rest: "border-border bg-transparent text-faint",
};

/**
 * The tick of a finished day. Today's tick fills in when its round finishes, so the change is seen. Earlier days show
 * it at once, since they were already done when the page opened.
 */
function Mark({ day }: { day: WeekDay }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(day.done));
    return () => cancelAnimationFrame(frame);
  }, [day.done]);
  const on = day.isToday ? filled : day.done;
  if (day.state === "missed") {
    return (
      <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full ring-1 ring-inset ring-border-strong">
        <MinusIcon size={11} />
      </span>
    );
  }
  if (day.state === "rest") return <span aria-hidden="true" className="size-5 shrink-0" />;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid size-5 shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-inset",
        day.isToday ? "ring-white/70" : on ? "ring-transparent" : "ring-border-strong",
      )}
    >
      {day.isToday && !on ? <span className="size-2 rounded-full bg-white" /> : null}
      <span data-on={on} className="day-fill absolute inset-0 grid place-items-center bg-success-fill text-background">
        <CheckIcon size={12} />
      </span>
    </span>
  );
}

/** Seven cells for the week, Monday first. On a phone the row scrolls sideways inside its own box. */
export function WeekStrip({ days }: { days: readonly WeekDay[] }) {
  const list = useRef<HTMLOListElement>(null);
  // Bring today into view when the row scrolls, so a phone does not open on Monday with today off screen.
  useEffect(() => {
    const row = list.current;
    const today = row?.querySelector<HTMLElement>('[aria-current="date"]');
    if (row && today) row.scrollLeft = today.offsetLeft - (row.clientWidth - today.offsetWidth) / 2;
  }, []);
  return (
    <ol
      ref={list}
      aria-label="This week's plan"
      className="no-scrollbar relative -mx-4 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:grid sm:grid-cols-7 sm:overflow-visible sm:px-0"
    >
      {days.map((day) => (
        <li
          key={day.name}
          aria-current={day.isToday ? "date" : undefined}
          className={cn("flex min-w-[104px] flex-1 items-start justify-between gap-2 rounded-xl border px-3.5 py-2 sm:min-w-0", CELL[day.state])}
        >
          <span className="min-w-0">
            <span className={cn("block text-meta", day.state === "today" ? "text-white/85" : "text-faint")}>{day.isToday ? `${day.name} (today)` : day.name}</span>
            <span className={cn("block text-lead font-bold", day.state === "missed" && "line-through decoration-1")}>{KIND_LABEL[day.kind]}</span>
          </span>
          <Mark day={day} />
          <span className="sr-only">{stateText(day)}</span>
        </li>
      ))}
    </ol>
  );
}

/** "2 of 3 planned days done this week", counting only the days whose outcome is known. */
export function WeekSummaryText({ summary }: { summary: WeekSummary }) {
  if (summary.known === 0) return <p className="text-ui text-muted-foreground">No planned day to count yet this week</p>;
  return (
    <p className="text-ui text-muted-foreground">
      <b className="font-bold text-foreground">{summary.done}</b> of <b className="font-bold text-foreground">{summary.known}</b> planned {summary.known === 1 ? "day" : "days"}{" "}
      done this week
    </p>
  );
}
