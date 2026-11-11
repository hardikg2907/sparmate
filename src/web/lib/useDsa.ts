import { useCallback, useEffect, useRef, useState } from "react";
import type { DsaResponse } from "../../shared/dsa";
import { api } from "../backend";
import { useLocalDay } from "./useNow";

export interface DsaData {
  /** Null until the first answer arrives, or when the server could not be reached. */
  response: DsaResponse | null;
  loading: boolean;
  /** The server itself could not be reached, which differs from LeetCode failing. */
  unreachable: boolean;
  refreshing: boolean;
  refresh: () => void;
}

/** The DSA numbers. Pass `enabled: false` to skip the request, and the username so a changed name is read again. */
export function useDsa(enabled = true, username?: string): DsaData {
  const [response, setResponse] = useState<DsaResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [unreachable, setUnreachable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  // The server counts the week of the day it is asked on, so a page open across midnight asks again. The numbers it
  // already shows stay up while it does.
  const day = useLocalDay();
  const shown = useRef(false);

  useEffect(() => {
    alive.current = true;
    if (!enabled) {
      setLoading(false);
      return () => {
        alive.current = false;
      };
    }
    if (!shown.current) setLoading(true);
    api.dsa().then(
      (value) => {
        if (!alive.current) return;
        shown.current = true;
        setResponse(value);
        setUnreachable(false);
        setLoading(false);
      },
      () => {
        if (!alive.current) return;
        setUnreachable(true);
        setLoading(false);
      },
    );
    return () => {
      alive.current = false;
    };
  }, [enabled, username, day]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    api.refreshDsa().then(
      (value) => {
        if (!alive.current) return;
        setResponse(value);
        setUnreachable(false);
        setRefreshing(false);
      },
      () => {
        if (!alive.current) return;
        setUnreachable(true);
        setRefreshing(false);
      },
    );
  }, []);

  return { response, loading, unreachable, refreshing, refresh };
}
