import { formatMinutes } from "../../lib/format";
import { Card } from "../ui";

/** Below this share of the bar a step shows only its minutes, because its name would not fit. */
const NAMED_SHARE = 0.12;

export function PlanPreview({ plan, caption }: { plan: readonly { id: string; label: string; minutes: number }[]; caption: string }) {
  const total = plan.reduce((sum, p) => sum + p.minutes, 0);
  return (
    <Card variant="raised" aria-labelledby="plan-preview-title" className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="plan-preview-title" className="text-body font-semibold">
          Plan preview
        </h2>
        <p className="text-meta text-muted-foreground">{caption}</p>
      </div>
      <ol className="mt-4 flex gap-1">
        {plan.map((p, index) => {
          const named = p.minutes / total >= NAMED_SHARE;
          const mix = plan.length > 1 ? Math.round((index / (plan.length - 1)) * 100) : 0;
          return (
            <li key={p.id} title={`${p.label}, ${p.minutes} min`} style={{ flexGrow: p.minutes, flexBasis: 0 }} className="min-w-0">
              <span aria-hidden="true" className="block h-7 rounded-md" style={{ background: `color-mix(in oklab, var(--brand-violet) ${mix}%, var(--primary))`, opacity: 0.85 }} />
              <span className="mt-2 block text-meta tabular-nums text-foreground">{formatMinutes(p.minutes)}</span>
              {named ? <span className="block truncate text-meta text-muted-foreground">{p.label}</span> : <span className="sr-only">{p.label}</span>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
