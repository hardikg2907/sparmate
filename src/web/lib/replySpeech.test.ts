import { describe, expect, it } from "vitest";
import type { ChatItem } from "../session/types";
import { markRepliesHeard, replyToSpeak } from "./replySpeech";

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
