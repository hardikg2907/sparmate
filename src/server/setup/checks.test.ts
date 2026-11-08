import { describe, expect, it, vi } from "vitest";
import { findBundledClaude, runSetupChecks, SetupStatus, type SetupCheck, type SetupDeps, type SpawnOutcome } from "./checks";

const CLAUDE = "/app/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude";

function makeDeps(overrides: Partial<SetupDeps> & { auth?: SpawnOutcome; compiler?: SpawnOutcome } = {}): SetupDeps {
  const { auth, compiler, ...rest } = overrides;
  return {
    spawn: async (command) => {
      if (command === CLAUDE) return auth ?? { finished: true, exitCode: 0, stdout: JSON.stringify({ loggedIn: true }) };
      return compiler ?? { finished: true, exitCode: 0, stdout: "clang version 17" };
    },
    exists: () => true,
    resolveModule: (specifier) => `/app/node_modules/${specifier}`,
    platform: "darwin",
    arch: "arm64",
    preferMusl: false,
    ...rest,
  };
}

const options = { kokoroHome: "/k", appRoot: "/app", fakeAgent: false, inContainer: false };
const byId = (checks: SetupCheck[], id: SetupCheck["id"]) => checks.find((check) => check.id === id)!;

describe("findBundledClaude", () => {
  it("looks for the platform package of this machine", () => {
    expect(findBundledClaude(makeDeps())).toBe(CLAUDE);
  });

  it("tries the glibc build first on Linux, then the musl one", () => {
    const tried: string[] = [];
    const deps = makeDeps({
      platform: "linux",
      arch: "x64",
      resolveModule: (specifier) => {
        tried.push(specifier);
        return `/app/node_modules/${specifier}`;
      },
      exists: (path) => path.includes("-musl/"),
    });
    expect(findBundledClaude(deps)).toBe("/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude");
    expect(tried).toEqual(["@anthropic-ai/claude-agent-sdk-linux-x64/claude", "@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude"]);
  });

  it("tries musl first when the system uses it", () => {
    const tried: string[] = [];
    findBundledClaude(
      makeDeps({
        platform: "linux",
        arch: "arm64",
        preferMusl: true,
        exists: () => false,
        resolveModule: (specifier) => {
          tried.push(specifier);
          return specifier;
        },
      }),
    );
    expect(tried[0]).toBe("@anthropic-ai/claude-agent-sdk-linux-arm64-musl/claude");
  });

  it("returns null when the package is not installed", () => {
    const deps = makeDeps({
      resolveModule: () => {
        throw new Error("Cannot find module");
      },
    });
    expect(findBundledClaude(deps)).toBeNull();
  });
});

describe("runSetupChecks", () => {
  it("passes when everything is present", async () => {
    const checks = await runSetupChecks(options, makeDeps());
    expect(checks.map((c) => [c.id, c.ok])).toEqual([
      ["compiler", true],
      ["claude-login", true],
      ["kokoro", true],
    ]);
  });

  it("fails the compiler check with the Xcode fix when the compiler cannot start", async () => {
    const checks = await runSetupChecks(options, makeDeps({ compiler: { finished: false, exitCode: null, stdout: "" } }));
    expect(byId(checks, "compiler")).toMatchObject({ ok: false, optional: false, fix: "xcode-select --install" });
  });

  it("never runs the macOS compiler stub when the Command Line Tools are missing", async () => {
    const ran: string[] = [];
    const deps = makeDeps();
    const spawn = deps.spawn;
    deps.spawn = async (command, args, timeoutMs) => {
      ran.push(command);
      if (command === "/usr/bin/xcode-select") return { finished: true, exitCode: 2, stdout: "" };
      return spawn(command, args, timeoutMs);
    };
    const checks = await runSetupChecks(options, deps);
    expect(byId(checks, "compiler")).toMatchObject({ ok: false, fix: "xcode-select --install" });
    expect(ran).toContain("/usr/bin/xcode-select");
    expect(ran).not.toContain("/usr/bin/clang++");
  });

  it("asks only the compiler itself on Linux", async () => {
    const ran: string[] = [];
    const deps = makeDeps({ platform: "linux", arch: "x64" });
    const spawn = deps.spawn;
    deps.spawn = async (command, args, timeoutMs) => {
      ran.push(command);
      return spawn(command, args, timeoutMs);
    };
    const checks = await runSetupChecks(options, deps);
    expect(byId(checks, "compiler").ok).toBe(true);
    expect(ran).not.toContain("/usr/bin/xcode-select");
  });

  it("reports a signed-out user with the setup command", async () => {
    const checks = await runSetupChecks(options, makeDeps({ auth: { finished: true, exitCode: 1, stdout: JSON.stringify({ loggedIn: false }) } }));
    expect(byId(checks, "claude-login")).toMatchObject({ ok: false, optional: false, fix: "npm run setup" });
  });

  it("keeps nothing but the sign-in flag from the status output", async () => {
    const stdout = JSON.stringify({ loggedIn: true, email: "someone@example.test", orgId: "org-secret", orgName: "Secret Org" });
    const checks = await runSetupChecks(options, makeDeps({ auth: { finished: true, exitCode: 0, stdout } }));
    const text = JSON.stringify(checks);
    expect(byId(checks, "claude-login").ok).toBe(true);
    for (const leaked of ["someone@example.test", "org-secret", "Secret Org"]) expect(text).not.toContain(leaked);
  });

  it("treats unreadable status output as not signed in", async () => {
    const checks = await runSetupChecks(options, makeDeps({ auth: { finished: true, exitCode: 0, stdout: "not json" } }));
    expect(byId(checks, "claude-login").ok).toBe(false);
  });

  it("says the Claude program is missing when it is not installed", async () => {
    const checks = await runSetupChecks(options, makeDeps({ exists: () => false }));
    expect(byId(checks, "claude-login")).toMatchObject({ ok: false, fix: "npm run setup" });
    expect(byId(checks, "claude-login").detail).toMatch(/not installed/);
  });

  it("needs no sign-in with the fake agent", async () => {
    const spawn = vi.fn(async (_command: string, _args: readonly string[], _timeoutMs: number) => ({ finished: true, exitCode: 1, stdout: "" }));
    const checks = await runSetupChecks({ ...options, fakeAgent: true }, makeDeps({ spawn }));
    expect(byId(checks, "claude-login").ok).toBe(true);
    expect(spawn.mock.calls.some(([command]) => command === CLAUDE)).toBe(false);
  });

  it("marks Kokoro optional and fails it when a file is missing", async () => {
    const checks = await runSetupChecks(options, makeDeps({ exists: (path) => !path.endsWith("voices-v1.0.bin") }));
    expect(byId(checks, "kokoro")).toMatchObject({ ok: false, optional: true, fix: "npm run setup" });
  });

  it("points the fixes at the container scripts inside the container", async () => {
    const checks = await runSetupChecks(
      { ...options, inContainer: true },
      makeDeps({
        compiler: { finished: false, exitCode: null, stdout: "" },
        auth: { finished: true, exitCode: 1, stdout: JSON.stringify({ loggedIn: false }) },
        exists: (p) => p === CLAUDE,
      }),
    );
    for (const check of checks) expect(check.fix).toContain("container/setup");
  });

  it("never throws when a check breaks", async () => {
    const deps = makeDeps({
      spawn: async () => {
        throw new Error("boom");
      },
    });
    const checks = await runSetupChecks(options, deps);
    expect(byId(checks, "compiler").ok).toBe(false);
    expect(byId(checks, "claude-login").ok).toBe(false);
    expect(checks).toHaveLength(3);
  });
});

describe("SetupStatus", () => {
  const bad: SetupCheck[] = [{ id: "compiler", ok: false, optional: false, title: "t", detail: "d", fix: "f" }];
  const good: SetupCheck[] = [{ id: "compiler", ok: true, optional: false, title: "t", detail: "d" }];

  it("runs once at start and serves the cached result", async () => {
    const run = vi.fn(async () => good);
    const status = new SetupStatus(run, 15_000, () => 0);
    status.start();
    expect(await status.get()).toBe(good);
    expect(await status.get()).toBe(good);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("re-runs a failed result once it is older than the limit", async () => {
    let now = 0;
    const run = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(good);
    const status = new SetupStatus(run, 15_000, () => now);
    status.start();
    expect(await status.get()).toBe(bad);
    now = 5_000;
    expect(await status.get()).toBe(bad);
    now = 16_000;
    expect(await status.get()).toBe(good);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not re-run when only an optional check failed", async () => {
    let now = 0;
    const voiceMissing: SetupCheck[] = [...good, { id: "kokoro", ok: false, optional: true, title: "t", detail: "d", fix: "f" }];
    const run = vi.fn(async () => voiceMissing);
    const status = new SetupStatus(run, 15_000, () => now);
    status.start();
    await status.get();
    now = 10 * 60_000;
    expect(await status.get()).toBe(voiceMissing);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not re-run a passing result however old it is", async () => {
    let now = 0;
    const run = vi.fn(async () => good);
    const status = new SetupStatus(run, 15_000, () => now);
    status.start();
    await status.get();
    now = 10 * 60_000;
    await status.get();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("answers with an empty list when the run itself fails", async () => {
    const status = new SetupStatus(async () => {
      throw new Error("boom");
    });
    status.start();
    expect(await status.get()).toEqual([]);
  });
});
