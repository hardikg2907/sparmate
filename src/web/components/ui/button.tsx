import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "../../lib/utils";
import { SpinnerIcon } from "../icons";

export const buttonVariants = cva(
  "btn inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md border font-semibold transition-[color,background-color,border-color,box-shadow,translate] duration-150 active:translate-y-px motion-reduce:active:translate-y-0 disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "btn-primary border-transparent text-btn-primary-foreground",
        outline: "btn-outline border-input/70 bg-card text-foreground hover:bg-accent",
        // Same footprint as outline without the edge, for actions that repeat down a list.
        secondary: "btn-secondary",
        ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        destructive: "border-transparent bg-destructive-fill text-destructive-foreground shadow-xs hover:bg-destructive-fill/90",
        // Final but not urgent: tinted so it never reads as one more neutral button, without shouting all round.
        "destructive-soft": "border-transparent bg-destructive-soft text-destructive hover:border-destructive-fill/60",
        link: "h-auto border-transparent bg-transparent px-0 text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 gap-1.5 px-3 text-ui",
        default: "h-9 gap-2 px-3.5 text-ui",
        lg: "h-11 gap-2 px-5 text-body",
        icon: "size-9 text-ui",
        "icon-sm": "size-8 text-ui",
      },
    },
    defaultVariants: { variant: "outline", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Shows a spinner and blocks clicks while the action runs. */
  busy?: boolean;
  /** Renders the single child (a link) with the button's look instead of a <button>. */
  asChild?: boolean;
  /** Passed through to the <button>, so a menu or dialog can hand focus back to it. */
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant, size, busy, asChild, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot.Root className={classes} {...rest}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={classes} {...rest}>
      {busy ? <SpinnerIcon size={14} /> : null}
      {children}
    </button>
  );
}
