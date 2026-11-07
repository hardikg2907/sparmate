import { describe, expect, it } from "vitest";
import { ScorecardSchema, ScribeOutputSchema } from "../../shared/types";
import { BriefCheckerOutputSchema, BriefWriterOutputSchema, TesterOutputSchema, toApiSchema, toCompatSchema } from "./schemas";
import { ProblemSourceSchema } from "../../shared/problem";

function keys(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => keys(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      out.add(k);
      keys(v, out);
    }
  }
  return out;
}

describe("structured output schemas", () => {
  it("drops the $schema key and keeps strict objects", () => {
    for (const s of [ScorecardSchema, ScribeOutputSchema, TesterOutputSchema, BriefWriterOutputSchema, BriefCheckerOutputSchema]) {
      const json = toApiSchema(s);
      expect(json.$schema).toBeUndefined();
      expect(json.type).toBe("object");
      expect(json.additionalProperties).toBe(false);
    }
  });

  it("keeps the scribe union as oneOf in the strict form", () => {
    expect(keys(toApiSchema(ScribeOutputSchema)).has("oneOf")).toBe(true);
  });

  it("removes oneOf, const and limits in the compat form", () => {
    const k = keys(toCompatSchema(ScribeOutputSchema));
    for (const gone of ["oneOf", "const", "minLength", "maxLength", "pattern"]) expect(k.has(gone), gone).toBe(false);
    expect(k.has("anyOf")).toBe(true);
    expect(keys(toCompatSchema(ScorecardSchema)).has("minimum")).toBe(false);
  });

  it("enforces https and length caps on problem sources", () => {
    expect(ProblemSourceSchema.safeParse({ title: "Architecture", url: "https://example.com/arch" }).success).toBe(true);
    expect(ProblemSourceSchema.safeParse({ title: "Architecture", url: "http://example.com/arch" }).success).toBe(false);
    expect(ProblemSourceSchema.safeParse({ title: "Architecture", url: "javascript:alert(1)" }).success).toBe(false);
    expect(ProblemSourceSchema.safeParse({ title: "a".repeat(201), url: "https://example.com" }).success).toBe(false);
    expect(ProblemSourceSchema.safeParse({ title: "Architecture", url: "https://" + "a".repeat(1025) }).success).toBe(false);
  });
});
