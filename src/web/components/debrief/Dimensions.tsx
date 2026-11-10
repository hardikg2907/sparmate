import type { Scorecard } from "../../../shared/types";
import { SCORE_TONE, SCORE_WORD } from "../../lib/format";
import { CheckIcon, MinusIcon, PlusIcon, WarnIcon } from "../icons";
import { Card, Disclosure, TONE_FILL, TONE_SOFT, TONE_TEXT, cn } from "../ui";

type Dimension = Scorecard["dimensions"][number];
type Evidence = Dimension["evidence"][number];

const SOURCE_LABEL: Record<Evidence["source"], string> = { candidate: "You said", board: "On the board", code: "In the code" };
const MISSING_LABEL: Record<Evidence["source"], string> = {
  candidate: "Not found in transcript",
  board: "Not found on the board",
  code: "Not found in the code",
};

export function EvidenceItem({ evidence, verified, point, dimensionName }: { evidence: Evidence; verified: boolean | undefined; point?: string; dimensionName?: string }) {
  const plus = evidence.polarity === "plus";
  return (
    <li className="flex gap-2.5">
      <span
        className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", plus ? "bg-success-soft text-success" : "bg-destructive-soft text-destructive")}
        aria-hidden="true"
      >
        {plus ? <PlusIcon size={12} /> : <MinusIcon size={12} />}
      </span>
      <div className="min-w-0">
        {point ? (
          <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-body font-medium text-foreground">{point}</span>
            {dimensionName ? <span className="text-meta text-muted-foreground">· {dimensionName}</span> : null}
          </div>
        ) : null}
        <blockquote className="max-w-[68ch] break-words text-body text-foreground">“{evidence.quote}”</blockquote>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-muted-foreground">
          <span className={cn("font-semibold", plus ? "text-success" : "text-destructive")}>{plus ? "Counts for you" : "Counts against you"}</span>
          <span>
            {SOURCE_LABEL[evidence.source]}
            {evidence.at ? ` at ${evidence.at}` : ""}
          </span>
          {verified === true ? (
            <span className="inline-flex items-center gap-1 text-success">
              <CheckIcon size={12} />
              Quote checked
            </span>
          ) : null}
          {verified === false ? (
            <span
              className="inline-flex items-center gap-1 font-medium text-warning"
              title="The judge quoted words that are not in the saved record. Treat this evidence with care."
            >
              <WarnIcon size={12} />
              {MISSING_LABEL[evidence.source]}
            </span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

function ScoreTile({ score, className }: { score: number; className: string }) {
  return (
    <span className={cn("tint flex size-9 shrink-0 items-center justify-center rounded-lg text-lead font-bold tabular-nums", className)} aria-hidden="true">
      {score}
    </span>
  );
}

function ScoreMeter({ score }: { score: number }) {
  const tone = SCORE_TONE[score] ?? "neutral";
  return (
    <span className="flex gap-1" role="img" aria-label={`Score ${score} of 4`}>
      {[1, 2, 3, 4].map((step) => (
        <span key={step} className={cn("h-2 w-7 rounded-full", step <= score ? TONE_FILL[tone] : "bg-muted ring-1 ring-inset ring-border")} />
      ))}
    </span>
  );
}

export function DimensionsTable({ scorecard }: { scorecard: Scorecard }) {
  const checks = new Map<string, boolean>();
  for (const check of scorecard.quoteChecks ?? []) checks.set(`${check.dimensionId}:${check.index}`, check.verified);

  return (
    <section id="dimensions" aria-label="Evidence by score">
      <Card variant="raised" className="divide-y divide-border overflow-hidden">
        {scorecard.dimensions.map((dimension) => {
          const tone = SCORE_TONE[dimension.score] ?? "neutral";
          return (
            <article key={dimension.id} id={`dim-${dimension.id}`} aria-labelledby={`dim-${dimension.id}-name`} className="scroll-mt-16 px-5 py-5 sm:px-6">
              <header className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <ScoreTile score={dimension.score} className={TONE_SOFT[tone]} />
                <h3 id={`dim-${dimension.id}-name`} className="text-lead font-bold text-foreground">
                  {dimension.name}
                </h3>
                <ScoreMeter score={dimension.score} />
                <span className={cn("text-ui font-semibold", TONE_TEXT[tone])}>
                  {dimension.score} {SCORE_WORD[dimension.score] ?? ""}
                </span>
              </header>
              {dimension.evidence.length > 0 ? (
                <ul className="space-y-3">
                  {dimension.evidence.map((evidence, index) => (
                    <EvidenceItem key={index} evidence={evidence} verified={checks.get(`${dimension.id}:${index}`)} />
                  ))}
                </ul>
              ) : (
                <p className="text-ui text-muted-foreground">No evidence quoted.</p>
              )}
              <Disclosure summary="What a 4 looks like" className="mt-3">
                <p className="max-w-[68ch] rounded-md bg-muted px-3 py-2 text-ui text-foreground">{dimension.whatA4LooksLike}</p>
              </Disclosure>
            </article>
          );
        })}
      </Card>
    </section>
  );
}
