import type { CSSProperties } from "react";
import type { Scorecard } from "../../../shared/types";
import { SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_TONE } from "../../lib/format";
import { gapBadge, startHere, teachLabel, workedText, type GapMark } from "../../lib/gapMarks";
import { CheckIcon } from "../icons";
import { Button, Card, Badge, SectionTitle, Tooltip, cn } from "../ui";

type Gap = Scorecard["gaps"][number];

export function sortedGaps(scorecard: Scorecard): Gap[] {
  return [...scorecard.gaps].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export interface PractiseGap {
  /** Title of the gap whose round is being created, or null. */
  busy: string | null;
  onStart: (gap: Gap) => void;
}

function GapCard({
  gap,
  index,
  mark,
  next,
  onTeach,
  practise,
}: {
  gap: Gap;
  index: number;
  mark: GapMark | undefined;
  next: boolean;
  onTeach: (gap: Gap) => boolean;
  practise: PractiseGap;
}) {
  const badge = gapBadge(mark);
  return (
    <Card
      variant={next ? "raised" : "flat"}
      className={cn(
        "reveal",
        next ? "ring-pulse border-primary/40 bg-raised bg-linear-to-br from-primary-soft/70 via-raised to-raised p-6 shadow-lg ring-1 ring-primary/20" : "lift p-4",
      )}
      style={{ "--i": index } as CSSProperties}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {next ? (
          <Badge tone="accent" className="bg-amber bg-none text-ui font-bold text-amber-foreground shadow-none">
            Start here
          </Badge>
        ) : null}
        <Badge tone={SEVERITY_TONE[gap.severity]}>{SEVERITY_LABEL[gap.severity]}</Badge>
        <h3 className={cn("min-w-0 flex-1 font-bold text-foreground", next ? "text-lead" : "text-body")}>{gap.title}</h3>
        <span className="text-meta text-muted-foreground">About {gap.teachMinutes} min to teach</span>
      </div>
      <dl className={cn("mt-3 grid gap-x-8 gap-y-3 md:grid-cols-2", !next && "text-ui")}>
        <div>
          <dt className="text-ui font-semibold text-muted-foreground">Why it matters</dt>
          <dd className={cn("mt-0.5 text-foreground", next ? "text-body" : "text-ui")}>{gap.whyItMatters}</dd>
        </div>
        <div>
          <dt className="text-ui font-semibold text-muted-foreground">What good looks like</dt>
          <dd className={cn("mt-0.5 text-foreground", next ? "text-body" : "text-ui")}>{gap.whatGoodLooksLike}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size={next ? "lg" : "sm"} variant={next ? "default" : mark ? "ghost" : "outline"} onClick={() => onTeach(gap)}>
          {teachLabel(mark)}
        </Button>
        <Tooltip content="A 20-minute guided round on this problem, aimed at this gap">
          <Button
            size={next ? "default" : "sm"}
            variant="ghost"
            busy={practise.busy === gap.title}
            disabled={practise.busy !== null}
            aria-label={`Practise this gap: ${gap.title}`}
            onClick={() => practise.onStart(gap)}
          >
            Practise this gap
          </Button>
        </Tooltip>
        {badge ? (
          <Badge tone={badge.tone} role="status" className="ml-1">
            <CheckIcon size={12} />
            {badge.label}
          </Badge>
        ) : null}
      </div>
    </Card>
  );
}

export function GapsSection({
  scorecard,
  marks,
  onTeach,
  practise,
}: {
  scorecard: Scorecard;
  marks: ReadonlyMap<string, GapMark>;
  onTeach: (gap: Gap) => boolean;
  practise: PractiseGap;
}) {
  const gaps = sortedGaps(scorecard);
  const next = startHere(gaps, marks);
  return (
    <section id="gaps" aria-labelledby="gaps-heading" className="scroll-mt-16 space-y-8">
      <div>
        <SectionTitle id="gaps-heading" aside={gaps.length > 0 ? `${workedText(marks.size, gaps.length)}. Most serious first.` : undefined}>
          Gaps to work on
        </SectionTitle>
        {gaps.length > 0 ? (
          <div className="space-y-4">
            {gaps.map((gap, index) => (
              <GapCard key={gap.title} gap={gap} index={index} mark={marks.get(gap.title)} next={gap === next} onTeach={onTeach} practise={practise} />
            ))}
          </div>
        ) : (
          <p className="text-ui text-muted-foreground">No gaps were listed for this round.</p>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {scorecard.strengths.length > 0 ? (
          <div>
            <h3 id="strengths-heading" className="mb-2 text-body font-semibold text-foreground">
              Strengths
            </h3>
            <ul className="space-y-2" aria-labelledby="strengths-heading">
              {scorecard.strengths.map((strength) => (
                <li key={strength} className="flex items-start gap-2.5 text-body">
                  <CheckIcon size={16} className="mt-1 shrink-0 text-success" />
                  <span>{strength}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {scorecard.practiceTask ? (
          <div className="tint rounded-xl bg-primary-soft p-5 text-primary-soft-foreground">
            <h3 className="text-body font-semibold text-primary-soft-foreground">Practice task</h3>
            <p className="mt-1 text-body text-primary-soft-foreground">{scorecard.practiceTask}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
