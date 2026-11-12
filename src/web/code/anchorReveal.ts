export const ANCHOR_RANGE_CLASS = "ir-code-anchor-range";

export interface AnchorRevealInput {
  line: number;
  endLine?: number;
  column?: number;
}

export interface AnchorRevealPlan {
  kind: "select-range" | "decorate-range" | "cursor";
  startLine: number;
  endLine: number;
  column: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Plans how a code jump or anchor highlights its target. Selecting a line range in a writable editor
 * would overwrite that whole block on the candidate's next keypress, so writable ranges place the caret
 * at the start line and paint a whole-line decoration instead.
 */
export function planAnchorReveal(reveal: AnchorRevealInput, maxLine: number, readOnly: boolean): AnchorRevealPlan {
  const lineCount = Math.max(1, maxLine);
  const startLine = clamp(reveal.line, 1, lineCount);
  const column = Math.max(1, reveal.column ?? 1);
  if (reveal.endLine !== undefined && reveal.endLine >= reveal.line) {
    const endLine = clamp(reveal.endLine, startLine, lineCount);
    if (readOnly) {
      return { kind: "select-range", startLine, endLine, column: 1 };
    }
    return { kind: "decorate-range", startLine, endLine, column };
  }
  return { kind: "cursor", startLine, endLine: startLine, column };
}

export interface AnchorDecorationEntry<TRange> {
  range: TRange;
  options: {
    isWholeLine: true;
    className: typeof ANCHOR_RANGE_CLASS;
  };
}

export interface AnchorRevealDriver<TRange, TPos> {
  getLineCount(): number;
  getLineMaxColumn(lineNumber: number): number;
  validatePosition(position: { lineNumber: number; column: number }): TPos;
  createRange(startLine: number, startColumn: number, endLine: number, endColumn: number): TRange;
  setSelection(range: TRange): void;
  setPosition(position: TPos): void;
  setAnchorDecorations(decorations: AnchorDecorationEntry<TRange>[]): void;
  clearAnchorDecorations(): void;
  revealRangeInCenter(range: TRange): void;
  revealPositionInCenter(position: TPos): void;
  focus(): void;
}

export function applyAnchorReveal<TRange, TPos>(reveal: AnchorRevealInput, readOnly: boolean, driver: AnchorRevealDriver<TRange, TPos>): AnchorRevealPlan {
  const plan = planAnchorReveal(reveal, driver.getLineCount(), readOnly);
  if (plan.kind === "select-range") {
    driver.clearAnchorDecorations();
    const range = driver.createRange(plan.startLine, 1, plan.endLine, driver.getLineMaxColumn(plan.endLine));
    driver.setSelection(range);
    driver.revealRangeInCenter(range);
    driver.focus();
    return plan;
  }
  if (plan.kind === "decorate-range") {
    const position = driver.validatePosition({ lineNumber: plan.startLine, column: plan.column });
    driver.setPosition(position);
    const range = driver.createRange(plan.startLine, 1, plan.endLine, driver.getLineMaxColumn(plan.endLine));
    driver.setAnchorDecorations([{ range, options: { isWholeLine: true, className: ANCHOR_RANGE_CLASS } }]);
    driver.revealRangeInCenter(range);
    driver.focus();
    return plan;
  }
  driver.clearAnchorDecorations();
  const position = driver.validatePosition({ lineNumber: plan.startLine, column: plan.column });
  driver.setPosition(position);
  driver.revealPositionInCenter(position);
  driver.focus();
  return plan;
}
