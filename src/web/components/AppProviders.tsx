import type { ReactNode } from "react";
import { useDocumentTheme } from "../hooks/useDocumentTheme";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Toaster } from "./ui/sonner";
import { TooltipProvider } from "./ui/tooltip";

/** The layers every page root needs: shared tooltip timing, the toast host and the shortcuts list. */
export function AppProviders({ children }: { children: ReactNode }) {
  const theme = useDocumentTheme();
  return (
    <TooltipProvider>
      {children}
      <ShortcutsDialog />
      <Toaster theme={theme} />
    </TooltipProvider>
  );
}
