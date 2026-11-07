export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Excalidraw's own controls over the canvas: the top toolbar, the menu button, the shape properties panel, zoom, undo and redo, and help. */
export const BOARD_CONTROLS = [
  ".App-toolbar",
  ".main-menu-trigger",
  ".App-menu__left",
  ".zoom-actions",
  ".undo-redo-buttons",
  ".help-icon",
  ".layer-ui__wrapper__top-right > *",
].join(", ");

/**
 * A pin is drawn only where it touches none of the board's controls. A pin that sat under one would still take focus
 * and could open its note over the control, so it waits until its element is scrolled into the open canvas.
 */
export function coveredBy(x: number, y: number, radius: number, rects: readonly Rect[]): boolean {
  return rects.some((r) => x + radius > r.x && x - radius < r.x + r.w && y + radius > r.y && y - radius < r.y + r.h);
}

/** The lowest edge of the controls along the top of the board, so a note opens below a pin that sits close to them. */
export function topControlsBottom(rects: readonly Rect[], height: number): number {
  return rects.reduce((low, r) => (r.y < height / 2 ? Math.max(low, r.y + r.h) : low), 0);
}

/** Control boxes in the pin layer's own coordinates. Empty boxes belong to controls that are not shown. */
export function controlRects(root: ParentNode, origin: { left: number; top: number }): Rect[] {
  const rects: Rect[] = [];
  for (const el of root.querySelectorAll(BOARD_CONTROLS)) {
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    rects.push({ x: b.left - origin.left, y: b.top - origin.top, w: b.width, h: b.height });
  }
  return rects;
}

export function sameRects(a: readonly Rect[], b: readonly Rect[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => {
      const o = b[i];
      return o !== undefined && r.x === o.x && r.y === o.y && r.w === o.w && r.h === o.h;
    })
  );
}
