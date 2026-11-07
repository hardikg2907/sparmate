/** Checks whether a chat panel element is currently visible and interactive. */
export function isPanelActiveAndVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  // Ancestor containers use inert and pane-hidden to deactivate background tabs.
  if (el.closest("[inert], .pane-hidden, [aria-hidden='true']")) {
    return false;
  }
  // Modern browsers provide checkVisibility to verify CSS computed display and visibility.
  if (typeof el.checkVisibility === "function") {
    if (!el.checkVisibility({ checkVisibilityCSS: true })) {
      return false;
    }
  }
  if (typeof window !== "undefined") {
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") {
      return false;
    }
  }
  return true;
}
