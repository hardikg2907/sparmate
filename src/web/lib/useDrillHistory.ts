import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AttemptView, DrillDetail, RecentAttemptRow } from "../../shared/drills";
import { ApiError, api } from "../backend";

/** Where the history pages read from. Pages rendered from static data swap in their own source. */
export interface HistorySource {
  drill: (drillId: string) => Promise<DrillDetail>;
  attempts: (limit?: number) => Promise<RecentAttemptRow[]>;
  attempt: (attemptId: string) => Promise<AttemptView>;
}

export const apiHistory: HistorySource = { drill: api.gymDrill, attempts: api.gymAttempts, attempt: api.gymAttempt };

export const HistorySourceContext = createContext<HistorySource>(apiHistory);

export function useHistorySource(): HistorySource {
  return useContext(HistorySourceContext);
}

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** The HTTP status of a refused request, so a page can tell "not found" from a failure. */
  status: number | null;
  reload: () => void;
}

interface LoadState<T> {
  key: string;
  data: T | null;
  error: string | null;
  status: number | null;
}

/** Runs `load` on mount and whenever `key` changes. A newer call wins, so a slow answer never replaces a fresher one. */
export function useLoaded<T>(load: () => Promise<T>, key: string, fallback: string): Loaded<T> {
  const [state, setState] = useState<LoadState<T>>({ key, data: null, error: null, status: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ key, data: null, error: null, status: null });
    load().then(
      (data) => live && setState({ key, data, error: null, status: null }),
      (failure: unknown) =>
        live &&
        setState({
          key,
          data: null,
          error: failure instanceof ApiError && failure.message ? failure.message : fallback,
          status: failure instanceof ApiError ? failure.status : null,
        }),
    );
    return () => {
      live = false;
    };
    // `load` is rebuilt on every render; the key and the retry counter say when to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const current: LoadState<T> = state.key === key ? state : { key, data: null, error: null, status: null };
  return { data: current.data, error: current.error, status: current.status, reload };
}
