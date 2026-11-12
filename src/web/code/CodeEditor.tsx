import { useEffect, useRef } from "react";
import { MONO_FONT, monaco, monacoTheme, remeasureWhenFontLoads } from "../monaco-setup";
import type { CompileDiagnostic } from "../../shared/types";
import { diffEdit, mapOffset, normaliseEol } from "./textEdit";

export interface CodeReveal {
  line: number;
  column?: number;
  endLine?: number;
  nonce: number;
}

export interface CodeEditorProps {
  /** Current file content. A change from outside (your editor, reload) replaces the editor text. */
  value: string;
  /** When `value` or `version` changes, the editor compares `value` with its text and applies any difference. */
  version: number;
  diagnostics: CompileDiagnostic[];
  theme: "light" | "dark";
  readOnly?: boolean;
  /** Every edit; the parent debounces what it sends. */
  onChange?: (content: string) => void;
  /** Lets the console or an anchor jump to a line or line range. */
  revealLine?: CodeReveal | null;
}

const MARKER_OWNER = "clang";

// Practice without an IDE's help: nothing completes, hints or explains itself while typing.
const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  language: "cpp",
  fontSize: 14,
  lineHeight: 22,
  fontFamily: MONO_FONT,
  fontLigatures: false,
  tabSize: 2,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  padding: { top: 8, bottom: 8 },
  fixedOverflowWidgets: true,
  ariaLabel: "C++ code editor",
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  acceptSuggestionOnEnter: "off",
  acceptSuggestionOnCommitCharacter: false,
  tabCompletion: "off",
  wordBasedSuggestions: "off",
  snippetSuggestions: "none",
  parameterHints: { enabled: false },
  inlineSuggest: { enabled: false },
  hover: { enabled: "off" },
  lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off },
  inlayHints: { enabled: "off" },
  stickyScroll: { enabled: false },
  codeLens: false,
  colorDecorators: false,
  links: false,
  formatOnType: false,
  formatOnPaste: false,
};

// Turning quick suggestions off does not stop an explicit trigger, so those key chords become no-ops.
const SUGGEST_CHORDS = [
  monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space,
  monaco.KeyMod.WinCtrl | monaco.KeyCode.Space,
  monaco.KeyMod.Alt | monaco.KeyCode.Escape,
  monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI,
];

const SEVERITY: Record<CompileDiagnostic["severity"], monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  note: monaco.MarkerSeverity.Info,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function toMarker(model: monaco.editor.ITextModel, d: CompileDiagnostic): monaco.editor.IMarkerData {
  const lineCount = model.getLineCount();
  const startLine = clamp(d.line, 1, lineCount);
  const startColumn = clamp(d.column, 1, model.getLineMaxColumn(startLine));
  const endLine = clamp(d.endLine ?? startLine, startLine, lineCount);
  const lastColumn = model.getLineMaxColumn(endLine);

  let endColumn: number;
  if (d.endColumn !== undefined && (endLine > startLine || d.endColumn > startColumn)) {
    endColumn = clamp(d.endColumn, 1, lastColumn);
  } else {
    // No range from the compiler: underline the identifier under the caret, else one character.
    const word = model.getWordAtPosition({ lineNumber: startLine, column: startColumn });
    endColumn = word && word.startColumn <= startColumn ? word.endColumn : Math.min(startColumn + 1, lastColumn);
  }
  return {
    severity: SEVERITY[d.severity],
    message: d.message,
    source: MARKER_OWNER,
    startLineNumber: startLine,
    startColumn,
    endLineNumber: endLine,
    endColumn,
  };
}

export function CodeEditor(props: CodeEditorProps) {
  const { value, version, diagnostics, theme, readOnly = false, onChange, revealLine } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const applyingExternal = useRef(false);
  const revealSeen = useRef<number | null>(revealLine?.nonce ?? null);
  const start = useRef({ value, theme, readOnly });
  // Markers do not move when the text does. Each one is shadowed by a tracked range so squiggles follow
  // the code while the user types, until the next compile result replaces them.
  const markers = useRef<{ data: monaco.editor.IMarkerData[]; shadow: monaco.editor.IEditorDecorationsCollection | null }>({
    data: [],
    shadow: null,
  });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const editor = monaco.editor.create(host, {
      ...EDITOR_OPTIONS,
      value: normaliseEol(start.current.value),
      theme: monacoTheme(start.current.theme),
      readOnly: start.current.readOnly,
    });
    const model = editor.getModel();
    model?.setEOL(monaco.editor.EndOfLineSequence.LF);
    editorRef.current = editor;
    remeasureWhenFontLoads();
    const state = markers.current;
    state.data = [];
    state.shadow = editor.createDecorationsCollection();

    for (const chord of SUGGEST_CHORDS) editor.addCommand(chord, () => undefined);

    const subscription = editor.onDidChangeModelContent(() => {
      const current = editor.getModel();
      if (current && state.shadow && state.data.length > 0) {
        const ranges = state.shadow.getRanges();
        if (ranges.length === state.data.length) {
          state.data = state.data.map((marker, i) => {
            const r = ranges[i];
            return r ? { ...marker, startLineNumber: r.startLineNumber, startColumn: r.startColumn, endLineNumber: r.endLineNumber, endColumn: r.endColumn } : marker;
          });
          monaco.editor.setModelMarkers(current, MARKER_OWNER, state.data);
        }
      }
      if (applyingExternal.current) return;
      onChangeRef.current?.(current ? current.getValue(monaco.editor.EndOfLinePreference.LF) : "");
    });

    return () => {
      subscription.dispose();
      state.shadow?.clear();
      state.shadow = null;
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(monacoTheme(theme));
  }, [theme]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  // A new array on every render must not reset markers to where they were first reported.
  const diagnosticsKey = JSON.stringify(diagnostics);
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const state = markers.current;
    if (!editor || !model || !state.shadow) return;
    state.data = diagnostics.map((d) => toMarker(model, d));
    state.shadow.set(
      state.data.map((m) => ({
        range: new monaco.Range(m.startLineNumber, m.startColumn, m.endLineNumber, m.endColumn),
        options: { description: "diagnostic-anchor", stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
      })),
    );
    monaco.editor.setModelMarkers(model, MARKER_OWNER, state.data);
  }, [diagnosticsKey]);

  // The parent passes `value` back after edits it made itself; only text that differs is applied.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const before = model.getValue(monaco.editor.EndOfLinePreference.LF);
    const edit = diffEdit(before, normaliseEol(value));
    if (!edit) return;

    const offsetOf = (line: number, column: number) => model.getOffsetAt({ lineNumber: line, column });
    const carets = (editor.getSelections() ?? []).map((s) => ({
      anchor: mapOffset(offsetOf(s.selectionStartLineNumber, s.selectionStartColumn), edit),
      active: mapOffset(offsetOf(s.positionLineNumber, s.positionColumn), edit),
    }));
    const scrollTop = editor.getScrollTop();
    const scrollLeft = editor.getScrollLeft();
    const from = model.getPositionAt(edit.start);
    const to = model.getPositionAt(edit.endOld);

    applyingExternal.current = true;
    try {
      // Applied on the model, not the editor: a read-only editor refuses edits made through the editor.
      model.pushStackElement();
      model.pushEditOperations([], [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: edit.text }], () => null);
      model.pushStackElement();
      if (carets.length > 0) {
        editor.setSelections(
          carets.map(({ anchor, active }) => {
            const a = model.getPositionAt(anchor);
            const p = model.getPositionAt(active);
            return new monaco.Selection(a.lineNumber, a.column, p.lineNumber, p.column);
          }),
        );
      }
      editor.setScrollPosition({ scrollTop, scrollLeft }, monaco.editor.ScrollType.Immediate);
    } finally {
      applyingExternal.current = false;
    }
    // `version` is a trigger too: an outside change that restores text the prop already held leaves `value` as is.
  }, [value, version]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !revealLine) return;
    // A request that was already there when the editor mounted is old news.
    if (revealSeen.current === revealLine.nonce) return;
    revealSeen.current = revealLine.nonce;
    if (revealLine.endLine !== undefined && revealLine.endLine >= revealLine.line) {
      const lineCount = model.getLineCount();
      const startLine = clamp(revealLine.line, 1, lineCount);
      const endLine = clamp(revealLine.endLine, startLine, lineCount);
      const range = new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
      editor.setSelection(range);
      editor.revealRangeInCenterIfOutsideViewport(range, monaco.editor.ScrollType.Immediate);
      editor.focus();
      return;
    }
    const position = model.validatePosition({ lineNumber: revealLine.line, column: revealLine.column ?? 1 });
    editor.setPosition(position);
    editor.revealPositionInCenterIfOutsideViewport(position, monaco.editor.ScrollType.Immediate);
    editor.focus();
  }, [revealLine]);

  return <div ref={hostRef} data-testid="code-editor" style={{ width: "100%", height: "100%", minHeight: 0 }} />;
}
