import type { KvBlock as KvBlockType } from "../../../shared/blocks";

export interface KvBlockProps {
  block: KvBlockType;
}

export function KvBlock({ block }: KvBlockProps) {
  return (
    <dl className="divide-y divide-border border-y border-border text-ui">
      {block.rows.map((row, index) => (
        <div key={index} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="min-w-0 [overflow-wrap:anywhere] text-muted-foreground">{row.key}</dt>
          <dd className="min-w-0 text-right font-medium tabular-nums [overflow-wrap:anywhere] text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
