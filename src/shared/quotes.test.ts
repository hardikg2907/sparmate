import { describe, expect, it } from "vitest";
import { checkQuotes, normalizeQuote } from "./quotes";

type Source = "candidate" | "board" | "code";

function card(dimensions: { id: string; quotes: { quote: string; source: Source }[] }[]) {
  return {
    dimensions: dimensions.map((d) => ({
      id: d.id,
      name: d.id,
      score: 3,
      whatA4LooksLike: "",
      evidence: d.quotes.map((q) => ({ quote: q.quote, source: q.source, at: "", polarity: "plus" as const })),
    })),
  };
}

const sources = {
  candidate: [
    "I would shard by user id, because a user’s reads stay on one shard.",
    "Then we add a cache.   The cache sits in front of the\ndatabase and absorbs the hot keys.",
    "“At-least-once” delivery, with an idempotency key.",
  ].join("\n"),
  board: "Nodes:\n- [API service] (kind: service)\n- [Postgres] (kind: database)\nEdges:\n- [API service] -> [Postgres] \"SQL\"",
  code: "class Lot {\n  std::mutex mu_;\n  int free = 3;\n  void enter() { std::lock_guard<std::mutex> g(mu_); --free; }\n};",
};

function verify(quote: string, source: Source = "candidate"): boolean {
  const [result] = checkQuotes(card([{ id: "d", quotes: [{ quote, source }] }]), sources);
  return result!.verified;
}

describe("normalizeQuote", () => {
  it("lower-cases, collapses whitespace and trims", () => {
    expect(normalizeQuote("  Hello \n\t  WORLD  ")).toBe("hello world");
  });

  it("turns curly quotes into straight quotes", () => {
    expect(normalizeQuote("it’s a “quote” inside")).toBe("it's a \"quote\" inside");
  });

  it("trims surrounding quote marks and trailing punctuation", () => {
    expect(normalizeQuote("\"we shard by user id.\"")).toBe("we shard by user id");
    expect(normalizeQuote("“we shard by user id!”")).toBe("we shard by user id");
    expect(normalizeQuote("'text', ")).toBe("text");
    expect(normalizeQuote("trailing ellipsis...")).toBe("trailing ellipsis");
  });

  it("applies Unicode NFKC", () => {
    expect(normalizeQuote("ＡＢＣ café")).toBe("abc café");
    expect(normalizeQuote("wait… what")).toBe("wait... what");
    expect(normalizeQuote("é")).toBe("é");
  });

  it("keeps punctuation inside the quote", () => {
    expect(normalizeQuote("a, b; c: d")).toBe("a, b; c: d");
  });

  it("returns an empty string for text that is only marks", () => {
    expect(normalizeQuote(" \"\" ... ")).toBe("");
  });
});

describe("checkQuotes", () => {
  it("verifies an exact quote from the candidate", () => {
    expect(verify("I would shard by user id")).toBe(true);
  });

  it("ignores case, curly quotes and spacing differences", () => {
    expect(verify("I WOULD   SHARD by user id, because a user's reads stay on one shard")).toBe(true);
    expect(verify("the cache sits in front of the database")).toBe(true);
    expect(verify("\"At-least-once\" delivery")).toBe(true);
  });

  it("ignores surrounding quote marks and trailing punctuation", () => {
    expect(verify("“Then we add a cache.”")).toBe(true);
    expect(verify("with an idempotency key!!!")).toBe(true);
  });

  it("rejects an invented quote", () => {
    expect(verify("I would shard by tenant id")).toBe(false);
    expect(verify("we should use Kafka here")).toBe(false);
  });

  it("rejects an empty quote and a quote of only marks", () => {
    expect(verify("")).toBe(false);
    expect(verify("   ")).toBe(false);
    expect(verify("\"...\"")).toBe(false);
  });

  it("treats an ellipsis as parts that must all appear in order", () => {
    expect(verify("Then we add a cache... absorbs the hot keys")).toBe(true);
    expect(verify("Then we add a cache… absorbs the hot keys")).toBe(true);
    expect(verify("I would shard... one shard")).toBe(true);
    expect(verify("absorbs the hot keys... Then we add a cache")).toBe(false);
    expect(verify("Then we add a cache... something never said")).toBe(false);
  });

  it("does not let two parts reuse the same stretch of the source", () => {
    expect(verify("a cache... a cache")).toBe(false);
    expect(verify("add a cache... the cache sits")).toBe(true);
  });

  it("handles a leading or trailing ellipsis", () => {
    expect(verify("...hot keys")).toBe(true);
    expect(verify("I would shard by user id...")).toBe(true);
  });

  it("checks board quotes against the graph text and code quotes against the code", () => {
    expect(verify("[API service] -> [Postgres]", "board")).toBe(true);
    expect(verify("(kind: database)", "board")).toBe(true);
    expect(verify("std::lock_guard<std::mutex> g(mu_)", "code")).toBe(true);
    expect(verify("int free = 3;", "code")).toBe(true);
  });

  it("does not accept a quote from the wrong source", () => {
    expect(verify("std::lock_guard<std::mutex> g(mu_)", "candidate")).toBe(false);
    expect(verify("I would shard by user id", "code")).toBe(false);
    expect(verify("I would shard by user id", "board")).toBe(false);
  });

  it("returns one result per evidence item with the dimension id and index", () => {
    const results = checkQuotes(
      card([
        { id: "design", quotes: [{ quote: "add a cache", source: "candidate" }, { quote: "made up words", source: "candidate" }] },
        { id: "working_code", quotes: [] },
        { id: "concurrency", quotes: [{ quote: "std::mutex mu_;", source: "code" }] },
      ]),
      sources,
    );
    expect(results).toEqual([
      { dimensionId: "design", index: 0, verified: true },
      { dimensionId: "design", index: 1, verified: false },
      { dimensionId: "concurrency", index: 0, verified: true },
    ]);
  });

  it("returns an empty list when there are no dimensions", () => {
    expect(checkQuotes({ dimensions: [] }, sources)).toEqual([]);
  });

  it("copes with empty sources", () => {
    const [result] = checkQuotes(card([{ id: "d", quotes: [{ quote: "anything", source: "code" }] }]), { candidate: "", board: "", code: "" });
    expect(result!.verified).toBe(false);
  });
});
