/**
 * Escape that closes a layer must not also reach the room's window listener, which stops a spoken reply.
 * Radix hears the key on the document in the capture phase, so stopping it there keeps it from the window.
 */
export function containEscape<E extends { stopPropagation: () => void }>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

/** The page behind a dialog blurs and dims toward the brand ink, so the dialog reads as the only thing in focus. */
export const OVERLAY_SURFACE = "fixed inset-0 z-50 bg-[rgb(12_14_40/0.4)] backdrop-blur-md dark:bg-[rgb(4_5_12/0.6)]";

export const OVERLAY_MOTION =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:duration-300 data-[state=closed]:duration-150";

export const FLOATING_MOTION =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-[0.97] data-[state=closed]:zoom-out-[0.97] data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[state=open]:duration-150 data-[state=closed]:duration-100";

export const FLOATING_SURFACE = "surface-float rounded-md border border-border bg-popover text-popover-foreground";
