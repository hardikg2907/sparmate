import { cn } from "../../lib/utils";
import { SpinnerIcon } from "../icons";

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-muted-foreground", className)} role="status">
      <SpinnerIcon size={16} />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}
