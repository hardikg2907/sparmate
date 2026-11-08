import { Dialog as DialogPrimitive } from "radix-ui";
import { useRef, useState, type ReactNode } from "react";
import { CrossIcon } from "./icons";
import { DialogOverlay } from "./ui/dialog";
import { containEscape, OVERLAY_MOTION } from "./ui/layer";

/**
 * A panel that slides in from the right for the detail a page keeps off its surface. Its parent mounts it to open
 * and unmounts it to close; it plays its exit first, then calls onClose and hands focus back.
 */
export function SidePanel({ kicker, title, onClose, children, footer }: { kicker?: string; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const [open, setOpen] = useState(true);
  const previous = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const close = useRef(onClose);
  close.current = onClose;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && setOpen(false)}>
      <DialogPrimitive.Portal>
        <DialogOverlay className={OVERLAY_MOTION} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onEscapeKeyDown={containEscape()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previous.current?.focus();
            close.current();
          }}
          className="surface-float fixed inset-y-0 right-0 z-50 flex w-full max-w-[500px] flex-col border-l border-border bg-card text-card-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right data-[state=open]:duration-300 data-[state=closed]:duration-150"
        >
          <div className="flex shrink-0 items-start justify-between gap-4 px-8 pb-2 pt-7">
            <div className="min-w-0">
              {kicker ? <p className="truncate text-ui text-muted-foreground">{kicker}</p> : null}
              <DialogPrimitive.Title className="text-title font-bold tracking-[-0.01em] text-foreground">{title}</DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <CrossIcon size={16} />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-4">{children}</div>
          {footer ? <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border px-8 py-5">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
