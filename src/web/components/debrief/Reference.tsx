import type { PublicSession } from "../../../shared/types";
import { Markdown } from "../Markdown";
import { Card, Disclosure, SectionTitle } from "../ui";

export function ReferenceAnswer({ reference }: { reference: NonNullable<PublicSession["reference"]> }) {
  if (reference.sections.length === 0) return null;
  return (
    <section id="reference" aria-labelledby="reference-heading" className="scroll-mt-14">
      <SectionTitle id="reference-heading">Reference answer</SectionTitle>
      <Card variant="raised" className="p-4 sm:p-5">
        <Disclosure summary="Show the reference answer">
          <p className="mb-3 text-ui text-muted-foreground">One good answer, not the only one. Read the scorecard first, then compare.</p>
          <div className="space-y-5">
            {reference.sections.map((section) => (
              <div key={section.heading}>
                <h3 className="mb-1 text-body font-semibold">{section.heading}</h3>
                <Markdown text={section.markdown} className="text-body" />
              </div>
            ))}
            {reference.sources && reference.sources.length > 0 ? (
              <div className="border-t border-border pt-4">
                <h3 className="mb-2 text-body font-semibold">Sources</h3>
                <ul className="space-y-1 text-ui">
                  {reference.sources.map((s, idx) => (
                    <li key={idx} className="flex flex-wrap items-baseline gap-x-2">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary-text hover:underline"
                      >
                        {s.title}
                      </a>
                      <span className="break-all text-meta text-muted-foreground">({s.url})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Disclosure>
      </Card>
    </section>
  );
}
