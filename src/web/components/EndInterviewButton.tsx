import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { Button, Tooltip, cn } from "./ui";

/** How long a press has to last to end the round without the confirm dialog. */
export const END_HOLD_MS = 1200;

const HINT = "Click to confirm, or hold to end now";

/**
 * A click, Enter or Space asks first; holding the pointer down for a moment ends the round at once. The fill shows
 * how far the hold has come, and letting go early springs it back.
 */
export function EndInterviewButton({ onConfirm, onHoldEnd, disabled }: { onConfirm: () => void; onHoldEnd: () => void; disabled?: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The click that follows a completed hold must not also open the dialog.
  const held = useRef(false);
  const hintId = useId();

  useEffect(() => () => clearTimeout(timer.current), []);

  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    held.current = false;
    setHolding(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      held.current = true;
      setHolding(false);
      onHoldEnd();
    }, END_HOLD_MS);
  };
  const cancel = () => {
    clearTimeout(timer.current);
    setHolding(false);
  };

  return (
    <>
      <span id={hintId} className="sr-only">
        {HINT}
      </span>
      <Tooltip content={HINT}>
        <Button
          variant="ghost"
          className={cn("end-hold relative touch-none overflow-hidden text-destructive hover:bg-destructive-soft hover:text-destructive")}
          data-holding={holding || undefined}
          disabled={disabled}
          aria-describedby={hintId}
          onPointerDown={start}
          onPointerUp={cancel}
          onPointerLeave={cancel}
          onPointerCancel={cancel}
          onContextMenu={(event) => event.preventDefault()}
          onClick={() => {
            if (held.current) {
              held.current = false;
              return;
            }
            onConfirm();
          }}
        >
          <span className="end-hold__fill" aria-hidden="true" />
          <span className="relative">End interview</span>
        </Button>
      </Tooltip>
    </>
  );
}
