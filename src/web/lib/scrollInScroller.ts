export type ScrollBlock = "start" | "nearest";

export interface ScrollMath {
  /** The target's top edge and height, and the scroller's top edge, all in viewport pixels. */
  targetTop: number;
  targetHeight: number;
  scrollerTop: number;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  block: ScrollBlock;
  /** Space the target keeps from the top edge, such as a sticky bar. */
  margin: number;
}

/** The `scrollTop` that puts the target where `block` asks, kept inside the range the scroller can reach. */
export function targetScrollTop(m: ScrollMath): number {
  const max = Math.max(0, m.scrollHeight - m.clientHeight);
  const inContent = m.targetTop - m.scrollerTop + m.scrollTop;
  const start = inContent - m.margin;
  let wanted = start;
  if (m.block === "nearest") {
    const end = inContent + m.targetHeight - m.clientHeight;
    if (start < m.scrollTop) wanted = start;
    else if (end > m.scrollTop) wanted = end;
    else wanted = m.scrollTop;
  }
  return Math.min(max, Math.max(0, Math.round(wanted)));
}

function scrollableAncestor(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Scrolls the target inside its own scroller and nothing else. `Element.scrollIntoView` also moves every outer box,
 * and a box with `overflow: hidden` still scrolls from code, which pushes the whole app frame out of the window.
 * The target's `scroll-margin-top` keeps it clear of a sticky bar. Motion is smooth only when the user allows it.
 */
export function scrollToInScroller(
  target: HTMLElement | null | undefined,
  { block = "start", behavior = "auto", scroller }: { block?: ScrollBlock; behavior?: "auto" | "smooth"; scroller?: HTMLElement | null } = {},
): void {
  if (!target) return;
  const box = scroller ?? scrollableAncestor(target);
  if (!box) return;
  const margin = block === "nearest" ? 0 : Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  const rect = target.getBoundingClientRect();
  const top = targetScrollTop({
    targetTop: rect.top,
    targetHeight: rect.height,
    scrollerTop: box.getBoundingClientRect().top,
    scrollTop: box.scrollTop,
    clientHeight: box.clientHeight,
    scrollHeight: box.scrollHeight,
    block,
    margin,
  });
  box.scrollTo({ top, behavior: behavior === "smooth" && !reducedMotion() ? "smooth" : "auto" });
}
