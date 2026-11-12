import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatBlockSchema, MAX_BLOCKS_PER_TURN, type ChatBlock, type DiagramBlock as DiagramBlockType, type OptionsBlock as OptionsBlockType } from "../../../shared/blocks";
import { ClientMsgSchema, type ClientMsg } from "../../../shared/protocol";
import { FakeServer } from "../../fixtures/fakeServer";
import { hldDebrief, hldRoom, lldDebrief } from "../../fixtures/rooms";
import { CHAT_MAX_CHARS } from "../../lib/contract";
import { chatItems, initialState, reducer } from "../../session/reducer";
import type { ChatItem } from "../../session/types";
import { dispatchSendChat } from "../../session/useSession";
import { ChatPanel } from "../ChatPanel";
import { TooltipProvider } from "../ui/tooltip";
import { ChatBlocks } from "./ChatBlocks";
import { diagramAccessibleDescription } from "./DiagramBlock";
import { OptionsBlock } from "./OptionsBlock";
import {
  applyOptionChoice,
  applyPrefillToComposer,
  focusComposerInput,
  focusSettledOptionsGroup,
  mergePrefillDraft,
  prefersFinePointer,
  resolveOptionsState,
} from "./optionsState";

afterEach(() => {
  vi.unstubAllGlobals();
});

const noopChoose = () => true;

function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function renderChatPanelMarkup(items: ChatItem[]): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ChatPanel
        heading="Guide"
        speaker="Guide"
        items={items}
        agent={{ state: "idle", error: null }}
        onSend={() => true}
        inputLabel="Message to the guide"
        placeholder="Reply to the guide…"
      />
    </TooltipProvider>,
  );
}

describe("ChatBlocks", () => {
  it("renders nothing when blocks array is empty and adjusts top margin for prose", () => {
    expect(renderToStaticMarkup(<ChatBlocks blocks={[]} settled={false} disabled={false} onChoose={noopChoose} />)).toBe("");

    const kv: ChatBlock = { kind: "kv", rows: [{ key: "Read QPS", value: "4,000/s" }] };
    const withProse = renderToStaticMarkup(<ChatBlocks blocks={[kv]} hasProse settled={false} disabled={false} onChoose={noopChoose} />);
    const blocksOnly = renderToStaticMarkup(<ChatBlocks blocks={[kv]} hasProse={false} settled={false} disabled={false} onChoose={noopChoose} />);

    expect(withProse).toContain("mt-2.5");
    expect(blocksOnly).toContain("mt-0.5");
  });

  it("renders KvBlock as a heading-free definition list with exact dt/dd pairs and long-token wrapping", () => {
    const kv: ChatBlock = {
      kind: "kv",
      rows: [
        { key: "Lookup signature", value: "std::unordered_map< TicketId, std::shared_ptr<ParkingTicket> >::const_iterator" },
        { key: "Peak redirect QPS", value: "40,000/s" },
      ],
    };

    const kvHtml = renderToStaticMarkup(<ChatBlocks blocks={[kv]} settled={false} disabled={false} onChoose={noopChoose} />);
    expect(kvHtml).toContain("<dl");
    expect(kvHtml).not.toMatch(/<h[1-6]\b/i);

    const dts = [...kvHtml.matchAll(/<dt\b([^>]*)>([\s\S]*?)<\/dt>/g)];
    const dds = [...kvHtml.matchAll(/<dd\b([^>]*)>([\s\S]*?)<\/dd>/g)];
    expect(dts).toHaveLength(2);
    expect(dds).toHaveLength(2);
    expect(decodeHtmlEntities(dts[0]![2]!)).toBe("Lookup signature");
    expect(decodeHtmlEntities(dds[0]![2]!)).toBe("std::unordered_map< TicketId, std::shared_ptr<ParkingTicket> >::const_iterator");
    expect(decodeHtmlEntities(dts[1]![2]!)).toBe("Peak redirect QPS");
    expect(decodeHtmlEntities(dds[1]![2]!)).toBe("40,000/s");
    for (const match of [...dts, ...dds]) {
      expect(match[1]).toContain("min-w-0");
      expect(match[1]).toContain("[overflow-wrap:anywhere]");
    }
  });

  it("renders unsettled options as buttons, wraps long tokens across blocks, and collapses cleanly when settled", () => {
    const sendOptions: ChatBlock = {
      kind: "options",
      items: [
        { label: "302 Found", note: "Keep every redirect observable", reply: "I choose 302 Found so we count clicks." },
        { label: "301 Moved Permanently", note: "Browser caches forever" },
      ],
    };

    const unsettledSend = renderToStaticMarkup(<ChatBlocks blocks={[sendOptions]} settled={false} disabled={false} onChoose={noopChoose} />);
    expect([...unsettledSend.matchAll(/<button\b/g)]).toHaveLength(2);
    expect(unsettledSend).toContain("↵");
    expect(unsettledSend).toContain("[overflow-wrap:anywhere]");

    const prefillOptions: ChatBlock = { ...sendOptions, action: "prefill" };
    const unsettledPrefill = renderToStaticMarkup(<ChatBlocks blocks={[prefillOptions]} settled={false} disabled onChoose={noopChoose} />);
    expect(unsettledPrefill).toContain("✎");
    expect(unsettledPrefill).toContain("disabled");

    const settledPicked = renderToStaticMarkup(
      <ChatBlocks blocks={[sendOptions]} settled disabled={false} answeredText="I choose 302 Found so we count clicks." onChoose={noopChoose} />,
    );
    expect(settledPicked).not.toContain("<button");
    expect(settledPicked).toContain("Selected: ");
    expect(settledPicked).toContain("opacity-60");

    const settledUnanswered = renderToStaticMarkup(<ChatBlocks blocks={[sendOptions]} settled disabled={false} answeredText={null} onChoose={noopChoose} />);
    expect(settledUnanswered).not.toContain("<button");
    expect(settledUnanswered).not.toContain("Selected: ");
  });

  it("renders board and code anchors with anywhere wrapping as buttons when onAnchor is provided and static cards otherwise", () => {
    const anchors: ChatBlock[] = [
      { kind: "anchor", target: { kind: "board", elementId: "redis" }, label: "Redis cache", note: "Hot set" },
      { kind: "anchor", target: { kind: "code", line: 60, endLine: 65 }, label: "ParkingLot::exit(std::unordered_map<int,Ticket>&)" },
      { kind: "anchor", target: { kind: "code", line: 12 }, label: "Spot struct" },
    ];

    const interactive = renderToStaticMarkup(<ChatBlocks blocks={anchors} settled={false} disabled={false} onChoose={noopChoose} onAnchor={() => {}} />);
    expect(interactive).toContain("<button");
    expect(interactive).toContain("L60–65");
    expect(interactive).toContain("L12");
    expect(interactive).toContain("→");
    expect(interactive).toContain("[overflow-wrap:anywhere]");

    const passive = renderToStaticMarkup(<ChatBlocks blocks={anchors} settled={false} disabled={false} onChoose={noopChoose} />);
    expect(passive).not.toContain("<button");
    expect(passive).not.toContain("→");
  });

  it("wires DiagramBlock aria-describedby to a hidden arrow-free description and renders full-text SVG <title> tooltips on truncated pills", () => {
    const flowDiagram: DiagramBlockType = {
      kind: "diagram",
      layout: "flow",
      title: "Redirect path",
      nodes: [
        { id: "c", label: "Client" },
        { id: "r", label: "Redis", detail: "TTL 24h" },
      ],
      edges: [{ from: "c", to: "r", label: "GET" }],
    };
    const longStepLabel = "SELECT code, long_url, owner_id, expires_at FROM links WHERE code = $1";
    const seqDiagram: DiagramBlockType = {
      kind: "diagram",
      layout: "sequence",
      actors: [
        { id: "a", label: "API" },
        { id: "db", label: "Postgres" },
      ],
      steps: [{ from: "a", to: "db", label: longStepLabel, style: "dashed" }],
    };
    const callout: ChatBlock = {
      kind: "callout",
      label: "Invariant",
      text: "Use `tickets_.find(id)` before mutating `spots_`.",
    };

    for (const diagram of [flowDiagram, seqDiagram]) {
      const html = renderToStaticMarkup(<ChatBlocks blocks={[diagram]} settled={false} disabled={false} onChoose={noopChoose} />);
      const svgMatch = html.match(/<svg\b[^>]*\baria-describedby="([^"]+)"[^>]*>/);
      expect(svgMatch).not.toBeNull();
      const descId = svgMatch![1]!;
      const descRegex = new RegExp(`<div\\b([^>]*)\\bid="${descId}"([^>]*)>([\\s\\S]*?)<\\/div>`);
      const descMatch = html.match(descRegex);
      expect(descMatch).not.toBeNull();
      const descAttrs = `${descMatch![1]!} ${descMatch![2]!}`;
      expect(descAttrs).toMatch(/\bhidden\b/);
      expect(html).not.toContain("sr-only");

      const descText = decodeHtmlEntities(descMatch![3]!);
      expect(descText).toBe(diagramAccessibleDescription(diagram));
      expect(descText).toContain(" to ");
      expect(descText).not.toContain("->");
      expect(descText).not.toContain("-->");
    }

    const seqHtml = renderToStaticMarkup(<ChatBlocks blocks={[seqDiagram]} settled={false} disabled={false} onChoose={noopChoose} />);
    const tspans = [...seqHtml.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)].map((m) => decodeHtmlEntities(m[1]!));
    expect(tspans.some((line) => line.includes("…"))).toBe(true);
    const pillTitleMatch = seqHtml.match(/<g><title>([\s\S]*?)<\/title><rect\b/);
    expect(pillTitleMatch).not.toBeNull();
    expect(decodeHtmlEntities(pillTitleMatch![1]!)).toBe(longStepLabel);

    const calloutHtml = renderToStaticMarkup(<ChatBlocks blocks={[callout]} settled={false} disabled={false} onChoose={noopChoose} />);
    expect(calloutHtml).toContain("Invariant");
    expect(calloutHtml).toContain("<code");
    expect(calloutHtml).toContain("tickets_.find(id)");
    expect(calloutHtml).toContain("[overflow-wrap:anywhere]");
  });

  it("keeps interview room fixtures free of blocks while validating guided and debrief fixture blocks", () => {
    const interviewRoom = hldRoom("interview");
    expect(interviewRoom.transcript.some((entry) => (entry.blocks?.length ?? 0) > 0)).toBe(false);

    for (const session of [hldRoom("guided"), hldDebrief("debriefed"), lldDebrief("debriefed")]) {
      const withBlocks = session.transcript.filter((entry) => (entry.blocks?.length ?? 0) > 0);
      expect(withBlocks.length).toBeGreaterThan(0);
      for (const entry of withBlocks) {
        expect(entry.blocks!.length).toBeLessThanOrEqual(MAX_BLOCKS_PER_TURN);
        for (const block of entry.blocks!) {
          expect(ChatBlockSchema.safeParse(block).success).toBe(true);
        }
      }
    }
  });
});

describe("options settlement, wire messages, pointer-aware focus, and prefill replacement", () => {
  const sendOptionBlock: OptionsBlockType = {
    kind: "options",
    items: [
      { label: "302 Found", reply: "I pick 302 Found." },
      { label: "301 Moved Permanently", reply: "I pick 301 Moved Permanently." },
    ],
  };
  const optionBlocks: ChatBlock[] = [sendOptionBlock];

  const openingTurn: ChatItem = {
    id: "g1",
    role: "interviewer",
    text: "Which redirect status fits click analytics?",
    blocks: optionBlocks,
    at: 0,
    state: "done",
  };

  it("settles options on candidate or later assistant turns, ignores system notes, and unfreezes if a pending send is lost on reconnect", () => {
    const withSystemNote: ChatItem[] = [openingTurn, { id: "sys-1", role: "system", text: "Moved to API", at: 10_000, state: "done" }];
    expect(resolveOptionsState(withSystemNote, 0)).toEqual({ settled: false, answeredText: null });
    const unsettledPanelHtml = renderChatPanelMarkup(withSystemNote);
    expect(unsettledPanelHtml).not.toContain("Selected: ");
    expect(unsettledPanelHtml).toContain("302 Found");
    expect(unsettledPanelHtml).toContain("↵");

    const afterCandidate: ChatItem[] = [...withSystemNote, { id: "c-1", role: "candidate", text: "I pick 302 Found.", at: 12_000, state: "pending" }];
    expect(resolveOptionsState(afterCandidate, 0)).toEqual({ settled: true, answeredText: "I pick 302 Found." });
    const candidateHtml = renderChatPanelMarkup(afterCandidate);
    expect(candidateHtml).toContain("Selected: ");
    expect(candidateHtml).not.toContain("↵");

    // A later guide/coach message from Check step, "I'm stuck", or a silence check-in settles old options with answeredText: null.
    const afterGuideCheckIn: ChatItem[] = [...withSystemNote, { id: "g-2", role: "interviewer", text: "Let's check your step so far.", at: 20_000, state: "streaming" }];
    expect(resolveOptionsState(afterGuideCheckIn, 0)).toEqual({ settled: true, answeredText: null });
    const guideHtml = renderChatPanelMarkup(afterGuideCheckIn);
    expect(guideHtml).not.toContain("Selected: ");
    expect(guideHtml).not.toContain("↵");
    expect(guideHtml).toContain("opacity-60");

    // Simulate clicking a "send" option -> pending candidate item -> socket reconnects without having received it -> options unfreeze back to buttons.
    const guidedSession = hldRoom("guided");
    const sessionWithOptions = {
      ...guidedSession,
      transcript: [
        {
          id: "g1",
          at: 0,
          wall: new Date(1_700_000_000_000).toISOString(),
          role: "interviewer" as const,
          channel: "interview" as const,
          text: openingTurn.text,
          blocks: optionBlocks,
        },
      ],
    };

    let state = reducer(initialState, {
      type: "loaded",
      session: sessionWithOptions,
      board: null,
      code: null,
      now: 1_700_000_005_000,
    });

    dispatchSendChat("interview", "I pick 302 Found.", {
      now: 1_700_000_006_000,
      clientMsgId: "opt-msg-1",
      dispatch: (action) => {
        state = reducer(state, action);
      },
      send: () => true,
    });

    const whilePending = chatItems(state, "interview");
    expect(resolveOptionsState(whilePending, 0)).toEqual({ settled: true, answeredText: "I pick 302 Found." });
    expect(renderChatPanelMarkup(whilePending)).toContain("Selected: ");
    expect(renderChatPanelMarkup(whilePending)).not.toContain("↵");

    // Socket drops and re-opens (carrying earlier pending messages), then receives fresh server state lacking opt-msg-1.
    state = reducer(state, { type: "connection", status: "reconnecting" });
    state = reducer(state, { type: "connection", status: "open" });
    state = reducer(state, {
      type: "server",
      msg: { type: "session.state", session: sessionWithOptions },
      now: 1_700_000_008_000,
      fresh: true,
    });

    const afterReconnect = chatItems(state, "interview");
    expect(resolveOptionsState(afterReconnect, 0)).toEqual({ settled: false, answeredText: null });
    const unfrozenHtml = renderChatPanelMarkup(afterReconnect);
    expect(unfrozenHtml).toContain("↵");
    expect(unfrozenHtml).not.toContain("Selected: ");
  });

  it("omits fromOption on the wire for option sends and matches optionTexts server-side in FakeServer", () => {
    const sentMessages: ClientMsg[] = [];

    const ok = applyOptionChoice("I pick 302 Found.", "send", {
      disabled: false,
      onSend: (text) =>
        dispatchSendChat("interview", text, {
          clientMsgId: "cid-42",
          dispatch: () => {},
          send: (msg) => {
            sentMessages.push(msg);
            return true;
          },
        }),
      onPrefill: () => {},
      onFocusComposer: () => {},
    });

    expect(ok).toBe(true);
    expect(sentMessages).toEqual([
      {
        type: "chat.send",
        channel: "interview",
        clientMsgId: "cid-42",
        text: "I pick 302 Found.",
      },
    ]);
    expect(ClientMsgSchema.safeParse(sentMessages[0]).success).toBe(true);
    expect("fromOption" in sentMessages[0]!).toBe(false);

    // FakeServer mirrors the real server by populating optionTexts from unsettled options without any client flag.
    const guidedSession = {
      ...hldRoom("guided"),
      transcript: [
        {
          id: "g1",
          at: 0,
          wall: new Date(1_700_000_000_000).toISOString(),
          role: "interviewer" as const,
          channel: "interview" as const,
          text: openingTurn.text,
          blocks: optionBlocks,
        },
      ],
    };
    const fake = new FakeServer({ session: guidedSession, board: null, code: null, boardImageUrl: "" });
    fake.handle(sentMessages[0]!);
    const recorded = fake.session.transcript.at(-1);
    expect(recorded?.role).toBe("candidate");
    expect(recorded?.optionTexts).toEqual(["I pick 302 Found."]);
  });

  it("focuses the composer textarea after option send only on fine pointers and focuses the settled options group on touch", () => {
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({ matches: query === "(pointer: fine)" }),
    });
    expect(prefersFinePointer()).toBe(true);

    const fineComposer = { focus: vi.fn() };
    const fineGroup = { focus: vi.fn() };
    let finePendingGroup = false;

    const fineSent = applyOptionChoice("I pick 302 Found.", "send", {
      disabled: false,
      onSend: () => true,
      onPrefill: () => {},
      onFocusComposer: () => {
        focusComposerInput(false, fineComposer);
      },
      onFocusGroup: () => {
        finePendingGroup = true;
      },
    });
    focusSettledOptionsGroup(true, finePendingGroup, fineGroup);

    expect(fineSent).toBe(true);
    expect(fineComposer.focus).toHaveBeenCalledTimes(1);
    expect(fineGroup.focus).not.toHaveBeenCalled();

    const fineSettledHtml = renderToStaticMarkup(<OptionsBlock block={sendOptionBlock} settled disabled={false} answeredText="I pick 302 Found." onChoose={noopChoose} />);
    expect(fineSettledHtml).toContain('role="group"');
    expect(fineSettledHtml).not.toContain('tabindex="-1"');

    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    expect(prefersFinePointer()).toBe(false);

    const touchComposer = { focus: vi.fn() };
    const touchGroup = { focus: vi.fn() };
    let touchPendingGroup = false;

    const touchSent = applyOptionChoice("I pick 302 Found.", "send", {
      disabled: false,
      onSend: () => true,
      onPrefill: () => {},
      onFocusComposer: () => {
        focusComposerInput(false, touchComposer);
      },
      onFocusGroup: () => {
        touchPendingGroup = true;
      },
    });
    expect(touchSent).toBe(true);
    expect(touchComposer.focus).not.toHaveBeenCalled();
    expect(touchPendingGroup).toBe(true);
    expect(focusSettledOptionsGroup(true, touchPendingGroup, touchGroup)).toBe(true);
    expect(touchGroup.focus).toHaveBeenCalledTimes(1);

    const touchSettledHtml = renderToStaticMarkup(
      <OptionsBlock block={sendOptionBlock} settled disabled={false} answeredText="I pick 302 Found." focusGroupOnSettle onChoose={noopChoose} />,
    );
    expect(touchSettledHtml).toContain('role="group"');
    expect(touchSettledHtml).toContain('tabindex="-1"');
    expect(touchSettledHtml).toContain("outline-none");
  });

  it("replaces an unedited prefill on a second prefill click, appends when edited, and caps drafts at CHAT_MAX_CHARS", () => {
    expect(mergePrefillDraft("", "Return std::nullopt.")).toBe("Return std::nullopt.");
    expect(mergePrefillDraft("   ", "Return std::nullopt.")).toBe("Return std::nullopt.");
    expect(mergePrefillDraft("Return std::nullopt.", "  Return std::nullopt. ")).toBe("Return std::nullopt.");
    expect(mergePrefillDraft("First check ticketId:   ", "Return std::nullopt.")).toBe("First check ticketId: Return std::nullopt.");
    expect(mergePrefillDraft("Plan:\n", "Return std::nullopt.")).toBe("Plan:\nReturn std::nullopt.");

    const focus = vi.fn();
    const setSelectionRange = vi.fn();
    let draft = "";
    let lastPrefill: string | null = null;
    const clickPrefill = (incoming: string) => {
      applyOptionChoice(incoming, "prefill", {
        disabled: false,
        onSend: () => false,
        onPrefill: (text) => {
          draft = applyPrefillToComposer(draft, text, false, { focus, setSelectionRange }, lastPrefill);
          lastPrefill = text.slice(0, CHAT_MAX_CHARS);
        },
        onFocusComposer: () => {},
      });
    };

    clickPrefill("A");
    expect(draft).toBe("A");
    clickPrefill("B");
    expect(draft).toBe("B");
    expect(setSelectionRange).toHaveBeenLastCalledWith(1, 1);

    draft = "";
    lastPrefill = null;
    clickPrefill("A");
    draft = "A because of hot keys";
    clickPrefill("B");
    expect(draft).toBe("A because of hot keys B");
    expect(setSelectionRange).toHaveBeenLastCalledWith(draft.length, draft.length);

    const longExisting = "x".repeat(CHAT_MAX_CHARS - 5);
    const incomingTail = "0123456789abcdef";
    const capped = mergePrefillDraft(longExisting, incomingTail, "A");
    expect(capped).toHaveLength(CHAT_MAX_CHARS);
    expect(capped).toBe(`${longExisting} ${incomingTail}`.slice(0, CHAT_MAX_CHARS));

    const oversizedSingle = mergePrefillDraft("", "y".repeat(CHAT_MAX_CHARS + 50));
    expect(oversizedSingle).toHaveLength(CHAT_MAX_CHARS);
  });
});
