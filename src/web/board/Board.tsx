import "../excalidraw-env";
import "@excalidraw/excalidraw/index.css";
import "./board.css";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ForwardedRef } from "react";
import { CaptureUpdateAction, Excalidraw, MainMenu, exportToBlob, hashElementsVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState, UIOptions } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BoardPin } from "../../shared/types";
import { BoardPalette } from "./BoardPalette";
import { PinLayer } from "./PinLayer";
import { findStepFrame, hasStepFrames, newStepFrames, stepFrameAt } from "./stepFrames";
import { loadBoardFonts, loadSceneFonts } from "./fonts";
import { arrowSpecFor, shapeSpecFor, type ArrowPreset, type ShapeKind } from "./palette";
import { findShapeByLabel, isBindableShape, planArrow, planShape, type ArrowPlan, type BindableShape, type Point } from "./elements";

export interface BoardProps {
  sessionId: string;
  /** Saved scene to start from (GET /api/sessions/:id/board). Loaded through Excalidraw's initialData. */
  initialElements: readonly Record<string, unknown>[];
  initialVersion: number;
  track: "hld" | "lld";
  theme: "light" | "dark";
  readOnly?: boolean;
  /** Notes the AI attached to elements, drawn over the canvas. */
  pins?: readonly BoardPin[];
  /** The step whose frame is in view when the board opens. */
  initialStep?: string | null;
  /** Called at most once per 1.5 s with the non-deleted elements and an incrementing version. */
  onSceneChange?: (elements: readonly Record<string, unknown>[], version: number) => void;
}

export interface BoardHandle {
  /** PNG of the whole scene, or of one frame cropped to its edges, as base64 without the data-URL prefix. */
  exportPng(frameId?: string): Promise<string>;
  getElements(): readonly Record<string, unknown>[];
  /** Pans and zooms to a step's frame; null, or a step with no frame, shows the whole board. False when not ready. */
  showStep(step: string | null, animate?: boolean): boolean;
}

declare global {
  interface Window {
    __irBoard?: {
      insertShape(kind: string, label?: string): string;
      connect(fromLabel: string, toLabel: string, label?: string): string;
      elements(): readonly Record<string, unknown>[];
    };
  }
}

const SCENE_EMIT_INTERVAL_MS = 1500;
const EXPORT_MAX_SIDE = 1568;
const INSERT_STEP = 28;
const INSERT_CYCLE = 8;

// Module-level so Excalidraw (a memoised component) does not re-render on every parent render.
const UI_OPTIONS: Partial<UIOptions> = {
  tools: { image: false },
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    saveAsImage: true,
    clearCanvas: true,
    changeViewBackgroundColor: true,
    toggleTheme: null,
  },
};

export const Board = forwardRef<BoardHandle, BoardProps>(function Board(props, ref) {
  // A new session starts a fresh Excalidraw: its saved scene can only be loaded through initialData at mount.
  return <BoardSession key={props.sessionId} {...props} handleRef={ref} />;
});

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("The image could not be read."));
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function exportScenePng(api: ExcalidrawImperativeAPI | null, frameId?: string): Promise<string> {
  if (!api) throw new Error("The board is not ready yet.");
  const elements = api.getSceneElements();
  const frame = frameId ? elements.find((el) => el.id === frameId && (el.type === "frame" || el.type === "magicframe")) : undefined;
  if (frameId && !frame) throw new Error("That frame is not on the board.");
  // Text drawn before its font has loaded falls back to a system face in the image.
  await loadSceneFonts(elements);
  await document.fonts.ready;
  const blob = await exportToBlob({
    elements,
    // Light colours on white whatever the screen theme is, so every reader of the image sees the same board.
    appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: "#ffffff" },
    files: api.getFiles(),
    mimeType: "image/png",
    maxWidthOrHeight: EXPORT_MAX_SIDE,
    ...(frame ? { exportingFrame: frame as never } : {}),
  });
  return blobToBase64(blob);
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function showStepOn(api: ExcalidrawImperativeAPI, step: string | null, animate: boolean): void {
  const elements = api.getSceneElements();
  const frame = step ? findStepFrame(elements as unknown as Record<string, unknown>[], step) : null;
  const target = frame ? (frame as unknown as ExcalidrawElement) : elements;
  if (!frame && elements.length === 0) return;
  api.scrollToContent(target, { fitToViewport: true, viewportZoomFactor: frame ? 0.92 : 0.9, animate: animate && !reducedMotion(), duration: 240 });
}

/** Centre of the visible canvas in scene coordinates, shifted a little more on each call so inserts do not stack. */
function nextInsertPoint(api: ExcalidrawImperativeAPI, counter: { current: number }): Point {
  const { width, height, scrollX, scrollY, zoom } = api.getAppState();
  const shift = (counter.current % INSERT_CYCLE) * INSERT_STEP;
  counter.current += 1;
  return { x: width / 2 / zoom.value - scrollX + shift, y: height / 2 / zoom.value - scrollY + shift };
}

const FREE_SPOT_GAP = 48;
const FREE_SPOT_RINGS = 6;

/**
 * The spot nearest the middle of the visible canvas where a shape of this size overlaps nothing already drawn.
 * Clicking several palette items in a row then lays them out side by side instead of piling them up.
 */
function freeInsertPoint(api: ExcalidrawImperativeAPI, size: { width: number; height: number }, counter: { current: number }): Point {
  const centre = nextInsertPoint(api, { current: 0 });
  const boxes = api.getSceneElements().map((el) => ({ x: el.x, y: el.y, w: el.width, h: el.height }));
  const stepX = size.width + FREE_SPOT_GAP;
  const stepY = size.height + FREE_SPOT_GAP;
  const fits = (p: Point) => {
    const left = p.x - size.width / 2 - FREE_SPOT_GAP / 2;
    const top = p.y - size.height / 2 - FREE_SPOT_GAP / 2;
    const right = left + size.width + FREE_SPOT_GAP;
    const bottom = top + size.height + FREE_SPOT_GAP;
    return boxes.every((b) => right <= b.x || left >= b.x + b.w || bottom <= b.y || top >= b.y + b.h);
  };
  for (let ring = 0; ring <= FREE_SPOT_RINGS; ring++) {
    const candidates: Point[] = [];
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) candidates.push({ x: centre.x + dx * stepX, y: centre.y + dy * stepY });
      }
    }
    // Reading order inside a ring: rows top to bottom, each left to right.
    candidates.sort((a, b) => a.y - b.y || a.x - b.x);
    const spot = candidates.find(fits);
    if (spot) return spot;
  }
  return nextInsertPoint(api, counter);
}

function applyArrowPlan(api: ExcalidrawImperativeAPI, plan: ArrowPlan): void {
  const replaced = new Map(plan.replaced.map((el) => [el.id, el]));
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted().map((el) => replaced.get(el.id) ?? el), ...plan.created],
    appState: { selectedElementIds: { [plan.arrowId]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

type SessionProps = BoardProps & { handleRef: ForwardedRef<BoardHandle> };

interface SceneState {
  /** Set by the first report from Excalidraw, which is the scene it just loaded and not an edit. */
  loaded: boolean;
  /** Fingerprint of the last scene seen, so scrolling, zooming and selecting do not count as edits. */
  lastHash: number;
  latest: readonly ExcalidrawElement[];
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  version: number;
}

function BoardSession({ initialElements, initialVersion, track, theme, readOnly = false, pins = [], initialStep = null, onSceneChange, handleRef }: SessionProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const readyRef = useRef(false);
  const ready = api !== null && fontsReady;
  const wrapRef = useRef<HTMLDivElement>(null);
  const insertCount = useRef(0);
  const emitRef = useRef(onSceneChange);
  const startElements = useRef(initialElements);
  // A fresh board starts with one empty frame per step. It goes in through initialData, because an update right
  // after mount is overwritten by Excalidraw's own start-up.
  const seeded = useRef(!readOnly && initialVersion === 0 && !hasStepFrames(initialElements));
  const [initialData] = useState<ExcalidrawInitialDataState>(() => ({
    elements: [...(seeded.current ? newStepFrames(track) : []), ...(initialElements as unknown as readonly ExcalidrawElement[])],
    scrollToContent: true,
  }));
  const scene = useRef<SceneState>({ loaded: false, lastHash: 0, latest: [], dirty: false, timer: null, version: initialVersion });

  useEffect(() => {
    emitRef.current = onSceneChange;
  }, [onSceneChange]);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  // Shapes are measured when they are made, so inserting waits until the faces they use are loaded.
  useEffect(() => {
    let current = true;
    void loadBoardFonts().then(() => {
      if (current) setFontsReady(true);
    });
    return () => {
      current = false;
    };
  }, []);

  const flush = useCallback(() => {
    const s = scene.current;
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
    if (!s.dirty) return;
    s.dirty = false;
    s.version += 1;
    emitRef.current?.(s.latest.filter((el) => !el.isDeleted) as unknown as Record<string, unknown>[], s.version);
  }, []);

  // Leaving the room right after drawing must not lose the last second of work.
  useEffect(() => flush, [flush]);

  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[]) => {
      const s = scene.current;
      const hash = hashElementsVersion(elements);
      if (!s.loaded) {
        s.loaded = true;
        s.lastHash = hash;
        s.latest = elements;
        // The seeded frames are not an edit he made, but the server needs them to read the board by step.
        if (seeded.current) {
          s.dirty = true;
          s.timer = setTimeout(flush, SCENE_EMIT_INTERVAL_MS);
        }
        return;
      }
      if (hash === s.lastHash) return;
      s.lastHash = hash;
      s.latest = elements;
      s.dirty = true;
      if (!s.timer) s.timer = setTimeout(flush, SCENE_EMIT_INTERVAL_MS);
    },
    [flush],
  );

  const focusCanvas = useCallback(() => {
    wrapRef.current?.querySelector<HTMLElement>(".excalidraw")?.focus({ preventScroll: true });
  }, []);

  const insertShape = useCallback((kind: string, label?: string): string => {
    const current = apiRef.current;
    if (!current || !readyRef.current) throw new Error("The board is not ready yet.");
    const spec = shapeSpecFor(kind);
    if (!spec) throw new Error(`Unknown shape kind: ${kind}`);
    const at = freeInsertPoint(current, spec, insertCount);
    // Excalidraw puts an element in a frame only for pointer gestures, so a palette insert joins the frame it lands in.
    const frame = stepFrameAt(current.getSceneElements() as unknown as Record<string, unknown>[], at.x, at.y);
    const created = planShape(spec, label ?? spec.defaultLabel, at).map((el) => (frame ? { ...el, frameId: String(frame.id) } : el));
    const shape = created.find((el) => el.customData?.kind === kind) ?? created[0];
    if (!shape) throw new Error("The shape could not be created.");
    current.updateScene({
      elements: [...current.getSceneElementsIncludingDeleted(), ...created],
      appState: { selectedElementIds: { [shape.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    return shape.id;
  }, []);

  const insertArrow = useCallback((preset: ArrowPreset) => {
    const current = apiRef.current;
    const spec = arrowSpecFor(preset);
    if (!current || !spec || !readyRef.current) return;
    const byId = new Map<string, ExcalidrawElement>(current.getSceneElements().map((el) => [el.id, el]));
    // Key order is selection order, so the first shape picked becomes the arrow's start.
    const picked = Object.keys(current.getAppState().selectedElementIds)
      .map((id) => byId.get(id))
      .filter((el): el is BindableShape => el !== undefined && isBindableShape(el));
    const joined = picked.length === 1 || picked.length === 2;
    const plan = planArrow({
      from: joined ? (picked[0] ?? null) : null,
      to: picked.length === 2 ? (picked[1] ?? null) : null,
      at: nextInsertPoint(current, insertCount),
      label: spec.label,
      strokeStyle: spec.strokeStyle,
      startArrowhead: spec.startArrowhead,
      endArrowhead: spec.endArrowhead,
      kind: spec.preset,
      clean: true,
    });
    applyArrowPlan(current, plan);
  }, []);

  const connect = useCallback((fromLabel: string, toLabel: string, label = ""): string => {
    const current = apiRef.current;
    if (!current || !readyRef.current) throw new Error("The board is not ready yet.");
    const elements = current.getSceneElements();
    const from = findShapeByLabel(elements, fromLabel);
    const to = findShapeByLabel(elements, toLabel);
    if (!from) throw new Error(`No shape is labelled "${fromLabel}".`);
    if (!to) throw new Error(`No shape is labelled "${toLabel}".`);
    const plan = planArrow({
      from,
      to,
      at: nextInsertPoint(current, insertCount),
      label,
      strokeStyle: "solid",
      startArrowhead: null,
      endArrowhead: "arrow",
      clean: false,
    });
    applyArrowPlan(current, plan);
    return plan.arrowId;
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      exportPng: (frameId?: string) => exportScenePng(apiRef.current, frameId),
      showStep: (step: string | null, animate = true) => {
        const current = apiRef.current;
        if (!current) return false;
        showStepOn(current, step, animate);
        return true;
      },
      getElements: () => {
        const current = apiRef.current;
        const elements = current ? current.getSceneElements() : startElements.current.filter((el) => !el.isDeleted);
        return elements as unknown as readonly Record<string, unknown>[];
      },
    }),
    [],
  );

  // Opens on the step he is working on rather than the whole board; it waits a moment so Excalidraw's own
  // first fit has already happened and does not undo it.
  const openedOn = useRef(false);
  useEffect(() => {
    if (!api || !ready || openedOn.current || !initialStep) return;
    const timer = setTimeout(() => {
      openedOn.current = true;
      showStepOn(api, initialStep, false);
    }, 60);
    return () => clearTimeout(timer);
  }, [api, ready, initialStep]);

  useEffect(() => {
    if (!api || !ready || new URLSearchParams(window.location.search).get("testhooks") !== "1") return;
    const hooks: NonNullable<Window["__irBoard"]> = {
      insertShape,
      connect,
      elements: () => api.getSceneElements() as unknown as readonly Record<string, unknown>[],
    };
    window.__irBoard = hooks;
    return () => {
      if (window.__irBoard === hooks) delete window.__irBoard;
    };
  }, [api, ready, insertShape, connect]);

  return (
    <div ref={wrapRef} className="ir-board">
      {!readOnly && (
        <BoardPalette
          track={track}
          theme={theme}
          disabled={!ready}
          onInsertShape={(kind: ShapeKind, fromMouse) => {
            insertShape(kind);
            if (fromMouse) focusCanvas();
          }}
          onInsertArrow={(preset, fromMouse) => {
            insertArrow(preset);
            if (fromMouse) focusCanvas();
          }}
        />
      )}
      <div className="ir-board__canvas">
        <div className="ir-board__canvas-inner">
          <Excalidraw
            excalidrawAPI={setApi}
            initialData={initialData}
            theme={theme}
            viewModeEnabled={readOnly}
            aiEnabled={false}
            UIOptions={UI_OPTIONS}
            onChange={handleChange}
          >
            <MainMenu>
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
              <MainMenu.DefaultItems.Help />
            </MainMenu>
          </Excalidraw>
          <PinLayer api={api} pins={pins} />
        </div>
      </div>
    </div>
  );
}
