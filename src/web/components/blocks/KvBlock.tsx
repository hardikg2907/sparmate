import type { KvBlock as KvBlockType } from "../../../shared/blocks";

export interface KvBlockProps {
  block: KvBlockType;
}

export function KvBlock({ block }: KvBlockProps) {
  return (
    <dl className="divide-y divide-border border-y border-border text-ui">
      {block.rows.map((row, index) => (
        <div key={index} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted-foreground">{row.key}</dt>
          <dd className="text-right font-medium tabular-nums text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
