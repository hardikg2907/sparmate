import { useEffect, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { KbdGroup } from "./ui/kbd";

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: "Anywhere",
    items: [
      { keys: ["?"], label: "Show these shortcuts" },
      { keys: ["Esc"], label: "Close a dialog or menu" },
    ],
  },
  {
    title: "Starting a round",
    items: [{ keys: ["Enter"], label: "Start the round from the start dialog" }],
  },
  {
    title: "In the room",
    items: [
      { keys: ["Enter"], label: "Send your message" },
      { keys: ["Shift", "Enter"], label: "New line in the message" },
      { keys: ["Ctrl", "M"], label: "Turn the microphone on or off" },
      { keys: ["Esc"], label: "Stop the interviewer speaking" },
      { keys: ["Ctrl", "Shift", "M"], label: "Let Tab leave the code editor" },
    ],
  },
];

const OPEN_EVENT = "ir-open-shortcuts";

/** Opens the shortcuts list from a button, the same as pressing ? does. */
export function openShortcuts(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** The board and the editor own most single keys, so the shortcut only works outside them and outside text fields. */
function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("input, textarea, select, [role=combobox], .excalidraw, .monaco-editor") !== null;
}

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (typingTarget(event.target) || document.querySelector("[role=dialog], [role=alertdialog]")) return;
      event.preventDefault();
      setOpen(true);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press ? on any page to open this list.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5 pb-6">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-ui font-semibold text-muted-foreground">{group.title}</h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {group.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-4 px-3 py-2 text-ui">
                    <span>{item.label}</span>
                    <KbdGroup keys={item.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
