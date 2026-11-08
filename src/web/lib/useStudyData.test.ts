import { describe, expect, it } from "vitest";
import { ApiError } from "../backend";
import { endedElsewhere, startKey } from "./useStudyData";

describe("endedElsewhere", () => {
  it("is true only for a 409 from the server", () => {
    expect(endedElsewhere(new ApiError(409, "The round has already ended."))).toBe(true);
    expect(endedElsewhere(new ApiError(404, "Not found"))).toBe(false);
    expect(endedElsewhere(new ApiError(500, "The server hit an error."))).toBe(false);
    expect(endedElsewhere(new Error("x"))).toBe(false);
  });
});

describe("startKey", () => {
  it("names a gap round apart from the modes", () => {
    expect(startKey("p", "guided")).toBe("p:guided");
    expect(startKey("p", "guided", { title: "t", goodLooksLike: "g" })).toBe("p:gap");
  });
});
