import { describe, expect, it } from "vitest";
import { ClientMsgSchema } from "./protocol";

describe("guided client messages", () => {
  it("accepts the three guided requests with no fields", () => {
    for (const type of ["guided.feedback", "guided.hint", "guided.stuck"]) expect(ClientMsgSchema.safeParse({ type }).success).toBe(true);
  });

  it("rejects extra fields on guided.stuck", () => {
    expect(ClientMsgSchema.safeParse({ type: "guided.stuck", phase: "api" }).success).toBe(false);
  });
});
