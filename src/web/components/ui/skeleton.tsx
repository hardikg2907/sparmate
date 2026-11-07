import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/** A placeholder block with the shape of content that is still loading. Hidden from screen readers. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("skeleton rounded-md", className)} {...rest} />;
}
