export interface View {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface PlacedElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  containerId?: string | null;
}

interface Point {
  x: number;
  y: number;
}

const GAP = 48;
const RINGS = 6;

/** Centre of the visible canvas in scene coordinates. */
function viewCentre(view: View): Point {
  return { x: view.width / 2 / view.zoom - view.scrollX, y: view.height / 2 / view.zoom - view.scrollY };
}

/**
 * The spot nearest the middle of the view where a shape of this size overlaps no drawn content, so repeated inserts sit side by side.
 * Frames are containers, not obstacles: when the centre is inside one, the shape must stay whole inside it. A full view falls back to the centre.
 */
export function freeInsertPoint(view: View, elements: readonly PlacedElement[], size: { width: number; height: number }): Point {
  const centre = viewCentre(view);
  const frame = smallestFrameAt(elements, centre);
  const obstacles = elements.filter((el) => el.type !== "frame" && el.isDeleted !== true && !el.containerId);
  const stepX = size.width + GAP;
  const stepY = size.height + GAP;
  const fits = (p: Point) => {
    const left = p.x - size.width / 2 - GAP / 2;
    const top = p.y - size.height / 2 - GAP / 2;
    const right = left + size.width + GAP;
    const bottom = top + size.height + GAP;
    if (frame && (left < frame.x || top < frame.y || right > frame.x + frame.width || bottom > frame.y + frame.height)) return false;
    return obstacles.every((b) => right <= b.x || left >= b.x + b.width || bottom <= b.y || top >= b.y + b.height);
  };
  for (let ring = 0; ring <= RINGS; ring++) {
    const candidates: Point[] = [];
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) candidates.push({ x: centre.x + dx * stepX, y: centre.y + dy * stepY });
      }
    }
    // Reading order inside a ring: rows top to bottom, each left to right.
    candidates.sort((a, b) => a.y - b.y || a.x - b.x);
    const spot = candidates.find(fits);
    if (spot) return spot;
  }
  return centre;
}

function smallestFrameAt(elements: readonly PlacedElement[], p: Point): PlacedElement | null {
  let best: PlacedElement | null = null;
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted === true) continue;
    if (p.x < el.x || p.x > el.x + el.width || p.y < el.y || p.y > el.y + el.height) continue;
    if (best === null || el.width * el.height < best.width * best.height) best = el;
  }
  return best;
}
