import { describe, expect, it } from "vitest";
import {
  OUTSIDE_CHANGE_NOTICE,
  confirmVersion,
  decideAfterReconnect,
  decideOnExternal,
  editLedger,
  recordSent,
  settleLedger,
  startLedger,
  type CodeLedger,
} from "./codeSync";

const loaded = () => startLedger({ version: 4, content: "v4" });

function typed(ledger: CodeLedger, ...texts: string[]): CodeLedger {
  return texts.reduce((l, text) => editLedger(l, text), ledger);
}

describe("after a reconnect", () => {
  it("does nothing when the server holds the editor text", () => {
    const ledger = recordSent(typed(loaded(), "v5"));
    expect(decideAfterReconnect(ledger, { version: 5, content: "v5" })).toEqual({ kind: "same", version: 5 });
  });

  it("sends unsent edits quietly when the file did not change", () => {
    const ledger = typed(loaded(), "v5", "v6");
    expect(decideAfterReconnect(ledger, { version: 4, content: "v4" })).toEqual({ kind: "send", version: 6, notice: null });
  });

  it("sends again quietly when an update was lost in the drop", () => {
    // v5 reached the server, v6 went out as the socket died.
    const ledger = recordSent(typed(recordSent(typed(loaded(), "v5")), "v6"));
    expect(decideAfterReconnect(ledger, { version: 5, content: "v5" })).toEqual({ kind: "send", version: 6, notice: null });
  });

  it("shows the file's text when the editor had nothing unsaved", () => {
    expect(decideAfterReconnect(loaded(), { version: 5, content: "edited in vim" })).toEqual({ kind: "take" });
  });

  it("keeps unsent edits over an outside change, above the server's version, and says so", () => {
    // Before the fix the edit went out as version 5 and the server, now at 6, dropped it without a word.
    const ledger = typed(loaded(), "mine");
    const decision = decideAfterReconnect(ledger, { version: 6, content: "edited in vim" });
    expect(decision).toEqual({ kind: "send", version: 7, notice: OUTSIDE_CHANGE_NOTICE });
    const next = settleLedger(ledger, decision, { version: 6, content: "edited in vim" });
    expect(next.editor).toEqual({ version: 7, content: "mine" });
    expect(next.unsent).toBe(true);
  });

  it("treats a sent update the server may never have read as unsaved when the file changed", () => {
    // Two updates died in the drop; the outside edit then took version 5, the same number as one of them.
    const ledger = recordSent(typed(loaded(), "v5", "v6"));
    expect(decideAfterReconnect(ledger, { version: 5, content: "edited in vim" })).toEqual({ kind: "send", version: 7, notice: OUTSIDE_CHANGE_NOTICE });
  });
});

describe("on a live outside change", () => {
  it("shows the file's text when every edit was already saved", () => {
    const ledger = recordSent(typed(loaded(), "v5"));
    expect(decideOnExternal(ledger, { version: 6, content: "edited in vim" })).toEqual({ kind: "take" });
  });

  it("keeps the editor when its newer update is already on the way", () => {
    // The server was at 4, the file changed (5), and the page had just sent 6, which the server takes next.
    const ledger = recordSent(typed(loaded(), "v5", "v6"));
    expect(decideOnExternal(ledger, { version: 5, content: "edited in vim" })).toEqual({ kind: "keep", notice: OUTSIDE_CHANGE_NOTICE });
  });

  it("sends again above the server when the update at the same version was dropped", () => {
    const ledger = recordSent(typed(loaded(), "v5"));
    expect(decideOnExternal(ledger, { version: 5, content: "edited in vim" })).toEqual({ kind: "send", version: 6, notice: OUTSIDE_CHANGE_NOTICE });
  });

  it("keeps edits that were still waiting for the debounce", () => {
    const ledger = typed(recordSent(typed(loaded(), "v5")), "v6");
    expect(decideOnExternal(ledger, { version: 6, content: "edited in vim" })).toEqual({ kind: "send", version: 7, notice: OUTSIDE_CHANGE_NOTICE });
  });

  it("settles when the outside text matches the editor", () => {
    const ledger = typed(loaded(), "same");
    const decision = decideOnExternal(ledger, { version: 5, content: "same" });
    expect(decision).toEqual({ kind: "same", version: 5 });
    expect(settleLedger(ledger, decision, { version: 5, content: "same" })).toMatchObject({ unsent: false, sent: [], base: { version: 5 } });
  });
});

describe("ledger", () => {
  it("moves the base to a version the server checked and forgets older sends", () => {
    let ledger = recordSent(typed(loaded(), "v5"));
    ledger = recordSent(typed(ledger, "v6"));
    ledger = confirmVersion(ledger, 5);
    expect(ledger.base).toEqual({ version: 5, content: "v5" });
    expect(ledger.sent).toEqual([{ version: 6, content: "v6" }]);
    // A version that is not one of ours, such as an outside change, moves nothing.
    expect(confirmVersion(ledger, 9)).toBe(ledger);
  });
});
