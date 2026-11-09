import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { CrossIcon } from "../icons";
import { containEscape, OVERLAY_MOTION, OVERLAY_SURFACE } from "./layer";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({ className, ...rest }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay className={cn(OVERLAY_SURFACE, OVERLAY_MOTION, className)} {...rest} />;
}

export const DIALOG_CONTENT_MOTION =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-[0.95] data-[state=closed]:zoom-out-[0.97] data-[state=open]:slide-in-from-bottom-2 data-[state=open]:ease-out-quick data-[state=open]:duration-[260ms] data-[state=closed]:duration-150";

export const DIALOG_SURFACE =
  "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card bg-linear-to-b from-raised to-card to-40% text-card-foreground surface-float outline-none";

export function DialogContent({ className, children, hideClose, onEscapeKeyDown, ...rest }: ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content className={cn(DIALOG_SURFACE, DIALOG_CONTENT_MOTION, "max-w-xl", className)} onEscapeKeyDown={containEscape(onEscapeKeyDown)} {...rest}>
        {/* First in the DOM, so a dialog with no chosen focus target opens with focus on Close, not on a choice. */}
        {hideClose ? null : (
          <DialogPrimitive.Close aria-label="Close" className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <CrossIcon size={18} />
          </DialogPrimitive.Close>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 flex-col gap-1 px-6 pb-2 pr-14 pt-5", className)} {...rest} />;
}

/** Only the body scrolls, so the actions in the footer stay in view on a short screen. */
export function DialogBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 overflow-y-auto px-6 py-4", className)} {...rest} />;
}

export function DialogFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-sunken px-6 py-3.5", className)} {...rest} />;
}

export function DialogTitle({ className, ...rest }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-title font-bold text-foreground", className)} {...rest} />;
}

export function DialogDescription({ className, ...rest }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-ui text-muted-foreground", className)} {...rest} />;
}
