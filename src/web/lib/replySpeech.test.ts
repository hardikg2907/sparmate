import { describe, expect, it } from "vitest";
import type { ChatItem } from "../session/types";
import { markRepliesHeard, replySpeechSentences, replyToSpeak } from "./replySpeech";

function reply(id: string, text: string, state: ChatItem["state"] = "streaming"): ChatItem {
  return { id, role: "interviewer", text, at: null, state };
}

const mine: ChatItem = { id: "c1", role: "candidate", text: "Hi", at: 1, state: "done" };

describe("which reply is read aloud", () => {
  it("reads a new reply and keeps reading it while it streams", () => {
    const heard = new Set<string>();
    expect(replyToSpeak([mine, reply("m1", "Hello.")], heard, null)?.id).toBe("m1");
    heard.add("m1");
    // Finished, but still the one being read.
    expect(replyToSpeak([mine, reply("m1", "Hello. More.", "done")], heard, "m1")?.id).toBe("m1");
  });

  it("keeps an interrupted reply silent for the rest of its stream", () => {
    // Esc or barge-in marks the reply heard and drops the active stream.
    const heard = new Set(["m1"]);
    expect(replyToSpeak([mine, reply("m1", "Hello. And then")], heard, null)).toBeNull();
    expect(replyToSpeak([mine, reply("m1", "Hello. And then more.", "done")], heard, null)).toBeNull();
    expect(replyToSpeak([mine, reply("m1", "Hello."), reply("m2", "Next.")], heard, null)?.id).toBe("m2");
  });

  it("does not read on resume a reply that came while speech was off", () => {
    const heard = new Set<string>();
    const items = [mine, reply("m1", "Arrived while paused.", "done"), reply("m2", "Still stream")];
    markRepliesHeard(items, heard);
    expect(heard.has("c1")).toBe(false);
    expect(replyToSpeak(items, heard, null)).toBeNull();
    expect(replyToSpeak([...items, reply("m3", "After resume.")], heard, null)?.id).toBe("m3");
  });

  it("ignores the user's own messages and system notes", () => {
    expect(replyToSpeak([mine, { ...mine, id: "s1", role: "system" }], new Set(), null)).toBeNull();
  });
});

describe("replySpeechSentences", () => {
  it("speaks all blocks when a finished turn has no prose", () => {
    const item: ChatItem = {
      id: "m1",
      role: "coach",
      text: "   ",
      at: 1000,
      state: "done",
      blocks: [
        {
          kind: "diagram",
          layout: "flow",
          title: "Read path",
          nodes: [
            { id: "a", label: "Client" },
            { id: "b", label: "Redis" },
          ],
          edges: [{ from: "a", to: "b" }],
        },
        { kind: "kv", rows: [{ key: "QPS", value: "4,000" }] },
      ],
    };
    expect(replySpeechSentences(item)).toEqual(["Diagram: Read path.", "QPS: 4,000."]);
  });

  it("appends only callout and options blocks when prose is non-empty", () => {
    const item: ChatItem = {
      id: "m2",
      role: "coach",
      text: "Here is the setup.",
      at: 1000,
      state: "done",
      blocks: [
        { kind: "kv", rows: [{ key: "Reads", value: "4,000 / s" }] },
        { kind: "callout", label: "Scenario", text: "Redis `TTL` expires on a hot key." },
        { kind: "options", items: [{ label: "Stampede on Postgres" }, { label: "Stale read from CDN" }] },
      ],
    };
    expect(replySpeechSentences(item)).toEqual(["Here is the setup.", "Scenario.", "Redis TTL expires on a hot key.", "Options: Stampede on Postgres, Stale read from CDN."]);
  });
});
