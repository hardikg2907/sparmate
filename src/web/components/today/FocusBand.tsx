import type { FocusSkill } from "../../../shared/progress";
import { Link } from "../../router";
import { Card, Skeleton } from "../ui";
import { Sparkline } from "./Sparkline";

export function FocusBand({ focus, trend }: { focus: FocusSkill | null; trend: readonly number[] }) {
  return (
    <Card variant="flat" aria-labelledby="focus-band-title" className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4">
      <div className="min-w-0">
        <h2 id="focus-band-title" className="text-body font-semibold">
          {focus ? (
            <>
              This week's focus: <span className="text-primary-text">{focus.name}</span>
            </>
          ) : (
            "This week's focus"
          )}
        </h2>
        <p className="text-ui text-muted-foreground">
          {focus
            ? `${focus.score} of 4 over your last ${focus.roundsCounted} ${focus.roundsCounted === 1 ? "round" : "rounds"}.`
            : "Your focus skill appears after your first debrief."}
        </p>
      </div>
      {focus ? (
        <div className="flex items-center gap-4">
          <Sparkline scores={trend} />
          <span className="text-meta text-muted-foreground">
            Last {trend.length} {trend.length === 1 ? "score" : "scores"}
          </span>
          <Link href="/progress#skills" className="text-ui font-semibold text-primary-text underline underline-offset-4">
            See progress
          </Link>
        </div>
      ) : (
        <Skeleton className="h-2 w-40 rounded-full" />
      )}
    </Card>
  );
}
