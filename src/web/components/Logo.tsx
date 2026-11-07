/** The app mark: two interlocking strokes. Drawn in currentColor so it follows the surrounding text colour; the lower stroke is a tint. */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true" focusable="false" className={className}>
      <g stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 24.5h13a4.25 4.25 0 0 0 0-8.5h-5" opacity=".55" />
        <path d="M25 7.5H12a4.25 4.25 0 0 0 0 8.5h3" />
      </g>
    </svg>
  );
}
