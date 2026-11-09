import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../backend";
import { GROUP_LABEL, buildItems, filterItems, type PaletteAction, type PaletteGroup, type PaletteInput, type PaletteItem } from "../lib/palette";
import { navigate } from "../router";
import { CompassIcon, EnterIcon, ListIcon, PauseIcon, PlayFilledIcon, SearchIcon, SlidersIcon } from "./icons";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Kbd } from "./ui/kbd";
import { cn } from "./ui";

const OPEN_EVENT = "sparmate-open-palette";

/** Opens the palette from a button, the same as the shortcut does. */
export function openPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
export const PALETTE_KEYS = isMac ? ["⌘", "K"] : ["Ctrl", "K"];

/** Where the palette reads its rows from. A fixture page swaps this for static data. */
export interface PaletteSource {
  load: () => Promise<PaletteInput>;
}

const liveSource: PaletteSource = {
  async load() {
    const [problems, history, settings] = await Promise.all([api.problems(), api.history(), api.settings()]);
    return { now: new Date(), plan: settings.weeklyPlan, problems, history };
  },
};

export const PaletteSourceContext = createContext<PaletteSource>(liveSource);

const GROUP_ICON: Record<PaletteGroup, typeof PauseIcon> = { continue: PauseIcon, start: PlayFilledIcon, problems: ListIcon, pages: CompassIcon, settings: SlidersIcon };

/** Another dialog (a confirm, the shortcuts list) owns the keyboard while it is open. */
function otherDialogOpen(): boolean {
  return document.querySelector("[role=dialog]:not([data-palette]), [role=alertdialog]") !== null;
}

export function CommandPalette() {
  const source = useContext(PaletteSourceContext);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [input, setInput] = useState<PaletteInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (otherDialogOpen()) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    const onOpen = () => {
      if (!otherDialogOpen()) setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Read the lists each time the palette opens, so a round paused a moment ago shows under Continue.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setError(null);
    let alive = true;
    source.load().then(
      (loaded) => alive && setInput(loaded),
      () => alive && setInput((previous) => previous ?? { now: new Date(), plan: [], problems: [], history: [] }),
    );
    return () => {
      alive = false;
    };
  }, [open, source]);

  const items = useMemo(() => filterItems(input ? buildItems(input) : [], query), [input, query]);
  const current = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, items]);

  const run = useCallback((action: PaletteAction) => {
    if (action.kind === "go") {
      setOpen(false);
      navigate(action.href);
      return;
    }
    setBusy(true);
    setError(null);
    api.createSession({ problemId: action.problemId, mode: action.mode }).then(
      ({ sessionId }) => {
        setBusy(false);
        setOpen(false);
        navigate(`/session/${sessionId}`);
      },
      () => {
        setBusy(false);
        setError("The round could not be started.");
      },
    );
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length === 0) return;
      setActive((current + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[current];
      if (item && !busy) run(item.action);
    }
  };

  const groups = groupRows(items);
  const activeId = items[current] ? `${listId}-${current}` : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        data-palette=""
        aria-describedby={undefined}
        className="top-[14%] max-w-[640px] translate-y-0 gap-0 overflow-hidden p-0 data-[state=closed]:zoom-out-[0.98] data-[state=closed]:duration-100 data-[state=open]:zoom-in-[0.98] data-[state=open]:duration-[140ms] data-[state=open]:slide-in-from-bottom-0 motion-reduce:data-[state=closed]:zoom-out-100 motion-reduce:data-[state=open]:zoom-in-100 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:max-h-[80dvh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:rounded-b-none max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:zoom-in-100"
      >
        <DialogTitle className="sr-only">Jump to</DialogTitle>
        <DialogDescription className="sr-only">Search rounds, problems, pages and settings. Use the arrow keys to move and Enter to open.</DialogDescription>
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4">
          <SearchIcon size={18} className="text-muted-foreground" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Jump to a round, a problem or a page"
            placeholder="Jump to a round, a problem or a page"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-14 min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-faint"
          />
          <Kbd className="max-sm:hidden">Esc</Kbd>
        </div>
        <div ref={list} id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
          {input === null ? (
            <p className="px-3 py-6 text-center text-ui text-muted-foreground" role="status">
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-ui text-muted-foreground" role="status">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.id} role="group" aria-labelledby={`${listId}-${group.id}`} className="pb-1">
                <div id={`${listId}-${group.id}`} className="px-3 pb-1 pt-2 text-meta font-semibold text-faint">
                  {GROUP_LABEL[group.id]}
                </div>
                {group.rows.map(({ item, index }) => (
                  <PaletteRow
                    key={item.id}
                    id={`${listId}-${index}`}
                    index={index}
                    item={item}
                    active={index === current}
                    onHover={() => setActive(index)}
                    onRun={() => run(item.action)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
        <div className="flex shrink-0 items-center gap-4 border-t border-border bg-sunken px-4 py-2.5 text-meta text-muted-foreground">
          {error ? (
            <span role="alert" className="text-destructive">
              {error}
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1.5 max-sm:hidden">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                move
              </span>
              <span className="flex items-center gap-1.5 max-sm:hidden">
                <Kbd>Enter</Kbd>
                open
              </span>
              <span className="flex items-center gap-1.5 max-sm:hidden">
                <Kbd>Esc</Kbd>
                close
              </span>
              <span className="sm:hidden">Tap a row to open it.</span>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The rows split into their groups, each row keeping its position in the flat list that the arrow keys walk. */
function groupRows(items: PaletteItem[]): { id: PaletteGroup; rows: { item: PaletteItem; index: number }[] }[] {
  const groups: { id: PaletteGroup; rows: { item: PaletteItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last && last.id === item.group) last.rows.push({ item, index });
    else groups.push({ id: item.group, rows: [{ item, index }] });
  });
  return groups;
}

function PaletteRow({ id, index, item, active, onHover, onRun }: { id: string; index: number; item: PaletteItem; active: boolean; onHover: () => void; onRun: () => void }) {
  const Icon = GROUP_ICON[item.group];
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-index={index}
      onMouseMove={onHover}
      onClick={onRun}
      className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 transition-colors", active ? "bg-primary-soft ring-1 ring-inset ring-primary/40" : "")}
    >
      <span
        className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
        aria-hidden="true"
      >
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate text-body font-medium">{item.label}</span>
      {item.hint ? <span className="shrink-0 text-meta text-muted-foreground">{item.hint}</span> : null}
      <span className={cn("flex size-5 shrink-0 items-center justify-center text-muted-foreground max-sm:hidden", active ? "opacity-100" : "opacity-0")} aria-hidden="true">
        <EnterIcon size={14} />
      </span>
    </div>
  );
}
