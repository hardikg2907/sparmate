import { FONT_FAMILY } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

// Excalidraw registers its faces but leaves them unloaded until something draws with them. Text measured
// before that is sized with a system font, so a box built from it later clips the real text.

const NAME_BY_ID = new Map<number, string>(Object.entries(FONT_FAMILY).map(([name, id]) => [id, name]));

const PRINTABLE = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~«»";

const REGISTRATION_POLL_MS = 50;
const REGISTRATION_POLLS = 40;

function isRegistered(name: string): boolean {
  for (const face of document.fonts) {
    if (face.family.replaceAll('"', "") === name) return true;
  }
  return false;
}

/** Excalidraw adds its faces to `document.fonts` a moment after it mounts; a load before that matches nothing. */
async function waitForRegistration(name: string): Promise<void> {
  for (let i = 0; i < REGISTRATION_POLLS && !isRegistered(name); i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, REGISTRATION_POLL_MS));
  }
}

async function loadFamily(name: string, chars: string): Promise<void> {
  try {
    await document.fonts.load(`16px "${name}"`, chars);
  } catch {
    // A face that cannot load leaves a system font, which is all the board can draw with then.
  }
}

/** Loads the faces the palette draws with: hand-drawn labels, and the monospace face of class boxes. */
export async function loadBoardFonts(): Promise<void> {
  await Promise.all(
    ["Excalifont", "Cascadia"].map(async (name) => {
      await waitForRegistration(name);
      await loadFamily(name, PRINTABLE);
    }),
  );
}

/** Loads the faces, and the characters of them, that the given text elements use. */
export async function loadSceneFonts(elements: readonly ExcalidrawElement[]): Promise<void> {
  const charsByFamily = new Map<string, Set<string>>();
  for (const element of elements) {
    if (element.type !== "text") continue;
    const name = NAME_BY_ID.get(element.fontFamily);
    if (!name) continue;
    const chars = charsByFamily.get(name) ?? new Set<string>();
    for (const char of element.text) chars.add(char);
    charsByFamily.set(name, chars);
  }
  await Promise.all([...charsByFamily].map(([name, chars]) => loadFamily(name, [...chars].join(""))));
}
