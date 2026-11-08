/** The title of the redo link card: "more" only when a redo is already the hero, "waiting" when none is. */
export function redoCardTitle(count: number, heroIsRedo: boolean): string {
  const noun = count === 1 ? "redo" : "redos";
  return heroIsRedo ? `${count} more ${noun}` : `${count} ${noun} waiting`;
}
