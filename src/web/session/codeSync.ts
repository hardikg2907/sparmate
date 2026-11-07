// The server drops a code update that is not newer than its version without a word, and an outside edit bumps
// that version too, so the page decides whose text wins from what it knows the server holds and what it has sent.

export interface CodeText {
  version: number;
  content: string;
}

export interface CodeLedger {
  /** The last text the server is known to hold. */
  base: CodeText;
  /** Texts handed to the socket since `base`, oldest first. Any of them may have been lost or dropped. */
  sent: CodeText[];
  editor: CodeText;
  /** The editor text has not been handed to the socket yet. */
  unsent: boolean;
}

export type CodeDecision =
  /** The server already holds the editor text. */
  | { kind: "same"; version: number }
  /** The editor holds nothing the server lacks, so it shows the server's text. */
  | { kind: "take" }
  /** The editor text wins and is sent again above the server's version. */
  | { kind: "send"; version: number; notice: string | null }
  /** A newer editor text is already on its way and will replace the outside change. */
  | { kind: "keep"; notice: string };

export const OUTSIDE_CHANGE_NOTICE =
  "The code file changed outside the editor while you had unsaved edits. Your editor text was kept and saved over it.";

const SENT_LIMIT = 20;

export function startLedger(text: CodeText): CodeLedger {
  return { base: text, sent: [], editor: text, unsent: false };
}

export function editLedger(ledger: CodeLedger, content: string): CodeLedger {
  return { ...ledger, editor: { version: ledger.editor.version + 1, content }, unsent: true };
}

export function recordSent(ledger: CodeLedger): CodeLedger {
  const sent = [...ledger.sent, ledger.editor].slice(-SENT_LIMIT);
  return { ...ledger, sent, unsent: false };
}

/** The server checked `version`, so it held that text then; when the text was ours it becomes the base. */
export function confirmVersion(ledger: CodeLedger, version: number): CodeLedger {
  const at = ledger.sent.findIndex((t) => t.version === version);
  if (at === -1) return ledger;
  return { ...ledger, base: ledger.sent[at]!, sent: ledger.sent.slice(at + 1) };
}

/** After a reconnect, with the server's text fetched fresh. */
export function decideAfterReconnect(ledger: CodeLedger, server: CodeText): CodeDecision {
  const { editor, base, sent } = ledger;
  if (server.content === editor.content) return { kind: "same", version: Math.max(editor.version, server.version) };
  // The server holds a text of ours that the editor has moved past: some updates were lost in the drop.
  const ours = server.content === base.content || sent.some((t) => t.version === server.version && t.content === server.content);
  if (ours) return { kind: "send", version: Math.max(editor.version, server.version + 1), notice: null };
  if (!ledger.unsent && sent.length === 0) return { kind: "take" };
  return { kind: "send", version: Math.max(editor.version, server.version) + 1, notice: OUTSIDE_CHANGE_NOTICE };
}

/** On a live `code.external`, which the server sends after bumping its version by one. */
export function decideOnExternal(ledger: CodeLedger, external: CodeText): CodeDecision {
  const { editor, sent } = ledger;
  if (external.content === editor.content) return { kind: "same", version: Math.max(editor.version, external.version) };
  const lastSent = sent.reduce((max, t) => Math.max(max, t.version), -1);
  // The server takes that newer update after the outside change and writes it over the file.
  if (lastSent > external.version) return { kind: "keep", notice: OUTSIDE_CHANGE_NOTICE };
  // Every update sent so far was saved before the outside change, so the editor has nothing to lose.
  if (!ledger.unsent && lastSent < external.version) return { kind: "take" };
  // Unsent edits, or an update at the same version that the server dropped as not newer.
  return { kind: "send", version: Math.max(editor.version, external.version) + 1, notice: OUTSIDE_CHANGE_NOTICE };
}

/** The ledger once a decision is carried out; a "send" still has to be handed to the socket. */
export function settleLedger(ledger: CodeLedger, decision: CodeDecision, server: CodeText): CodeLedger {
  switch (decision.kind) {
    case "same": {
      const text = { version: decision.version, content: ledger.editor.content };
      return { base: text, sent: [], editor: text, unsent: false };
    }
    case "take":
      return startLedger(server);
    case "send":
      return { base: server, sent: [], editor: { version: decision.version, content: ledger.editor.content }, unsent: true };
    case "keep":
      return ledger;
  }
}
