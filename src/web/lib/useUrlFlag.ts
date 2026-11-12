import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

/**
 * A yes/no choice kept in one query parameter, so a reload or a shared address brings it back. Setting it replaces
 * the current history entry and keeps the other parameters and the section anchor.
 */
export function useUrlFlag(name: string, value: string): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(location.search).get(name) === value,
    () => false,
  );
  const set = useCallback(
    (next: boolean) => {
      const url = new URL(location.href);
      if (next) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
      history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
      for (const listener of [...listeners]) listener();
    },
    [name, value],
  );
  return [on, set];
}
