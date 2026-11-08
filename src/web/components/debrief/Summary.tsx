import type { Scorecard } from "../../../shared/types";
import { Markdown } from "../Markdown";
import { CheckIcon } from "../icons";
import { Card, SectionTitle } from "../ui";

/** The judge's summary with what went well and the task to practise next, in one card. */
export function SummaryCard({ scorecard }: { scorecard: Scorecard }) {
  const { strengths, practiceTask, verdict } = scorecard;
  return (
    <section id="summary" aria-labelledby="summary-heading">
      <SectionTitle id="summary-heading">Summary</SectionTitle>
      <Card variant="raised" className="space-y-4 p-4 sm:p-5">
        <Markdown text={verdict.summary} className="max-w-[68ch] text-body text-foreground" />
        {strengths.length > 0 ? (
          <div>
            <h3 id="strengths-heading" className="mb-1.5 text-ui font-semibold text-foreground">
              Strengths
            </h3>
            <ul className="space-y-1.5" aria-labelledby="strengths-heading">
              {strengths.map((strength) => (
                <li key={strength} className="flex items-start gap-2 text-ui text-foreground">
                  <CheckIcon size={14} className="mt-0.5 shrink-0 text-success" />
                  <span>{strength}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {practiceTask ? (
          <div>
            <h3 className="mb-1 text-ui font-semibold text-foreground">Practice task</h3>
            <p className="text-ui text-foreground">{practiceTask}</p>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
