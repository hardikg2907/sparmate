import type { ReactNode } from "react";
import type { DrillType } from "../../shared/drills";

function Svg({ size = 18, className, children }: { size?: number; className?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className ?? ""}`}
    >
      {children}
    </svg>
  );
}

export function DumbbellIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <Svg size={size} className={className}>
      <path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12" />
    </Svg>
  );
}

/** One glyph per drill type, so a list of drills can be told apart at a glance. */
export function DrillIcon({ drill, size, className }: { drill: DrillType; size?: number; className?: string }) {
  switch (drill) {
    case "capacity":
      return (
        <Svg size={size} className={className}>
          <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
          <path d="M8 8h8M8 12.5h.01M12 12.5h.01M16 12.5h.01M8 16.5h.01M12 16.5h.01M16 16.5h.01" />
        </Svg>
      );
    case "walk":
      return (
        <Svg size={size} className={className}>
          <circle cx="5" cy="6" r="2" />
          <circle cx="19" cy="18" r="2" />
          <path d="M7 6h7a3.5 3.5 0 0 1 0 7H10a3.5 3.5 0 0 0 0 7h7" />
        </Svg>
      );
    case "requirements":
      return (
        <Svg size={size} className={className}>
          <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
        </Svg>
      );
    case "deep_dive":
      return (
        <Svg size={size} className={className}>
          <path d="M12 3v14M6 11l6 6 6-6M5 21h14" />
        </Svg>
      );
    default:
      return (
        <Svg size={size} className={className}>
          <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
        </Svg>
      );
  }
}
