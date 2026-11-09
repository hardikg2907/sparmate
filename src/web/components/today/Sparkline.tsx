const W = 120;
const H = 32;
const PAD = 4;
const MIN = 1;
const MAX = 4;

/** The judge's 1 to 4 scores as a thin line, oldest to newest, with a dot on the newest. */
export function Sparkline({ scores }: { scores: readonly number[] }) {
  if (scores.length === 0) return null;
  const x = (i: number) => (scores.length === 1 ? W / 2 : PAD + (i / (scores.length - 1)) * (W - 2 * PAD));
  const y = (s: number) => PAD + ((MAX - Math.min(MAX, Math.max(MIN, s))) / (MAX - MIN)) * (H - 2 * PAD);
  const points = scores.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(" ");
  const last = scores.length - 1;
  return (
    <svg role="img" aria-label={`Scores, oldest to newest: ${scores.join(", ")}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0 overflow-visible">
      {scores.length > 1 ? <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}
      <circle cx={x(last)} cy={y(scores[last] ?? MIN)} r="3.5" fill="var(--primary)" />
    </svg>
  );
}
