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

describe("joined and look-alike forms", () => {
  let multi: Awaited<ReturnType<typeof loadPrivacyGuard>>;
  let single: Awaited<ReturnType<typeof loadPrivacyGuard>>;
  beforeAll(async () => {
    multi = await loadPrivacyGuard({ claudeJsonPath: missing(), denylistPath: await denylist(["zorblax corp"], "multi.txt") });
    single = await loadPrivacyGuard({ claudeJsonPath: missing(), denylistPath: await denylist(["zorblax"], "single.txt") });
  });

  it.each([
    "zorblax-corp",
    "zorblax_corp",
    "zorblax.corp",
    "zorblax/corp",
    "ZorblaxCorp",
    "zorblax | corp",
    "zorblax \\| corp",
    "zorblax  \n  corp",
    "zorblax​corp",
    "zorblax​ corp",
    "zorblax–corp",
    "ｚｏｒｂｌａｘ ｃｏｒｐ",
  ])("finds the two-word term in %j", (text) => {
    expect(multi.findViolations(`we met ${text} today`)).toEqual(["zorblax corp"]);
  });

  it.each(["zor​blax", "zor­blax", "zor⁠blax", "zor﻿blax", "ｚｏｒｂｌａｘ", "ZORBLAX", "zоrblаx", "zorblax́", "ZorblaxService"])("finds the one-word term in %j", (text) => {
    expect(single.findViolations(`we met ${text} today`)).toEqual(["zorblax"]);
  });

  it("redacts a joined form as one unit and keeps the text around it", () => {
    expect(multi.redact("a zorblax-corp b")).toBe("a [redacted] b");
    expect(multi.redact("a Zorblax​ Corp b")).toBe("a [redacted] b");
    expect(single.redact("a zоrblax b")).toBe("a [redacted] b");
  });

  it("does not match inside longer words or unrelated text", () => {
    expect(single.findViolations("zorblaxes and unzorblax")).toEqual([]);
    expect(multi.findViolations("zorblax and corporate")).toEqual([]);
    expect(multi.findViolations("corp zorblax")).toEqual([]);
  });

  it("still needs word boundaries for a short common word", async () => {
    const guard = await loadPrivacyGuard({ claudeJsonPath: missing(), denylistPath: await denylist(["box"], "short.txt") });
    expect(guard.findViolations("a sandbox in a boxed set")).toEqual([]);
    expect(guard.findViolations("a box here")).toEqual(["box"]);
  });

  it("scans a very long text quickly and still finds a term near the end", () => {
    const filler = "- ".repeat(300_000);
    const started = Date.now();
    expect(single.findViolations(`${filler}zorblax`)).toEqual(["zorblax"]);
    expect(single.findViolations(`${"zorblax ".repeat(1) + " ".repeat(500_000)}x`)).toEqual(["zorblax"]);
    expect(multi.redact(`${filler}zorblax${" ".repeat(100_000)}corp`)).toBe(`${filler}[redacted]`);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("finds a term that straddles the edge between scan windows", () => {
    const text = `${"a ".repeat(99_999)}zorblax ${"b ".repeat(10)}`;
    for (let pad = 0; pad < 4; pad++) expect(single.findViolations(`${"x".repeat(pad)} ${text}`)).toEqual(["zorblax"]);
  });
});

describe("terms from the account domain", () => {
  it.each([
    ["dev@mail.quuxly.io", "we use quuxly daily", ["quuxly"]],
    ["dev@corp.quuxly.com", "we use quuxly daily", ["quuxly"]],
    ["dev@in.quuxly.co.in", "we use quuxly daily", ["quuxly"]],
    ["dev@quuxly.co.uk", "we use quuxly daily", ["quuxly"]],
    ["dev@mail.quuxly.io", "send mail to the in box in the corp", []],
  ])("derives the registrable name from %s", async (email, text, expected) => {
    const guard = await loadPrivacyGuard({ claudeJsonPath: await account(email), denylistPath: missing() });
    expect(guard.findViolations(text)).toEqual(expected);
  });

  it("blocks no public suffix part and keeps skipping mail providers", async () => {
    const guard = await loadPrivacyGuard({ claudeJsonPath: await account("pat.kim@mail.gmail.com"), denylistPath: missing() });
    expect(guard.findViolations("the com and co and io domains, gmail and mail")).toEqual([]);
    const plain = await loadPrivacyGuard({ claudeJsonPath: await account("pat.kim@quuxly.co.in"), denylistPath: missing() });
    expect(plain.findViolations("the com and co and in and io domains")).toEqual([]);
  });
});
