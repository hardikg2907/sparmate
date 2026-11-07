import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { buttonVariants } from "./button";
import { DIALOG_CONTENT_MOTION, DIALOG_SURFACE } from "./dialog";
import { containEscape, OVERLAY_MOTION, OVERLAY_SURFACE } from "./layer";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({ className, onEscapeKeyDown, ...rest }: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className={cn(OVERLAY_SURFACE, OVERLAY_MOTION)} />
      <AlertDialogPrimitive.Content className={cn(DIALOG_SURFACE, DIALOG_CONTENT_MOTION, "max-w-md", className)} onEscapeKeyDown={containEscape(onEscapeKeyDown)} {...rest} />
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-2 px-6 pb-2 pt-5", className)} {...rest} />;
}

export function AlertDialogFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-6 py-3.5", className)} {...rest} />;
}

export function AlertDialogTitle({ className, ...rest }: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title className={cn("text-lead font-semibold text-foreground", className)} {...rest} />;
}

export function AlertDialogDescription({ className, ...rest }: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return <AlertDialogPrimitive.Description className={cn("text-body leading-relaxed text-foreground", className)} {...rest} />;
}

export function AlertDialogAction({ className, ...rest }: ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return <AlertDialogPrimitive.Action className={cn(buttonVariants({ variant: "default" }), className)} {...rest} />;
}

export function AlertDialogCancel({ className, ...rest }: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: "outline" }), className)} {...rest} />;
}
