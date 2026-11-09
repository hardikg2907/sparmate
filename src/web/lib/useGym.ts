import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { GymSummary } from "../../shared/drills";
import { ApiError, api } from "../backend";

export interface GymData {
  gym: GymSummary | null;
  /** The summary could not be loaded. Null while it loads and after it loads. */
  error: string | null;
  reload: () => void;
}

/** The Gym queue for the pages that show a count or a link to it. A failed read leaves `gym` empty and the page without it. */
export function useGym(): GymData {
  const [gym, setGym] = useState<GymSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api.gym().then(setGym, (failure: unknown) => setError(failure instanceof ApiError && failure.message ? failure.message : "The drills could not be loaded."));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { gym, error, reload: load };
}

/** A fixed count for pages rendered from static data, which have no server to ask. */
export const DueDrillCountContext = createContext<number | null>(null);

/** The due-drill count for the main bar. Zero until it is known, so the bar never shows a count it is unsure of. */
export function useDueDrillCount(): number {
  const fixed = useContext(DueDrillCountContext);
  const { gym } = useGym();
  return fixed ?? gym?.dueCount ?? 0;
}
