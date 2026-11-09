import { formatMinutes } from "../../lib/format";
import { Card } from "../ui";

/** Below this share of the bar a step is named in the legend, because its name would not fit under the bar. */
const NAMED_SHARE = 0.12;

function shade(index: number, count: number): string {
  const mix = count > 1 ? Math.round((index / (count - 1)) * 100) : 0;
  return `color-mix(in oklab, var(--brand-violet) ${mix}%, var(--primary))`;
}

export function PlanPreview({ plan, caption }: { plan: readonly { id: string; label: string; minutes: number }[]; caption: string }) {
  const total = plan.reduce((sum, p) => sum + p.minutes, 0);
  const short = plan.flatMap((p, index) => (p.minutes / total < NAMED_SHARE ? [{ ...p, index }] : []));
  return (
    <Card variant="raised" aria-labelledby="plan-preview-title" className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="plan-preview-title" className="text-body font-semibold">
          Plan preview
        </h2>
        <p className="text-meta text-muted-foreground">{caption}</p>
      </div>
      <ol className="mt-4 flex gap-1">
        {plan.map((p, index) => (
          <li key={p.id} style={{ flexGrow: p.minutes, flexBasis: 0 }} className="min-w-0">
            <span aria-hidden="true" className="block h-7 rounded-md opacity-85" style={{ background: shade(index, plan.length) }} />
            <span className="mt-2 block text-meta tabular-nums text-foreground">{formatMinutes(p.minutes)}</span>
            {p.minutes / total >= NAMED_SHARE ? <span className="block truncate text-meta text-muted-foreground">{p.label}</span> : null}
          </li>
        ))}
      </ol>
      {short.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-meta text-muted-foreground">
          {short.map((p) => (
            <li key={p.id} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-sm opacity-85" style={{ background: shade(p.index, plan.length) }} />
              {p.label} {formatMinutes(p.minutes)}m
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
