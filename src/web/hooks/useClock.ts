import { useEffect, useState } from "react";
import type { PublicSession } from "../../shared/types";
import { finalRoundMs, roundMsAt } from "../lib/timing";

/**
 * Round time in milliseconds, computed from the clock the server sent. The browser never counts on its own:
 * it adds the offset between its clock and the server's, so a wrong system time cannot move the timer.
 */
export function useRoundMs(session: PublicSession, offsetMs: number): number {
  const running = session.status === "live";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  const ended = finalRoundMs(session);
  if (ended !== null) return ended;
  // While paused the value does not depend on the sample time, so a fresh read per render is enough.
  return roundMsAt(session.clock, (running ? now : Date.now()) + offsetMs);
}
