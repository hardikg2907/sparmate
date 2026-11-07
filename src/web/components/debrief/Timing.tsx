import type { Scorecard } from "../../../shared/types";
import { formatMinutes } from "../../lib/format";
import { PlanVsActual, overPlan } from "../PlanTrack";
import { Card, SectionTitle, cn } from "../ui";

type Row = NonNullable<Scorecard["phaseTiming"]>[number];

export function TimingRows({ rows }: { rows: readonly Row[] }) {
  return (
    <>
      <PlanVsActual rows={rows} />
      <table className="mt-4 w-full max-w-xl border-collapse text-left text-ui">
        <caption className="sr-only">Planned and actual minutes per phase</caption>
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            <th scope="col" className="py-1.5 pr-4 font-semibold">
              Phase
            </th>
            <th scope="col" className="py-1.5 pr-4 text-right font-semibold">
              Planned
            </th>
            <th scope="col" className="py-1.5 text-right font-semibold">
              Actual
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const over = overPlan(row);
            return (
              <tr key={row.phase}>
                <th scope="row" className="py-1.5 pr-4 font-semibold">
                  {row.label}
                </th>
                <td className="py-1.5 pr-4 text-right font-mono tabular-nums text-muted-foreground">{formatMinutes(row.plannedMinutes)} min</td>
                <td className={cn("py-1.5 text-right font-mono tabular-nums", over ? "font-semibold text-warning" : "text-foreground")}>
                  {formatMinutes(row.actualMinutes)} min{over ? <span className="ml-1 font-sans">(over)</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export function TimingSection({ scorecard }: { scorecard: Scorecard }) {
  const rows = scorecard.phaseTiming ?? [];
  if (rows.length === 0 && scorecard.timeline.length === 0) return null;

  return (
    <section id="timing" aria-labelledby="timing-heading" className="scroll-mt-16">
      <SectionTitle id="timing-heading" aside="Your plan against what happened">
        Where the time went
      </SectionTitle>
      <Card variant="raised" className="p-5 sm:p-6">
        {rows.length > 0 ? <TimingRows rows={rows} /> : null}

        {scorecard.timeline.length > 0 ? (
          <div className={cn(rows.length > 0 && "mt-6 border-t border-border pt-5")}>
            <h3 className="mb-2 text-body font-semibold">Key moments</h3>
            <ol className="space-y-1.5 border-l-2 border-border pl-4">
              {scorecard.timeline.map((moment, index) => (
                <li key={index} className="flex gap-3 text-ui">
                  <span className="w-12 shrink-0 font-mono text-meta leading-[18px] tabular-nums text-muted-foreground">{moment.at}</span>
                  <span>{moment.note}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
