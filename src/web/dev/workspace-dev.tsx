import "../excalidraw-env";
import { monaco } from "../monaco-setup";
import "../styles.css";
import "./workspace-dev.css";
import { StrictMode, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Board, type BoardHandle } from "../board/Board";
import { loadBoardFonts } from "../board/fonts";
import { CodeEditor } from "../code/CodeEditor";
import { Console } from "../code/Console";
import { Select } from "../components/Select";
import type { CompileDiagnostic, RunResult } from "../../shared/types";
import { SAMPLE_CODE, SAMPLE_DIAGNOSTICS, SAMPLE_RUNS, type SampleRunName } from "./samples";
import { buildSample, type SampleName } from "./sampleScenes";
import { AppProviders } from "../components/AppProviders";

const SAMPLE_RUN_OPTIONS = (Object.keys(SAMPLE_RUNS) as SampleRunName[]).map((name) => ({
  value: name,
  label: name,
}));

type Track = "hld" | "lld";
type Theme = "light" | "dark";
type View = "both" | "board" | "code";

interface SceneLogEntry {
  version: number;
  elements: number;
  at: number;
}

declare global {
  interface Window {
    /** Read-only probes for the browser check script; only present with ?testhooks=1. */
    __irDev?: {
      sceneLog(): SceneLogEntry[];
      editorChanges(): number;
      markers(): { owner: string; severity: number; line: number; column: number; message: string }[];
      editorText(): string;
      cursor(): { line: number; column: number; scrollTop: number } | null;
      setCursor(line: number, column: number): void;
      pickRun(name: SampleRunName): void;
      exportPng(): Promise<string>;
    };
  }
}

const params = new URLSearchParams(window.location.search);
const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
  const value = params.get(name);
  return allowed.find((a) => a === value) ?? fallback;
};

const SAMPLE_LABELS: Record<SampleName, string> = {
  flow: "Sample: request flow",
  kinds: "Sample: every kind",
  classes: "Sample: classes",
};

function App() {
  const [track, setTrack] = useState<Track>(pick<Track>("track", ["hld", "lld"], "hld"));
  const [theme, setTheme] = useState<Theme>(pick<Theme>("theme", ["light", "dark"], "light"));
  const [view, setView] = useState<View>(pick<View>("view", ["both", "board", "code"], "both"));
  const [readOnly, setReadOnly] = useState(false);
  const [boardKey, setBoardKey] = useState(0);
  const saved = useRef<{ version: number; elements: readonly Record<string, unknown>[] }>({ version: 0, elements: [] });
  const [sceneStats, setSceneStats] = useState({ calls: 0, version: 0, elements: 0 });
  const sceneLog = useRef<SceneLogEntry[]>([]);
  const boardRef = useRef<BoardHandle>(null);
  const [pngInfo, setPngInfo] = useState("");

  const [codeValue, setCodeValue] = useState(SAMPLE_CODE);
  const [codeVersion, setCodeVersion] = useState(1);
  const typed = useRef(SAMPLE_CODE);
  const editorChanges = useRef(0);
  const [editorChangeCount, setEditorChangeCount] = useState(0);
  const [diagnostics, setDiagnostics] = useState<CompileDiagnostic[]>(SAMPLE_DIAGNOSTICS);
  const [revealLine, setRevealLine] = useState<{ line: number; column: number; nonce: number } | null>(null);
  const nonce = useRef(0);

  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runName, setRunName] = useState<SampleRunName>("success");
  const runNameRef = useRef<SampleRunName>("success");
  runNameRef.current = runName;

  // Sample text is measured while it is built, so the faces it uses must already be loaded.
  const loadSample = useCallback(async (name: SampleName) => {
    await loadBoardFonts();
    saved.current = { version: 0, elements: buildSample(name) };
    setBoardKey((k) => k + 1);
  }, []);

  const onSceneChange = useCallback((elements: readonly Record<string, unknown>[], version: number) => {
    saved.current = { version, elements };
    sceneLog.current.push({ version, elements: elements.length, at: Math.round(performance.now()) });
    setSceneStats((s) => ({ calls: s.calls + 1, version, elements: elements.length }));
  }, []);

  const onRun = useCallback(() => {
    setRunning(true);
    window.setTimeout(() => {
      const result = SAMPLE_RUNS[runNameRef.current]();
      setLastRun(result);
      setDiagnostics(result.compile.diagnostics);
      setRunning(false);
    }, 600);
  }, []);

  if (new URLSearchParams(window.location.search).get("testhooks") === "1") {
    window.__irDev = {
      sceneLog: () => sceneLog.current,
      editorChanges: () => editorChanges.current,
      markers: () =>
        monaco.editor.getModelMarkers({ owner: "clang" }).map((m) => ({ owner: m.owner, severity: m.severity, line: m.startLineNumber, column: m.startColumn, message: m.message })),
      editorText: () => monaco.editor.getModels()[0]?.getValue() ?? "",
      cursor: () => {
        const editor = monaco.editor.getEditors()[0];
        const position = editor?.getPosition();
        return editor && position ? { line: position.lineNumber, column: position.column, scrollTop: editor.getScrollTop() } : null;
      },
      setCursor: (line, column) => {
        const editor = monaco.editor.getEditors()[0];
        if (!editor) return;
        const position = { lineNumber: line, column };
        editor.setPosition(position);
        editor.revealPositionInCenterIfOutsideViewport(position);
        editor.focus();
      },
      pickRun: (name) => {
        runNameRef.current = name;
        setRunName(name);
      },
      exportPng: () => (boardRef.current ? boardRef.current.exportPng() : Promise.reject(new Error("The board is not mounted."))),
    };
  }

  return (
    <div className="dev" data-theme={theme}>
      <header className="dev__bar">
        <strong>Workspace check</strong>
        <div className="dev__group" role="group" aria-label="Palette">
          <button type="button" aria-pressed={track === "hld"} onClick={() => setTrack("hld")}>HLD palette</button>
          <button type="button" aria-pressed={track === "lld"} onClick={() => setTrack("lld")}>LLD palette</button>
        </div>
        <div className="dev__group" role="group" aria-label="Theme">
          <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Light</button>
          <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Dark</button>
        </div>
        <div className="dev__group" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === "both"} onClick={() => setView("both")}>Both</button>
          <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}>Board</button>
          <button type="button" aria-pressed={view === "code"} onClick={() => setView("code")}>Code</button>
        </div>
        <label className="dev__check">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only
        </label>
        <div className="dev__group" role="group" aria-label="Samples">
          {(Object.keys(SAMPLE_LABELS) as SampleName[]).map((name) => (
            <button key={name} type="button" onClick={() => void loadSample(name)}>{SAMPLE_LABELS[name]}</button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            const png = boardRef.current?.exportPng();
            if (!png) return;
            png.then((b64) => setPngInfo(`PNG ${b64.length} base64 chars`)).catch((e: unknown) => setPngInfo(`PNG failed: ${String(e)}`));
          }}
        >
          Export PNG
        </button>
        <span className="dev__readout" data-testid="scene-stats">
          scene changes: {sceneStats.calls} (version {sceneStats.version}, {sceneStats.elements} elements)
        </span>
        <span className="dev__readout" data-testid="png-info">{pngInfo}</span>
      </header>
      <main className="dev__main" data-view={view}>
        {view !== "code" && (
          <section className="dev__board" aria-label="Board">
            <Board
              key={boardKey}
              ref={boardRef}
              sessionId={`dev-${boardKey}`}
              initialElements={saved.current.elements}
              initialVersion={saved.current.version}
              track={track}
              theme={theme}
              readOnly={readOnly}
              onSceneChange={onSceneChange}
            />
          </section>
        )}
        {view !== "board" && (
          <section className="dev__code" aria-label="Code">
            <div className="dev__code-tools">
              <button
                type="button"
                onClick={() => {
                  setCodeValue(`// edited outside\n${typed.current}`);
                  setCodeVersion((v) => v + 1);
                }}
              >
                Outside edit: add a line at the top
              </button>
              <button type="button" onClick={() => setDiagnostics(diagnostics.length > 0 ? [] : SAMPLE_DIAGNOSTICS)}>
                {diagnostics.length > 0 ? "Clear markers" : "Show markers"}
              </button>
              <div className="dev__check inline-flex items-center gap-1.5">
                <span>Next run</span>
                <Select
                  label="Next run"
                  size="sm"
                  value={runName}
                  options={SAMPLE_RUN_OPTIONS}
                  onChange={setRunName}
                />
              </div>
              <span className="dev__readout" data-testid="editor-stats">editor onChange: {editorChangeCount}</span>
            </div>
            <div className="dev__editor">
              <CodeEditor
                value={codeValue}
                version={codeVersion}
                diagnostics={diagnostics}
                theme={theme}
                readOnly={readOnly}
                revealLine={revealLine}
                onChange={(content) => {
                  typed.current = content;
                  editorChanges.current += 1;
                  setEditorChangeCount(editorChanges.current);
                }}
              />
            </div>
            <div className="dev__console">
              <Console
                lastRun={lastRun}
                running={running}
                onRun={onRun}
                onJumpTo={(line, column) => {
                  nonce.current += 1;
                  setRevealLine({ line, column, nonce: nonce.current });
                }}
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );
