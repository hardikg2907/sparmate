import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const KEY = "sparmate-chat-width";
const MIN = 300;
const MAX = 640;
const DEFAULT = 380;
const STEP = 24;

function clamp(value: number): number {
  return Math.min(MAX, Math.max(MIN, Math.round(value)));
}

function readStored(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isFinite(value) && value > 0 ? clamp(value) : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Width of the right-hand chat column, kept per browser so the choice survives a reload. */
export function useChatWidth(): [number, (value: number) => void] {
  const [width, setWidth] = useState(readStored);
  const set = useCallback((value: number) => {
    const next = clamp(value);
    setWidth(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // Not saving the width is fine.
    }
  }, []);
  return [width, set];
}

/** A thin vertical bar between the work area and the chat. Drag it, or focus it and use the arrow keys. */
export function ChatResizeHandle({ width, onChange }: { width: number; onChange: (value: number) => void }) {
  const dragging = useRef(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = previous;
    };
  }, [active]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    setActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onChange(window.innerWidth - event.clientX);
  };
  const stop = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    setActive(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") onChange(width + STEP);
    else if (event.key === "ArrowRight") onChange(width - STEP);
    else if (event.key === "Home") onChange(MIN);
    else if (event.key === "End") onChange(MAX);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat panel"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none"
    >
      <span className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${active ? "bg-primary" : "bg-border group-hover:bg-input"}`} />
    </div>
  );
}
