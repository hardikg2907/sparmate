import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

export { toast } from "sonner";

/** One toaster per page. Toasts confirm what just happened; anything the user must act on stays on the page. */
export function Toaster({ theme }: { theme: "light" | "dark" }) {
  return (
    <Sonner
      theme={theme}
      position="bottom-left"
      duration={3200}
      gap={8}
      closeButton={false}
      toastOptions={{ classNames: { toast: "!font-sans !text-ui !shadow-md !rounded-md", description: "!text-muted-foreground" } }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--popover)",
          "--success-text": "var(--success)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--destructive)",
          "--error-border": "var(--border)",
        } as CSSProperties
      }
    />
  );
}
