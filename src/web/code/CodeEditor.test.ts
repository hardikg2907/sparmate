import { describe, expect, it, vi } from "vitest";

vi.mock("../monaco-setup", () => ({
  MONO_FONT: "monospace",
  monaco: {
    Range: class {},
    KeyMod: { CtrlCmd: 2048, WinCtrl: 256, Alt: 512 },
    KeyCode: { Space: 10, Escape: 9, KeyI: 39 },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
    editor: {
      ShowLightbulbIconMode: { Off: "off" },
      setTheme: () => {},
      setModelMarkers: () => {},
      create: () => ({}),
    },
  },
  monacoTheme: () => "vs",
  remeasureWhenFontLoads: () => {},
}));

import { ANCHOR_RANGE_CLASS, applyAnchorReveal, planAnchorReveal, type AnchorDecorationEntry, type AnchorRevealDriver } from "./CodeEditor";

interface FakeRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

interface FakePos {
  lineNumber: number;
  column: number;
}

function createFakeDriver(lineCount = 120) {
  const selections: FakeRange[] = [];
  const positions: FakePos[] = [];
  const decorationsHistory: AnchorDecorationEntry<FakeRange>[][] = [];
  let clearCount = 0;
  const centeredRanges: FakeRange[] = [];
  const centeredPositions: FakePos[] = [];
  let focusCount = 0;

  const driver: AnchorRevealDriver<FakeRange, FakePos> = {
    getLineCount: () => lineCount,
    getLineMaxColumn: (lineNumber) => 40 + lineNumber,
    validatePosition: (pos) => ({
      lineNumber: Math.min(Math.max(pos.lineNumber, 1), lineCount),
      column: Math.max(1, pos.column),
    }),
    createRange: (startLine, startColumn, endLine, endColumn) => ({ startLine, startColumn, endLine, endColumn }),
    setSelection: (range) => {
      selections.push(range);
    },
    setPosition: (pos) => {
      positions.push(pos);
    },
    setAnchorDecorations: (decorations) => {
      decorationsHistory.push(decorations);
    },
    clearAnchorDecorations: () => {
      clearCount += 1;
    },
    revealRangeInCenter: (range) => {
      centeredRanges.push(range);
    },
    revealPositionInCenter: (pos) => {
      centeredPositions.push(pos);
    },
    focus: () => {
      focusCount += 1;
    },
  };

  return {
    driver,
    selections,
    positions,
    decorationsHistory,
    getClearCount: () => clearCount,
    centeredRanges,
    centeredPositions,
    getFocusCount: () => focusCount,
  };
}

describe("CodeEditor anchor reveal", () => {
  it("selects the anchored line range when readOnly is true", () => {
    const fake = createFakeDriver(100);
    const plan = applyAnchorReveal({ line: 60, endLine: 65 }, true, fake.driver);

    expect(plan).toEqual({ kind: "select-range", startLine: 60, endLine: 65, column: 1 });
    expect(fake.getClearCount()).toBe(1);
    expect(fake.selections).toEqual([{ startLine: 60, startColumn: 1, endLine: 65, endColumn: 105 }]);
    expect(fake.positions).toEqual([]);
    expect(fake.decorationsHistory).toEqual([]);
    expect(fake.centeredRanges).toEqual([{ startLine: 60, startColumn: 1, endLine: 65, endColumn: 105 }]);
    expect(fake.getFocusCount()).toBe(1);
  });

  it("places the caret at startLine without selecting text and paints a whole-line decoration when writable", () => {
    const fake = createFakeDriver(100);
    const plan = applyAnchorReveal({ line: 60, endLine: 65 }, false, fake.driver);

    expect(plan).toEqual({ kind: "decorate-range", startLine: 60, endLine: 65, column: 1 });
    expect(fake.selections).toEqual([]);
    expect(fake.positions).toEqual([{ lineNumber: 60, column: 1 }]);
    expect(fake.decorationsHistory).toEqual([
      [
        {
          range: { startLine: 60, startColumn: 1, endLine: 65, endColumn: 105 },
          options: { isWholeLine: true, className: ANCHOR_RANGE_CLASS },
        },
      ],
    ]);
    expect(fake.centeredRanges).toEqual([{ startLine: 60, startColumn: 1, endLine: 65, endColumn: 105 }]);
    expect(fake.getFocusCount()).toBe(1);
  });

  it("clears prior range decorations and moves only the caret on a non-range single-line reveal", () => {
    const fake = createFakeDriver(50);
    applyAnchorReveal({ line: 10, endLine: 14 }, false, fake.driver);

    const singlePlan = applyAnchorReveal({ line: 80, column: 4 }, false, fake.driver);
    expect(singlePlan).toEqual({ kind: "cursor", startLine: 50, endLine: 50, column: 4 });
    expect(fake.getClearCount()).toBe(1);
    expect(fake.selections).toEqual([]);
    expect(fake.positions.at(-1)).toEqual({ lineNumber: 50, column: 4 });
    expect(fake.centeredPositions).toEqual([{ lineNumber: 50, column: 4 }]);
    expect(fake.getFocusCount()).toBe(2);

    expect(planAnchorReveal({ line: 12, endLine: 10 }, 50, false)).toEqual({
      kind: "cursor",
      startLine: 12,
      endLine: 12,
      column: 1,
    });
  });
});
