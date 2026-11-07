/** The app mark: a doorway into the room. Drawn in currentColor so it follows the surrounding text colour. */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true" focusable="false" className={className}>
      <path d="M5 27V7H27V27H20V14H12V27Z" fill="currentColor" />
      <path d="M13 22L16 18L19 22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
