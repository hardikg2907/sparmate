import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/**
 * Four surfaces, so a page reads in layers instead of as a grid of identical boxes. `flat` is the hairline card;
 * `raised` floats above the page for the one thing a section is about; `sunken` is a fill with no edge, for groups
 * inside another surface; `hero` is the deep panel of the usage page; `mesh` is the bolder panel of the verdict and the next round.
 */
export const cardVariants = cva("text-card-foreground", {
  variants: {
    variant: {
      flat: "surface-flat rounded-lg border border-border bg-card",
      raised: "surface-raised rounded-xl bg-raised",
      sunken: "rounded-lg bg-sunken",
      hero: "surface-hero rounded-xl text-hero-foreground",
      // The mesh panel: a near-black corner, a bright middle and a pale glow rising from the bottom.
      mesh: "mesh on-mesh rounded-3xl",
    },
  },
  defaultVariants: { variant: "flat" },
});

export function Card({ className, variant, ...rest }: HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ variant }), className)} {...rest} />;
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 px-5 pt-5", className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-lead font-semibold text-foreground", className)} {...rest} />;
}

export function CardDescription({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-ui text-muted-foreground", className)} {...rest} />;
}

export function CardContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2 border-t border-border px-5 py-3", className)} {...rest} />;
}
