import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches now, and again whenever it changes. False where matchMedia does not exist. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof matchMedia !== "function") return () => {};
      const list = matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => typeof matchMedia === "function" && matchMedia(query).matches,
    () => false,
  );
}
