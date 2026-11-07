import type { Track } from "../../shared/phases";

/** What a discard does, in the words every confirm dialog uses. */
export function DiscardNote({ track }: { track: Track }) {
  return (
    <>
      <p>The transcript, board and score are deleted. There is no debrief. Your study files are not touched.</p>
      {track === "lld" ? <p className="mt-2">The attempt file is kept if it has code in it.</p> : null}
    </>
  );
}
