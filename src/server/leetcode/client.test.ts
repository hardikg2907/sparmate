import { describe, expect, it, vi } from "vitest";
import { createLeetcodeClient, LeetcodeError } from "./client";
import { fixture, jsonResponse } from "./support";

function clientFor(body: string | (() => Response), over: { maxBytes?: number; timeoutMs?: number } = {}) {
  const fetchFn = vi.fn(async () => (typeof body === "string" ? jsonResponse(body) : body()));
  return { fetchFn, client: createLeetcodeClient({ fetch: fetchFn as unknown as typeof fetch, userAgent: "sparmate/test", ...over }) };
}

describe("profile", () => {
  it("reads the lifetime totals of a good reply", async () => {
    const { client } = clientFor(fixture("profile"));
    expect(await client.profile("example_user")).toEqual({ found: true, profile: { totals: { all: 45, easy: 12, medium: 22, hard: 11 } } });
  });

  it("reports an unknown user, even when an errors list comes with it", async () => {
    const { client } = clientFor(fixture("profile-unknown"));
    expect(await client.profile("example_user")).toEqual({ found: false });
  });

  it("rejects a malformed reply", async () => {
    for (const body of [
      "not json",
      "{}",
      '{"data":{"matchedUser":{"submitStatsGlobal":{"acSubmissionNum":[{"difficulty":"All","count":"45"}]}}}}',
      '{"data":{"matchedUser":{}}}',
    ]) {
      await expect(clientFor(body).client.profile("example_user")).rejects.toBeInstanceOf(LeetcodeError);
    }
  });

  it("rejects a reply that lacks one of the four totals", async () => {
    const body = '{"data":{"matchedUser":{"submitStatsGlobal":{"acSubmissionNum":[{"difficulty":"All","count":3}]}}}}';
    await expect(clientFor(body).client.profile("example_user")).rejects.toBeInstanceOf(LeetcodeError);
  });

  it("rejects a name that is not a LeetCode handle without asking LeetCode", async () => {
    const { client, fetchFn } = clientFor(fixture("profile"));
    await expect(client.profile("a/../b")).rejects.toBeInstanceOf(LeetcodeError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects an oversize reply by its declared length", async () => {
    const { client } = clientFor(() => jsonResponse(fixture("profile"), { headers: { "content-length": "999999" } }), { maxBytes: 1000 });
    await expect(client.profile("example_user")).rejects.toThrow("too large");
  });

  it("stops reading an oversize reply that does not declare its length", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(400));
        if (pulled > 50) controller.close();
      },
    });
    const { client } = clientFor(() => new Response(stream, { status: 200 }), { maxBytes: 1000 });
    await expect(client.profile("example_user")).rejects.toThrow("too large");
    expect(pulled).toBeLessThan(10);
  });

  it("fails on a status that is not 200", async () => {
    const { client } = clientFor(() => new Response("busy", { status: 429 }));
    await expect(client.profile("example_user")).rejects.toThrow("status 429");
  });

  it("fails when the network fails or the time runs out", async () => {
    const down = createLeetcodeClient({ fetch: (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch, userAgent: "x" });
    await expect(down.profile("example_user")).rejects.toThrow("could not be reached");
    const hang = createLeetcodeClient({
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch,
      userAgent: "x",
      timeoutMs: 20,
    });
    await expect(hang.profile("example_user")).rejects.toThrow("in time");
  });

  it("sends the fixed host, the JSON headers, no redirects, and the name as a variable", async () => {
    const { client, fetchFn } = clientFor(fixture("profile"));
    await client.profile("example_user");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://leetcode.com/graphql");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", Referer: "https://leetcode.com", "User-Agent": "sparmate/test" });
    const body = JSON.parse(init.body as string) as { query: string; variables: { u: string } };
    expect(body.variables).toEqual({ u: "example_user" });
    expect(body.query).not.toContain("example_user");
  });
});

describe("recent", () => {
  it("turns the second-based timestamps into numbers", async () => {
    const { client } = clientFor(fixture("recent"));
    expect(await client.recent("example_user")).toEqual([
      { title: "Two Sum", slug: "two-sum", timestamp: 1762500000 },
      { title: "Merge Intervals", slug: "merge-intervals", timestamp: 1762400000 },
    ]);
  });

  it("accepts an empty or null list", async () => {
    expect(await clientFor('{"data":{"recentAcSubmissionList":[]}}').client.recent("example_user")).toEqual([]);
    expect(await clientFor('{"data":{"recentAcSubmissionList":null}}').client.recent("example_user")).toEqual([]);
  });

  it("rejects a bad slug or timestamp", async () => {
    await expect(clientFor('{"data":{"recentAcSubmissionList":[{"title":"x","titleSlug":"../x","timestamp":"1762500000"}]}}').client.recent("example_user")).rejects.toBeInstanceOf(
      LeetcodeError,
    );
    await expect(clientFor('{"data":{"recentAcSubmissionList":[{"title":"x","titleSlug":"x","timestamp":"soon"}]}}').client.recent("example_user")).rejects.toBeInstanceOf(
      LeetcodeError,
    );
  });
});

describe("problem", () => {
  it("reads the difficulty and the topics", async () => {
    const { client } = clientFor(fixture("question-medium"));
    expect(await client.problem("merge-intervals")).toEqual({
      difficulty: "Medium",
      topics: [
        { name: "Array", slug: "array" },
        { name: "Sorting", slug: "sorting" },
      ],
    });
  });

  it("gives null for a problem LeetCode does not know and rejects a bad difficulty", async () => {
    expect(await clientFor('{"data":{"question":null}}').client.problem("nothing-here")).toBeNull();
    await expect(clientFor('{"data":{"question":{"difficulty":"Brutal","topicTags":[]}}}').client.problem("x")).rejects.toBeInstanceOf(LeetcodeError);
  });
});
