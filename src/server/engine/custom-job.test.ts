import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeStack, type Stack } from "./__fixtures__/stack";
import { HttpError } from "./sessions";
import { mergeCheckerBrief, validateProblemBody } from "./custom-job";
import type { BriefCheckerOutput, BriefWriterOutput } from "./schemas";

const SAMPLE_HLD_BODY = `## Opening prompt
Let's design a distributed cache system for high throughput and low latency.

## Hidden facts
- Cache hit ratio is expected to be around 95% in production.
- Read traffic is 100x write traffic across all regional endpoints.

## Expected requirements
- Candidates should clarify read-through vs cache-aside pattern.
- Eviction policy should be LRU or LFU with clear rationale.

## Capacity math
- 100 million active keys with 1KB average value size equals 100GB RAM.
- 500,000 requests per second peak require cluster sharding.

## API and entities
- get(key): returns value or null
- set(key, value, ttl): stores value with expiration

## Reference design
The reference architecture places client-side hash rings routing to cache nodes.
Nodes replicate data asynchronously with consistent hashing.

## Accepted alternatives
- Redis cluster vs Memcached with external sentinel.
- Two-tier caching with local in-process cache and remote cluster.

## Deep dives
### Replication and consistency
Replication uses master-replica setup with gossip-based health checks.

## Curveballs
- What if a sudden spike causes cache stampede on expired popular key?
- Mutex locking or probabilistic early expiration mitigates stampede.

## Level bar
- Mid: standard cache-aside with basic LRU eviction.
- Senior: handles cache stampede, hot partitions, and replication lag.

## Traps
- Forgetting to size network bandwidth alongside memory capacity.
- Ignoring replication lag during failover leading to stale reads.
`;

function makeLongBody(base = SAMPLE_HLD_BODY): string {
  const filler = " word".repeat(950);
  return base.replace("## Traps\n", `## Traps\n${filler}\n`);
}

describe("custom problem validation and merge", () => {
  it("validates a complete body with word count >= 900", () => {
    const long = makeLongBody();
    expect(validateProblemBody(long, "hld").valid).toBe(true);
  });

  it("rejects a body with word count < 900", () => {
    expect(validateProblemBody(SAMPLE_HLD_BODY, "hld").valid).toBe(false);
  });

  it("rejects a body missing required sections", () => {
    const missing = makeLongBody().replace("## Traps\n", "## SomethingElse\n");
    expect(validateProblemBody(missing, "hld").valid).toBe(false);
  });

  it("rejects a body with a section under 40 characters", () => {
    const shortSection = makeLongBody().replace(
      "Let's design a distributed cache system for high throughput and low latency.",
      "Short."
    );
    expect(validateProblemBody(shortSection, "hld").valid).toBe(false);
  });

  it("merges verified checker output when valid", () => {
    const firstBody = makeLongBody();
    const corrected = makeLongBody().replace("99.9%", "99.99%");
    const corrections = [
      {
        section: "Expected requirements",
        claim: "99.9% availability",
        fix: "99.99% availability per standard",
        source: "https://example.com/sla",
      },
    ];

    const writerOutput: BriefWriterOutput = {
      meta: {
        title: "Distributed Cache",
        difficulty: "hard",
        tags: ["cache", "hld"],
      },
      body: firstBody,
      sources: [{ title: "SLA Docs", url: "https://example.com/sla" }],
      confidence: "High confidence",
    };

    const checkerOutput: BriefCheckerOutput = {
      body: corrected,
      corrections,
    };

    const result = mergeCheckerBrief(writerOutput, checkerOutput, "hld");

    expect(result.verified).toBe(true);
    expect(result.body).toBe(corrected);
    expect(result.corrections).toEqual(corrections);
  });

  it("falls back to first brief when checker body fails validation", () => {
    const firstBody = makeLongBody();
    const invalidCheckerBody = "Short body that fails validation.";
    const corrections = [
      {
        section: "Expected requirements",
        claim: "bad claim",
        fix: "fix",
        source: "https://example.com/ref",
      },
    ];

    const writerOutput: BriefWriterOutput = {
      meta: {
        title: "Distributed Cache",
        difficulty: "hard",
        tags: ["cache"],
      },
      body: firstBody,
      sources: [{ title: "Ref", url: "https://example.com/ref" }],
      confidence: "Medium",
    };

    const checkerOutput: BriefCheckerOutput = {
      body: invalidCheckerBody,
      corrections,
    };

    const result = mergeCheckerBrief(writerOutput, checkerOutput, "hld");

    expect(result.verified).toBe(false);
    expect(result.body).toBe(firstBody);
    expect(result.corrections).toEqual(corrections);
  });

  it("marks unverified when checker fails", () => {
    const firstBody = makeLongBody();
    const writerOutput: BriefWriterOutput = {
      meta: {
        title: "Distributed Cache",
        difficulty: "hard",
        tags: ["cache"],
      },
      body: firstBody,
      sources: [],
      confidence: "Unverified",
    };

    const result = mergeCheckerBrief(writerOutput, null, "hld");

    expect(result.verified).toBe(false);
    expect(result.body).toBe(firstBody);
    expect(result.corrections).toEqual([]);
  });
});

describe("CustomProblemJobManager state machine", () => {
  let stack: Stack;

  beforeEach(async () => {
    stack = await makeStack();
  });

  afterEach(async () => {
    await stack.cleanup();
  });

  it("runs the full preparation pipeline with fake driver and reports progress", async () => {
    const { jobId } = stack.manager.startCustomProblemJob("Design a distributed key-value store", "hld");
    expect(jobId).toBeDefined();

    let status = stack.manager.getCustomProblemJob(jobId);
    expect(status).not.toBeNull();
    expect(["researching", "writing", "checking", "ready"]).toContain(status?.stage);

    // Wait for completion
    while (status && status.stage !== "ready" && status.stage !== "failed") {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = stack.manager.getCustomProblemJob(jobId);
    }

    expect(status?.stage).toBe("ready");
    expect(status?.problemId).toBeDefined();
    expect(status?.searches).toBeGreaterThanOrEqual(1);
    expect(status?.pages).toBeGreaterThanOrEqual(1);

    // Verify problem was added to catalog
    const added = stack.deps.problems.get(status!.problemId!);
    expect(added).toBeDefined();
    expect(added?.meta.sources?.length).toBeGreaterThanOrEqual(1);
    expect(added?.meta.verified).toBe(true);
  });

  it("prevents multiple concurrent jobs", async () => {
    const { jobId } = stack.manager.startCustomProblemJob("First job", "hld");

    // Starting a second job while the first is running throws 409
    expect(() => stack.manager.startCustomProblemJob("Second job", "hld")).toThrow(HttpError);

    // Wait for first job to complete
    let status = stack.manager.getCustomProblemJob(jobId);
    while (status && status.stage !== "ready" && status.stage !== "failed") {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = stack.manager.getCustomProblemJob(jobId);
    }
    expect(status?.stage).toBe("ready");

    // Now a new job can be started
    const second = stack.manager.startCustomProblemJob("Second job after first completed", "hld");
    expect(second.jobId).toBeDefined();
  });

  it("cancels a running job and aborts driver call", async () => {
    let signalReceived: AbortSignal | undefined;
    let finishPrompt!: () => void;
    const promptPromise = new Promise<void>((resolve) => {
      finishPrompt = resolve;
    });

    const origRunOnce = stack.deps.driver.runOnce.bind(stack.deps.driver);
    vi.spyOn(stack.deps.driver, "runOnce").mockImplementation(async (setup) => {
      if (setup.role === "brief-writer") {
        signalReceived = setup.signal;
        await promptPromise;
      }
      return origRunOnce(setup);
    });

    const { jobId } = stack.manager.startCustomProblemJob("Cancel test", "hld");
    while (!signalReceived) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    stack.manager.cancelCustomProblemJob(jobId);
    expect(stack.manager.getCustomProblemJob(jobId)?.stage).toBe("cancelled");
    expect(signalReceived?.aborted).toBe(true);

    finishPrompt();
    const second = stack.manager.startCustomProblemJob("Second job after cancel", "hld");
    expect(second.jobId).toBeDefined();
  });

  it("times out a job after 8 minutes and marks it failed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let signalReceived: AbortSignal | undefined;
      vi.spyOn(stack.deps.problems, "reload").mockResolvedValue([]);
      vi.spyOn(stack.deps.driver, "runOnce").mockImplementation(async (setup) => {
        signalReceived = setup.signal;
        return new Promise(() => {});
      });

      const { jobId } = stack.manager.startCustomProblemJob("Timeout test", "hld");
      // Flush microtasks
      await Promise.resolve();

      expect(signalReceived).toBeDefined();

      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);

      const job = stack.manager.getCustomProblemJob(jobId);
      expect(job?.stage).toBe("failed");
      expect(job?.error).toBe("Preparation timed out. Try again, or rephrase the prompt.");
      expect(signalReceived?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

