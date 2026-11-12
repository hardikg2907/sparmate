import { flushSync } from "react-dom";

/**
 * Runs a state change inside a view transition where the browser has them. React renders the change synchronously
 * inside the callback, because the browser captures the new view when the callback returns. With reduced motion,
 * or no support, the change just happens.
 *
 * `pane` is for a change that moves or resizes one named element: the page behind it must stay still while the
 * element morphs, so the root cross-fade is switched off for the length of the transition.
 */
export function withViewTransition(update: () => void, kind: "page" | "pane" = "page"): void {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  const root = document.documentElement;
  if (kind === "pane") root.dataset.vt = "pane";
  const transition = document.startViewTransition(() => flushSync(update));
  const clear = () => {
    if (root.dataset.vt === "pane") delete root.dataset.vt;
  };
  void transition.finished.then(clear, clear);
}
