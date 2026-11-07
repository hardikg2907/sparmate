import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { BoardPin } from "../../shared/types";
import { controlRects, coveredBy, sameRects, topControlsBottom, type Rect } from "./pinCover";
import { elementBounds } from "./stepFrames";

/** Half a pin plus its glow, so neither touches a control. */
const PIN_REACH = 15;

export const PIN_TONE_LABEL: Record<BoardPin["tone"], string> = { note: "Guide's note", held: "Held", gap: "Gap" };

/** Where a pin sits on an element: the top-right corner of a box, the middle of an arrow. */
export function pinAnchor(el: Record<string, unknown>): { x: number; y: number } {
  const b = elementBounds(el);
  return Array.isArray(el.points) ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: b.x + b.w, y: b.y };
}

/**
 * The AI's pins drawn over the canvas. They are page elements, not scene elements, so he can never move or delete
 * one by accident, and they follow Excalidraw's scroll and zoom through its own coordinate conversion.
 */
export function PinLayer({ api, pins }: { api: ExcalidrawImperativeAPI | null; pins: readonly BoardPin[] }) {
  const [, setTick] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const popId = useId();
  const layer = useRef<HTMLDivElement>(null);
  const [controls, setControls] = useState<readonly Rect[]>([]);

  // Excalidraw's controls move with the window size and appear with a selection, so they are measured after every
  // redraw. The new list only causes one more render when a control actually moved.
  useLayoutEffect(() => {
    const el = layer.current;
    const root = el?.parentElement;
    if (!el || !root) return;
    const box = el.getBoundingClientRect();
    const next = controlRects(root, box);
    setControls((prev) => (sameRects(prev, next) ? prev : next));
  });

  useEffect(() => {
    if (!api || pins.length === 0) return;
    let frame = 0;
    const bump = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTick((t) => t + 1);
      });
    };
    const offScroll = api.onScrollChange(bump);
    const offChange = api.onChange(bump);
    window.addEventListener("resize", bump);
    return () => {
      offScroll();
      offChange();
      window.removeEventListener("resize", bump);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [api, pins.length]);

  if (!api || pins.length === 0) return null;
  const appState = api.getAppState();
  const byId = new Map(api.getSceneElements().map((el) => [el.id, el as unknown as Record<string, unknown>]));
  const shown = pins.flatMap((pin, index) => {
    const el = byId.get(pin.elementId);
    if (!el) return [];
    const anchor = pinAnchor(el);
    const view = sceneCoordsToViewportCoords({ sceneX: anchor.x, sceneY: anchor.y }, appState);
    const x = view.x - appState.offsetLeft;
    const y = view.y - appState.offsetTop;
    if (x < -12 || y < -12 || x > appState.width + 12 || y > appState.height + 12) return [];
    if (coveredBy(x, y, PIN_REACH, controls)) return [];
    return [{ pin, n: index + 1, x, y }];
  });
  const openId = pinned ?? hovered;
  const open = shown.find((s) => s.pin.id === openId);
  const topClear = topControlsBottom(controls, appState.height);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Escape" || openId === null) return;
    // The room uses Escape to stop the spoken reply; closing a pin must not do that as well.
    event.stopPropagation();
    setPinned(null);
    setHovered(null);
  };

  return (
    <div ref={layer} className="ir-pins" aria-label="Notes pinned to the board" role="group">
      {shown.map(({ pin, n, x, y }) => (
        <button
          key={pin.id}
          type="button"
          className="ir-pin"
          data-tone={pin.tone}
          style={{ left: x, top: y }}
          aria-label={`Pin ${n}, ${PIN_TONE_LABEL[pin.tone]}: ${pin.note}`}
          aria-expanded={pinned === pin.id}
          aria-describedby={openId === pin.id ? popId : undefined}
          onMouseEnter={() => setHovered(pin.id)}
          onMouseLeave={() => setHovered((h) => (h === pin.id ? null : h))}
          onFocus={() => setHovered(pin.id)}
          onBlur={() => setHovered((h) => (h === pin.id ? null : h))}
          onClick={() => setPinned((p) => (p === pin.id ? null : pin.id))}
          onKeyDown={onKeyDown}
        >
          {n}
        </button>
      ))}
      {open ? (
        <div
          id={popId}
          role="tooltip"
          className="ir-pin-pop"
          data-tone={open.pin.tone}
          data-below={open.y - topClear < 120 ? "true" : undefined}
          style={{ left: Math.min(Math.max(open.x, 130), appState.width - 130), top: open.y }}
        >
          <p className="ir-pin-pop__head">
            <span aria-hidden="true" />
            Pin {open.n} · {PIN_TONE_LABEL[open.pin.tone]}
          </p>
          <p>{open.pin.note}</p>
        </div>
      ) : null}
    </div>
  );
}
