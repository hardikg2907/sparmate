import { cn } from "../ui";

type LineKind = "meta" | "hunk" | "add" | "del" | "context";

const LINE_CLASS: Record<LineKind, string> = {
  meta: "bg-muted text-muted-foreground",
  hunk: "bg-primary-soft text-primary-soft-foreground",
  add: "bg-diff-add text-diff-add-text",
  del: "bg-diff-del text-diff-del-text",
  context: "text-foreground",
};

function kindOf(line: string): LineKind {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("Index:") || line.startsWith("===")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

/** A unified diff. The leading + and - stay visible so the colours are never the only signal. */
export function DiffView({ file, diff }: { file: string; diff: string }) {
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <div role="region" aria-label={`Changes to ${file}`} tabIndex={0} className="max-h-96 overflow-auto rounded-md border border-border bg-card font-mono text-ui leading-5">
      <div className="min-w-max">
        {lines.map((line, index) => (
          <div key={index} className={cn("whitespace-pre px-3", LINE_CLASS[kindOf(line)])}>
            {line === "" ? " " : line}
          </div>
        ))}
      </div>
    </div>
  );
}
