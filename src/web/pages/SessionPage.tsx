// Excalidraw and Monaco are heavy and only the session page needs them, so this whole module loads on demand.
import "../monaco-setup";
import "@excalidraw/excalidraw/index.css";
import { useEffect, useMemo, useState } from "react";
import { Button, Spinner, cn } from "../components/ui";
import { Link, navigate } from "../router";
import { useSessionController } from "../session/useSession";
import { liveSource } from "../session/source";
import { useTestHooks } from "../session/testHooks";
import type { SessionSource } from "../session/types";
import type { Theme } from "../theme";
import { DebriefView } from "./Debrief";
import { RoomView } from "./Room";

export default function SessionPage({ id, theme, studyRoot }: { id: string; theme: Theme; studyRoot: string | null }) {
  const source = useMemo(() => liveSource(id), [id]);
  return <SessionRoot source={source} theme={theme} studyRoot={studyRoot} />;
}

/** The page for one session. Which view shows follows the session's status, and the same socket serves both. */
export function SessionRoot({ source, theme, studyRoot }: { source: SessionSource; theme: Theme; studyRoot: string | null }) {
  const ctl = useSessionController(source);
  useTestHooks(ctl);
  const { state } = ctl;
  const session = state.session;
  const title = session?.title;
  // "ended" belongs to the room: time is up and the interviewer is closing the round before the debrief starts.
  const roundOpen = session?.status === "live" || session?.status === "paused" || session?.status === "ended";

  // The server asks for the final board image after the round ends, so the room that holds the board
  // must stay mounted until the debrief is done.
  const [roomWasOpen, setRoomWasOpen] = useState(false);
  if (roundOpen && !roomWasOpen) setRoomWasOpen(true);
  const keepRoom = roundOpen || (roomWasOpen && session?.status !== "debriefed");

  // The server deleted the round (from here, another tab or the home page), so there is nothing left to show.
  const discarded = state.discarded;
  useEffect(() => {
    if (discarded) navigate("/", { replace: true });
  }, [discarded]);

  useEffect(() => {
    if (title) document.title = `${roundOpen ? "" : "Debrief: "}${title} - Sparmate`;
  }, [title, roundOpen]);

  if (discarded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center" role="status">
        <h1 className="text-lead font-semibold">This round was discarded.</h1>
        <Link href="/" className="rounded text-primary-text underline underline-offset-2">
          Back to Today
        </Link>
      </div>
    );
  }
  if (state.loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center" role="alert">
        <h1 className="text-lead font-semibold">{state.loadError}</h1>
        <div className="flex gap-2">
          {state.loadMissing ? null : <Button onClick={ctl.reload}>Try again</Button>}
          <Button asChild variant={state.loadMissing ? "default" : "outline"}>
            <Link href="/">Back to Today</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Opening the session…" />
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-clip">
      {keepRoom ? (
        <div className={cn("absolute inset-0 overflow-clip", !roundOpen && "pane-hidden")} inert={!roundOpen} aria-hidden={!roundOpen}>
          <RoomView ctl={ctl} session={session} theme={theme} studyRoot={studyRoot} />
        </div>
      ) : null}
      {!roundOpen ? (
        <div className="absolute inset-0 bg-background overflow-clip">
          <DebriefView ctl={ctl} session={session} theme={theme} boardImageUrl={source.boardImageUrl()} />
        </div>
      ) : null}
    </div>
  );
}
