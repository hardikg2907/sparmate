import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPrivacyGuard } from "./privacy";

let dir: string;
const missing = () => join(dir, "does-not-exist");

async function account(email: string | null, name = "claude.json"): Promise<string> {
  const path = join(dir, name);
  const body = email === null ? { projects: {} } : { oauthAccount: { emailAddress: email, displayName: "Someone" }, projects: {} };
  await writeFile(path, JSON.stringify(body));
  return path;
}

async function denylist(lines: string[], name = "denylist.txt"): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, lines.join("\n"));
  return path;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ir-privacy-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("terms from the account file", () => {
  it("builds the address, the part before the @ and the first domain label", async () => {
    const guard = await loadPrivacyGuard({ claudeJsonPath: await account("a.b@company.co.in"), denylistPath: missing() });
    expect(guard.size()).toBe(3);
    expect(guard.findViolations("write to a.b@company.co.in now").sort()).toEqual(["a.b", "a.b@company.co.in", "company"].sort());
    expect(guard.findViolations("the company ships it")).toEqual(["company"]);
    expect(guard.findViolations("ask a.b about it")).toEqual(["a.b"]);
  });

  it("skips a common mail provider as the domain label but keeps the other two terms", async () => {
    const guard = await loadPrivacyGuard({ claudeJsonPath: await account("jordan.lee@gmail.com"), denylistPath: missing() });
    expect(guard.size()).toBe(2);
    expect(guard.findViolations("I use gmail for mail")).toEqual([]);
    expect(guard.findViolations("jordan.lee")).toEqual(["jordan.lee"]);
  });

  it("skips a domain label shorter than three characters", async () => {
    const guard = await loadPrivacyGuard({ claudeJsonPath: await account("jordan@ab.io"), denylistPath: missing() });
    expect(guard.size()).toBe(2);
    expect(guard.findViolations("the ab team")).toEqual([]);
  });

  it("does not add a local part shorter than three characters", async () => {
    const guard = await loadPrivacyGuard({ claudeJsonPath: await account("jd@example-corp.com"), denylistPath: missing() });
    expect(guard.findViolations("jd said hello")).toEqual([]);
    expect(guard.findViolations("example-corp")).toEqual(["example-corp"]);
  });

  it("works with no account email, no account file and an account file without oauthAccount", async () => {
    const noEmail = await loadPrivacyGuard({ claudeJsonPath: await account(null), denylistPath: missing() });
    expect(noEmail.size()).toBe(0);
    const noFile = await loadPrivacyGuard({ claudeJsonPath: missing(), denylistPath: missing() });
    expect(noFile.size()).toBe(0);
    expect(noFile.findViolations("anything at all")).toEqual([]);
    expect(noFile.redact("anything at all")).toBe("anything at all");
  });

  it("fails loudly when the account file is not valid JSON", async () => {
    const path = join(dir, "broken.json");
    await writeFile(path, "{ not json");
    await expect(loadPrivacyGuard({ claudeJsonPath: path, denylistPath: missing() })).rejects.toThrow(/cannot parse/);
  });
});

describe("terms from the deny-list file", () => {
  it("reads one term per line and ignores comments and blank lines", async () => {
    const path = await denylist(["# a comment", "", "  Acme Corp  ", "widget-core # trailing comment", "c#", "   "]);
    const guard = await loadPrivacyGuard({ claudeJsonPath: missing(), denylistPath: path });
    expect(guard.size()).toBe(3);
    expect(guard.findViolations("ACME   corp builds Widget-Core in C#")).toEqual(["acme corp", "widget-core", "c#"]);
    expect(guard.findViolations("a comment")).toEqual([]);
  });

  it("merges account terms and deny-list terms without duplicates", async () => {
    const path = await denylist(["company", "extra"]);
    const guard = await loadPrivacyGuard({ claudeJsonPath: await account("a.b@company.co.in"), denylistPath: path });
    expect(guard.size()).toBe(4);
  });
});

describe("matching", () => {
  let guard: Awaited<ReturnType<typeof loadPrivacyGuard>>;
  beforeAll(async () => {
    guard = await loadPrivacyGuard({ claudeJsonPath: missing(), denylistPath: await denylist(["acme", "orbit.io"]) });
  });

  it("is case-insensitive", () => {
    expect(guard.findViolations("ACME and Acme and acme")).toEqual(["acme"]);
  });

  it("respects word boundaries", () => {
    expect(guard.findViolations("acmeology")).toEqual([]);
    expect(guard.findViolations("macme")).toEqual([]);
    expect(guard.findViolations("acme2")).toEqual([]);
    expect(guard.findViolations("(acme)")).toEqual(["acme"]);
    expect(guard.findViolations("acme's roadmap")).toEqual(["acme"]);
  });

  it("treats snake_case, kebab-case and camelCase parts as separate words", () => {
    expect(guard.findViolations("acme_service")).toEqual(["acme"]);
    expect(guard.findViolations("acme-core")).toEqual(["acme"]);
    expect(guard.findViolations("AcmeService")).toEqual(["acme"]);
    expect(guard.findViolations("ACMEService")).toEqual(["acme"]);
    expect(guard.findViolations("myAcme")).toEqual(["acme"]);
    expect(guard.findViolations("ACMESERVICE")).toEqual([]);
  });

  it("matches terms that contain punctuation", () => {
    expect(guard.findViolations("see https://orbit.io/docs")).toEqual(["orbit.io"]);
    expect(guard.findViolations("orbitxio")).toEqual([]);
  });

  it("finds a term on every line of a long text", () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i} mentions acme`).join("\n");
    expect(guard.findViolations(text)).toEqual(["acme"]);
  });

  it("returns an empty list for clean text and for the empty string", () => {
    expect(guard.findViolations("nothing to see here")).toEqual([]);
    expect(guard.findViolations("")).toEqual([]);
  });
});

describe("redact", () => {
  it("replaces every match and leaves the rest alone", async () => {
    const guard = await loadPrivacyGuard({ claudeJsonPath: missing(), denylistPath: await denylist(["acme", "orbit.io"]) });
    expect(guard.redact("Acme runs orbit.io; acmeology is fine; ACME again")).toBe("[redacted] runs [redacted]; acmeology is fine; [redacted] again");
  });

  it("redacts a full address as a single unit", async () => {
    const guard = await loadPrivacyGuard({ claudeJsonPath: await account("a.b@company.co.in"), denylistPath: missing() });
    expect(guard.redact("mail a.b@company.co.in today")).toBe("mail [redacted] today");
    expect(guard.redact("the company, a.b says")).toBe("the [redacted], [redacted] says");
  });

  it("returns the same text when nothing matches", async () => {
    const guard = await loadPrivacyGuard({ claudeJsonPath: missing(), denylistPath: await denylist(["acme"]) });
    expect(guard.redact("clean text")).toBe("clean text");
  });
});
