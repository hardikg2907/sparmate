import { useState } from "react";
import type { ProblemSummary, SessionHistoryItem } from "../../shared/types";
import type { StudyData } from "../lib/useStudyData";

/** The same shape as the live data, over static lists. A start only shows its busy state, and a discard or an end edits the list. */
export function useFixtureStudyData(problems: ProblemSummary[], initial: SessionHistoryItem[], busyStart: string | null = null): StudyData {
  const [history, setHistory] = useState(initial);
  const [starting, setStarting] = useState<string | null>(busyStart);
  const [working, setWorking] = useState<string | null>(null);
  return {
    problems,
    history,
    error: null,
    reload: () => {},
    starting,
    startError: null,
    start: (id, mode, focus) => {
      setStarting(`${id}:${focus ? "gap" : mode}`);
      setTimeout(() => setStarting(null), 1500);
    },
    working,
    actionError: null,
    discard: async (id) => {
      setHistory((items) => items.filter((item) => item.id !== id));
    },
    endAndDebrief: async (id) => {
      setWorking(id);
      setTimeout(() => {
        setHistory((items) => items.map((item) => (item.id === id ? { ...item, status: "ended", pause: null } : item)));
        setWorking(null);
      }, 600);
    },
  };
}
