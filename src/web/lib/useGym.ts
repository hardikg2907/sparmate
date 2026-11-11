import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import type { GymSummary } from "../../shared/drills";
import { ApiError, api } from "../backend";
import { useLocalDay } from "./useNow";

export interface GymData {
  gym: GymSummary | null;
  /** The summary could not be loaded. Null while it loads and after it loads. */
  error: string | null;
  reload: () => void;
}

interface GymState {
  gym: GymSummary | null;
  error: string | null;
}

/**
 * One copy of the queue for the whole page: the main bar, the tab bar and the page itself read the same data, and
 * they mounted together, so one request serves them all and a retry updates every badge.
 */
let state: GymState = { gym: null, error: null };
let inflight = false;
const listeners = new Set<() => void>();

function set(next: GymState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

export function refreshGym(): void {
  if (inflight) return;
  inflight = true;
  set({ gym: state.gym, error: null });
  api
    .gym()
    .then(
      (gym) => set({ gym, error: null }),
      (failure: unknown) => set({ gym: state.gym, error: failure instanceof ApiError && failure.message ? failure.message : "The drills could not be loaded." }),
    )
    .finally(() => {
      inflight = false;
    });
}

/** Forgets what was read, for tests. */
export function resetGymStore(): void {
  state = { gym: null, error: null };
  inflight = false;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The Gym queue for the pages that show a count or a link to it. A failed read leaves `gym` empty and the page without it. */
export function useGym(): GymData {
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  const day = useLocalDay();
  useEffect(() => {
    refreshGym();
  }, [day]);
  return { gym: current.gym, error: current.error, reload: refreshGym };
}

/** A fixed count for pages rendered from static data, which have no server to ask. */
export const DueDrillCountContext = createContext<number | null>(null);

/** The due-drill count for the main bar. Zero until it is known, so the bar never shows a count it is unsure of. */
export function useDueDrillCount(): number {
  const fixed = useContext(DueDrillCountContext);
  const { gym } = useGym();
  return fixed ?? gym?.dueCount ?? 0;
}
