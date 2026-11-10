import { describe, expect, it } from "vitest";
import { sharedCauses } from "./scenarios";

const fail = (name: string, cause?: string) => ({ name, pass: false, detail: "d", ...(cause === undefined ? {} : { cause }) });
const pass = (name: string, cause?: string) => ({ name, pass: true, detail: "d", ...(cause === undefined ? {} : { cause }) });

describe("sharedCauses", () => {
  it("groups failed scenarios that name the same cause, ignoring case, spacing and a closing dot", () => {
    const out = sharedCauses([
      fail("1. Buy a drink", "Stock count never drops."),
      pass("2. Insert coins"),
      fail("3. Sell out", "stock count  never drops"),
      fail("4. Refund", "Change is rounded down"),
      fail("5. Restock", "Stock count never drops"),
    ]);
    expect(out).toEqual([{ cause: "Stock count never drops", names: ["1. Buy a drink", "3. Sell out", "5. Restock"] }]);
  });

  it("ignores a lone cause, a passing scenario's cause and a blank cause", () => {
    expect(sharedCauses([fail("1", "A"), fail("2", "B"), pass("3", "A"), fail("4", " "), fail("5", " ")])).toEqual([]);
  });

  it("reads a card saved before causes existed", () => {
    expect(sharedCauses([fail("1"), fail("2")])).toEqual([]);
  });
});
