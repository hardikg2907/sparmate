import { useEffect, useId, useRef, useState } from "react";
import type { RingView } from "../lib/steps";
import { cn } from "./ui";

/**
 * A small coverage ring. The text inside is decorative; the sentence for screen readers sits next to it.
 * With `enter`, the ring starts empty and fills once it scrolls into view, the way the debrief's meters fill.
 */
export function StepRing({
  view,
  size = 18,
  showLabel = size >= 26,
  enter = false,
  className,
}: {
  view: RingView;
  size?: number;
  showLabel?: boolean;
  enter?: boolean;
  className?: string;
}) {
  const stroke = size >= 26 ? 3 : 2.5;
  const r = (size - stroke) / 2;
  // An id with only letters and digits, because the characters React puts in ids break inside `url(#…)`.
  const gradientId = `ring-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(!enter);

  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setSeen(true);
        observer.disconnect();
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);

  const fill = seen ? view.fill : 0;
  const done = view.tone === "done";
  return (
    <span ref={ref} className={cn("relative inline-grid shrink-0 place-items-center", enter && "room-ring--enter", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--primary)" }} />
            <stop offset="1" style={{ stopColor: "var(--brand-violet)" }} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-border" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - fill}
          stroke={done ? undefined : `url(#${gradientId})`}
          className={cn("room-ring__fg", done && "stroke-success-fill", fill === 0 && "opacity-0")}
        />
      </svg>
      {showLabel ? (
        <span className="absolute font-mono text-[10px] font-semibold tabular-nums text-foreground" aria-hidden="true">
          {view.label}
        </span>
      ) : null}
      <span className="sr-only">{view.spoken}</span>
    </span>
  );
}
