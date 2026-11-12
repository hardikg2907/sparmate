import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/icons";
import { Tooltip, cn } from "../components/ui";
import { ARROW_SPECS, HLD_SHAPES, LLD_SHAPES, type ArrowPreset, type ArrowSpec, type ShapeKind, type ShapeSpec, type StrokeStyle } from "./palette";

export interface PaletteProps {
  track: "hld" | "lld";
  theme: "light" | "dark";
  /** True until Excalidraw has handed over its API. */
  disabled: boolean;
  /** `focusCanvas` is true for a mouse click, so Delete and the arrow keys act on the new shape at once. */
  onInsertShape: (kind: ShapeKind, focusCanvas: boolean) => void;
  onInsertArrow: (preset: ArrowPreset, focusCanvas: boolean) => void;
}

const COLLAPSED_KEY = "sparmate-palette-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the palette is folded to a slim rail, kept per browser so the choice survives a reload. */
function usePaletteCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // The panel then opens again on the next visit, which is harmless.
    }
  };
  return [collapsed, toggle];
}

interface Entry {
  id: string;
  title: string;
  swatch: ReactNode;
  run: (focusCanvas: boolean) => void;
}

interface Section {
  heading: string;
  entries: Entry[];
}

const SWATCH_W = 36;
const SWATCH_H = 24;

function dash(style: StrokeStyle): string | undefined {
  if (style === "dashed") return "5 3";
  if (style === "dotted") return "1.5 3";
  return undefined;
}

function ShapeSwatch({ spec, uid }: { spec: ShapeSpec; uid: string }) {
  const scale = Math.min((SWATCH_W - 4) / spec.width, (SWATCH_H - 4) / spec.height);
  const w = spec.width * scale;
  const h = spec.height * scale;
  const x = (SWATCH_W - w) / 2;
  const y = (SWATCH_H - h) / 2;
  const hatchId = `${uid}-hatch-${spec.kind}`;
  const fill = spec.fillStyle === "solid" ? spec.fill : `url(#${hatchId})`;
  const common = { fill, stroke: spec.stroke, strokeWidth: spec.strokeWidth >= 4 ? 2.5 : 1.5, strokeDasharray: dash(spec.strokeStyle) };

  let body: ReactNode;
  if (spec.shape === "ellipse") {
    body = <ellipse cx={SWATCH_W / 2} cy={SWATCH_H / 2} rx={w / 2} ry={h / 2} {...common} />;
  } else if (spec.shape === "diamond") {
    const cx = SWATCH_W / 2;
    const cy = SWATCH_H / 2;
    body = <polygon points={`${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`} {...common} />;
  } else {
    body = <rect x={x} y={y} width={w} height={h} rx={spec.rounded ? 4 : 0} {...common} />;
  }

  return (
    <svg className="ir-swatch ir-swatch--shape" width={SWATCH_W} height={SWATCH_H} viewBox={`0 0 ${SWATCH_W} ${SWATCH_H}`} aria-hidden="true" focusable="false">
      {spec.fillStyle !== "solid" && (
        <defs>
          <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill={spec.fill} />
            <line x1="0" y1="0" x2="0" y2="5" stroke={spec.stroke} strokeWidth="1" />
            {spec.fillStyle === "cross-hatch" && <line x1="0" y1="2.5" x2="5" y2="2.5" stroke={spec.stroke} strokeWidth="1" />}
          </pattern>
        </defs>
      )}
      {body}
    </svg>
  );
}

function ArrowSwatch({ spec }: { spec: ArrowSpec }) {
  const y = SWATCH_H / 2;
  const x0 = spec.startArrowhead ? 9 : 3;
  const x1 = spec.endArrowhead === "triangle_outline" ? 26 : 31;
  return (
    <svg className="ir-swatch" width={SWATCH_W} height={SWATCH_H} viewBox={`0 0 ${SWATCH_W} ${SWATCH_H}`} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
        <line x1={x0} y1={y} x2={x1} y2={y} strokeDasharray={dash(spec.strokeStyle)} />
        {spec.startArrowhead === "diamond" && <polygon points={`3,${y} 6,${y - 3} 9,${y} 6,${y + 3}`} fill="currentColor" />}
        {spec.endArrowhead === "triangle_outline" && <polygon points={`33,${y} 26,${y - 4} 26,${y + 4}`} />}
        {spec.endArrowhead === "arrow" && <polyline points={`${x1 - 4},${y - 4} ${x1 + 1},${y} ${x1 - 4},${y + 4}`} />}
      </g>
    </svg>
  );
}

export function BoardPalette({ track, theme, disabled, onInsertShape, onInsertArrow }: PaletteProps) {
  const uid = useId().replace(/:/g, "");
  const listId = `${uid}-list`;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [collapsed, toggleCollapsed] = usePaletteCollapsed();

  const shapeEntry = (spec: ShapeSpec): Entry => ({
    id: spec.kind,
    title: spec.title,
    swatch: <ShapeSwatch spec={spec} uid={uid} />,
    run: (focusCanvas) => onInsertShape(spec.kind, focusCanvas),
  });
  const arrowEntry = (spec: ArrowSpec): Entry => ({
    id: spec.preset,
    title: spec.title,
    swatch: <ArrowSwatch spec={spec} />,
    run: (focusCanvas) => onInsertArrow(spec.preset, focusCanvas),
  });

  const sections: Section[] =
    track === "hld"
      ? [{ heading: "Components", entries: HLD_SHAPES.map(shapeEntry) }]
      : [
          { heading: "Classes", entries: LLD_SHAPES.map(shapeEntry) },
          { heading: "Relations", entries: ARROW_SPECS.map(arrowEntry) },
        ];
  const flat = sections.flatMap((s) => s.entries);
  const current = Math.min(active, flat.length - 1);

  function focusAt(index: number) {
    const next = (index + flat.length) % flat.length;
    setActive(next);
    buttons.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        focusAt(current + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        focusAt(current - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(flat.length - 1);
        break;
    }
  }

  const toggle = (
    <Tooltip content={collapsed ? "Show the palette" : "Hide the palette"} side="right">
      <button
        type="button"
        className="ir-palette__toggle flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-expanded={!collapsed}
        aria-controls={listId}
        aria-label={collapsed ? "Show the palette" : "Hide the palette"}
        onClick={toggleCollapsed}
      >
        {collapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
      </button>
    </Tooltip>
  );

  let index = -1;
  return (
    <aside
      className={cn(
        "ir-palette relative shrink-0 overflow-hidden text-ui text-foreground transition-[width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "ir-palette--collapsed w-10" : "w-44 max-md:w-12",
      )}
      data-theme={theme}
      aria-label="Board palette"
    >
      {/* The toggle keeps to the right edge while the width changes, so it never jumps. */}
      <div className="absolute right-1.5 top-2 z-10">{toggle}</div>
      <div
        className={cn("flex h-full w-44 flex-col transition-opacity duration-150 motion-reduce:transition-none max-md:w-12", collapsed && "pointer-events-none opacity-0")}
        inert={collapsed}
        aria-hidden={collapsed}
      >
        <div className="flex h-9 shrink-0 items-center px-2.5 pt-2 max-md:h-11">
          <span className="text-meta font-semibold text-muted-foreground max-md:hidden">Palette</span>
        </div>
        <div
          id={listId}
          className="ir-palette__list min-h-0 flex-1 overflow-y-auto px-1.5 pt-2"
          role="toolbar"
          aria-orientation="vertical"
          aria-label={track === "hld" ? "Add a component" : "Add a class or relation"}
          onKeyDown={onKeyDown}
        >
          {sections.map((section) => (
            <div key={section.heading} role="group" aria-label={section.heading} className="ir-palette__group mt-2 first:mt-0">
              <div className="ir-palette__heading px-2 pt-0.5 pb-1.5 text-meta font-semibold text-muted-foreground max-md:hidden" aria-hidden="true">
                {section.heading}
              </div>
              {section.entries.map((entry) => {
                index += 1;
                const i = index;
                return (
                  <Tooltip key={entry.id} content={`Add ${entry.title} to the board`} side="right">
                    <button
                      ref={(el) => {
                        buttons.current[i] = el;
                      }}
                      type="button"
                      className="ir-palette__item flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left max-md:min-h-9 max-md:justify-center max-md:px-0 text-ui font-medium disabled:cursor-default disabled:opacity-50"
                      tabIndex={i === current ? 0 : -1}
                      disabled={disabled}
                      data-kind={entry.id}
                      onFocus={() => setActive(i)}
                      onClick={(event) => entry.run(event.detail > 0)}
                    >
                      {entry.swatch}
                      <span className="ir-palette__label min-w-0 truncate max-md:sr-only">{entry.title}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
        <p className="ir-palette__hint shrink-0 border-t border-border px-3 pt-2 pb-2.5 text-meta text-faint max-md:hidden">
          {track === "hld" ? "Double-click a shape to rename it." : "Select one or two shapes, then pick a relation. The first shape selected is the start."}
        </p>
      </div>
    </aside>
  );
}
