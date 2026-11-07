export type Theme = "light" | "dark";

const KEY = "ir-theme";

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage can be blocked; the theme still applies for this page load.
  }
}

/** Last theme used on this browser, applied before the first paint so a dark setting does not flash light. */
export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}
