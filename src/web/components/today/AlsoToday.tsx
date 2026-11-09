import type { ReactNode } from "react";
import type { DsaResponse } from "../../../shared/dsa";
import type { GymDrillRow } from "../../../shared/drills";
import { Link, drillPath } from "../../router";
import { ExternalIcon } from "../icons";
import { Button, Card, Skeleton, cn } from "../ui";

const LEETCODE_URL = "https://leetcode.com/problemset/";

export function AlsoTodayHeading({ children }: { children: ReactNode }) {
  return <h2 className="px-1 text-ui font-semibold text-muted-foreground">{children}</h2>;
}

export function DrillsDueCard({ due }: { due: readonly GymDrillRow[] }) {
  if (due.length === 0) return null;
  const minutes = due.reduce((sum, d) => sum + d.minutes, 0);
  return (
    <Card variant="raised" aria-labelledby="drills-due-title" className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="drills-due-title" className="text-body font-semibold">
            Drills due
          </h3>
          <p className="text-ui text-muted-foreground">
            {due.length} {due.length === 1 ? "drill" : "drills"}, about {minutes} min
          </p>
        </div>
        <Link href="/practice/drills" className="text-ui text-primary-text underline underline-offset-4">
          Open Practice
        </Link>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {due.slice(0, 3).map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-ui font-semibold">{d.gapTitle}</p>
              <p className="truncate text-meta text-muted-foreground">
                {d.title}, {d.minutes} min
              </p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href={drillPath({ drill: d.drill, problemId: d.problemId, drillId: d.id })} aria-label={`Start ${d.title}: ${d.gapTitle}`}>
                Start
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Ring({ done, goal }: { done: number; goal: number }) {
  const r = 29;
  const c = 2 * Math.PI * r;
  const share = goal > 0 ? Math.min(1, done / goal) : 0;
  return (
    <div className="relative size-[68px] shrink-0">
      <svg viewBox="0 0 68 68" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="34" cy="34" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="6" />
        <circle cx="34" cy="34" r={r} fill="none" stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${share * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center leading-none">
        <span className="text-lead font-bold">{done}</span>
        <span className="mt-0.5 text-meta text-muted-foreground">of {goal}</span>
      </div>
    </div>
  );
}

export function DsaWeekCard({ username, dsa, loading }: { username: string | undefined; dsa: DsaResponse | null; loading: boolean }) {
  const shell = "p-5";
  const title = (
    <h3 id="dsa-week-title" className="text-body font-semibold">
      DSA this week
    </h3>
  );
  if (username === undefined || dsa?.status === "no_username") {
    return (
      <Card variant="raised" aria-labelledby="dsa-week-title" className={shell}>
        {title}
        <p className="mt-2 text-ui text-muted-foreground">Add your LeetCode username to count your weekly mediums here.</p>
        <Link href="/settings" className="mt-3 inline-block text-ui font-semibold text-primary-text underline underline-offset-4">
          Add username in Settings
        </Link>
      </Card>
    );
  }
  const usable = dsa && (dsa.status === "ok" || dsa.status === "stale");
  if (!usable) {
    return (
      <Card variant="raised" aria-labelledby="dsa-week-title" className={shell}>
        {title}
        {loading ? (
          <div className="mt-3 flex items-center gap-4" role="status">
            <span className="sr-only">Loading your DSA numbers…</span>
            <Skeleton className="size-[68px] shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ) : (
          <p className="mt-2 text-ui text-muted-foreground">
            {dsa?.status === "not_found" ? "LeetCode could not find this username." : "LeetCode could not be read right now."}{" "}
            <Link href="/settings" className="text-primary-text underline underline-offset-4">
              Check Settings
            </Link>
          </p>
        )}
      </Card>
    );
  }
  const left = Math.max(0, dsa.weeklyGoal - dsa.week.mediums);
  return (
    <Card variant="raised" aria-labelledby="dsa-week-title" className={shell}>
      {title}
      <div className="mt-3 flex items-center gap-4">
        <Ring done={dsa.week.mediums} goal={dsa.weeklyGoal} />
        <div className="min-w-0">
          <p className="text-body font-semibold">
            {dsa.week.mediums} of {dsa.weeklyGoal} mediums
          </p>
          <p className="text-ui text-muted-foreground">{left === 0 ? "Goal met. Nice week." : `${left} more by Sunday`}</p>
          <a href={LEETCODE_URL} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-ui text-primary-text underline underline-offset-4">
            Open LeetCode
            <ExternalIcon size={12} />
          </a>
        </div>
      </div>
    </Card>
  );
}

/** A quiet outline of a card that fills in once there is something to show, so the column never looks broken on a first run. */
export function QuietPreview({ title, text, ring, className }: { title: string; text: string; ring?: boolean; className?: string }) {
  return (
    <section aria-label={title} className={cn("rounded-xl border border-dashed border-border-strong/70 p-5", className)}>
      <h3 className="text-body font-semibold">{title}</h3>
      <p className="mt-1 text-ui text-muted-foreground">{text}</p>
      <div className="mt-3 flex items-center gap-4" aria-hidden="true">
        {ring ? <Skeleton className="!animate-none size-[52px] shrink-0 rounded-full" /> : null}
        <div className="flex-1 space-y-2">
          <Skeleton className="!animate-none h-3 w-4/5 rounded-full" />
          <Skeleton className="!animate-none h-3 w-1/2 rounded-full" />
        </div>
      </div>
    </section>
  );
}
