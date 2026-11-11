import { useCallback, useEffect, useState } from "react";
import type { Mode } from "../../shared/phases";
import type { ProblemSummary, SessionHistoryItem } from "../../shared/types";
import { ApiError, api } from "../backend";
import { navigate } from "../router";
import { useLocalDay } from "./useNow";

export interface GapFocus {
  title: string;
  goodLooksLike: string;
  /** The debriefed round the gap comes from, so a passed gap round can mark it there. */
  sourceSessionId?: string;
}

/** What every study page needs: the lists, and the actions that change a round. */
export interface StudyData {
  problems: ProblemSummary[] | null;
  history: SessionHistoryItem[] | null;
  /** The problem list could not be loaded. */
  error: string | null;
  reload: () => void;
  /** Which start is running: "<problemId>:<mode>", or "<problemId>:gap". */
  starting: string | null;
  startError: string | null;
  start: (problemId: string, mode: Mode, focus?: GapFocus) => void;
  /** Id of the round being ended or discarded right now. */
  working: string | null;
  actionError: string | null;
  discard: (sessionId: string) => Promise<void>;
  endAndDebrief: (sessionId: string) => Promise<void>;
}

export function startKey(problemId: string, mode: Mode, focus?: GapFocus): string {
  return `${problemId}:${focus ? "gap" : mode}`;
}

/** A 409 on "end" means the round already ended somewhere else, so the page it leads to is the right place to go. */
export function endedElsewhere(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

export function useStudyData(): StudyData {
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [history, setHistory] = useState<SessionHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [p, h] = await Promise.allSettled([api.problems(), api.history()]);
    if (p.status === "fulfilled") setProblems(p.value);
    else setError(messageOf(p.reason, "The problem list could not be loaded."));
    // History is secondary: an empty list is better than blocking the page.
    setHistory(h.status === "fulfilled" ? h.value : []);
  }, []);

  const day = useLocalDay();
  useEffect(() => {
    void load();
  }, [load, day]);

  const start = useCallback((problemId: string, mode: Mode, focus?: GapFocus) => {
    setStarting(startKey(problemId, mode, focus));
    setStartError(null);
    api
      .createSession({
        problemId,
        mode,
        ...(focus ? { focus: { title: focus.title, goodLooksLike: focus.goodLooksLike, ...(focus.sourceSessionId ? { sourceSessionId: focus.sourceSessionId } : {}) } } : {}),
      })
      .then(
        ({ sessionId }) => navigate(`/session/${sessionId}`),
        (failure: unknown) => {
          setStartError(messageOf(failure, "The round could not be started."));
          setStarting(null);
        },
      );
  }, []);

  const discard = useCallback(
    async (sessionId: string) => {
      setWorking(sessionId);
      setActionError(null);
      try {
        await api.discardSession(sessionId);
      } catch (failure) {
        // A round that is already gone (deleted in another tab) is what the user wanted.
        if (!(failure instanceof ApiError && failure.status === 404)) setActionError(messageOf(failure, "The round could not be discarded."));
      }
      await load();
      setWorking(null);
    },
    [load],
  );

  const endAndDebrief = useCallback(async (sessionId: string) => {
    setWorking(sessionId);
    setActionError(null);
    try {
      await api.endSession(sessionId);
      navigate(`/session/${sessionId}`);
    } catch (failure) {
      if (endedElsewhere(failure)) {
        navigate(`/session/${sessionId}`);
        return;
      }
      setActionError(messageOf(failure, "The round could not be ended."));
      setWorking(null);
    }
  }, []);

  return { problems, history, error, reload: () => void load(), starting, startError, start, working, actionError, discard, endAndDebrief };
}
