import { describe, expect, it } from "vitest";
import { plainHintTopic } from "./hint-topic";

describe("plainHintTopic", () => {
  it("drops a leading ladder code and its joining word", () => {
    expect(plainHintTopic("H2 on cache invalidation")).toBe("Cache invalidation");
    expect(plainHintTopic("h3: two ways to shard")).toBe("Two ways to shard");
    expect(plainHintTopic("Level 1 - the write path")).toBe("The write path");
    expect(plainHintTopic("level2 about ordering")).toBe("Ordering");
  });

  it("keeps a topic that has no code", () => {
    expect(plainHintTopic("  Hot keys in the cache ")).toBe("Hot keys in the cache");
    expect(plainHintTopic("H2-compatible test store")).toBe("H2-compatible test store");
    expect(plainHintTopic("H20 emission model")).toBe("H20 emission model");
    expect(plainHintTopic("Levels of caching")).toBe("Levels of caching");
  });

  it("keeps the text when the code is all there is", () => {
    expect(plainHintTopic("H2")).toBe("H2");
  });
});
