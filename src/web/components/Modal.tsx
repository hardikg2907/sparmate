import { useRef, useState, type ReactNode } from "react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { cn } from "../lib/utils";

/**
 * A dialog that its parent mounts to open and unmounts to close. It keeps itself open through the exit
 * animation and calls onClose once that ends, then hands focus back to whatever had it before.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  role = "dialog",
  width = "max-w-xl",
  dismissible = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  role?: "dialog" | "alertdialog";
  width?: string;
  /** False while the dialog runs something that must finish first; Escape, outside clicks and Close do nothing. */
  dismissible?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const content = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const close = useRef(onClose);
  close.current = onClose;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismissible && setOpen(false)}>
      <DialogContent
        ref={content}
        role={role}
        aria-describedby={undefined}
        hideClose={!dismissible}
        className={cn(width)}
        onOpenAutoFocus={(event) => {
          const target = content.current?.querySelector<HTMLElement>("[data-autofocus]");
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          previous.current?.focus();
          close.current();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
