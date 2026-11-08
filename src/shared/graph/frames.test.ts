import { describe, expect, it } from "vitest";
import { arrow, frame, freeText, freedraw, shape } from "./__fixtures__/scene";
import { frameEvidence, pinTargets, pinTargetsText, stepFrames, stepOfElement, withFrameMembership } from "./frames";

const req = frame("f-req", 0, 0, 760, 440, "Requirements", { customData: { step: "requirements" } });
const design = frame("f-design", 0, 500, 1560, 820, "High-level design", { customData: { step: "design" } });

describe("stepFrames", () => {
  it("maps each step to the frame tagged with it and ignores untagged or deleted frames", () => {
    const other = frame("f-other", 3000, 0, 100, 100, "Scratch");
    const gone = frame("f-gone", 0, 0, 10, 10, "Old", { customData: { step: "entities" }, isDeleted: true });
    const map = stepFrames([req, design, other, gone]);
    expect([...map.keys()]).toEqual(["requirements", "design"]);
    expect(map.get("design")?.id).toBe("f-design");
  });
});

describe("withFrameMembership", () => {
  it("puts an element that sits inside a frame into it, and its bound label follows the box", () => {
    const box = shape("rectangle", "cache", 100, 700, 160, 60, "Redis");
    const out = withFrameMembership([design, ...box]);
    expect(out.find((e) => e.id === "cache")?.frameId).toBe("f-design");
    expect(out.find((e) => e.id === "cache-label")?.frameId).toBe("f-design");
  });

  it("keeps a membership Excalidraw already set and leaves outside elements alone", () => {
    const kept = freeText("t1", "note", 100, 100, { frameId: "f-design" });
    const outside = freeText("t2", "outside", 5000, 5000);
    const out = withFrameMembership([req, design, kept, outside]);
    expect(out.find((e) => e.id === "t1")?.frameId).toBe("f-design");
    expect(out.find((e) => e.id === "t2")?.frameId).toBeNull();
  });
});

describe("frameEvidence", () => {
  it("reads only the frame's own boxes and text, by the frame the element sits in", () => {
    const scene = [
      req,
      design,
      freeText("r1", "p99 redirect under 50 ms", 40, 60),
      ...shape("rectangle", "lb", 100, 700, 160, 60, "Load balancer"),
      ...shape("rectangle", "svc", 400, 700, 160, 60, "Redirect service"),
    ];
    const evidence = frameEvidence(scene, "requirements");
    expect(evidence.frameId).toBe("f-req");
    expect(evidence.text).toContain('"p99 redirect under 50 ms"');
    expect(evidence.text).not.toContain("Load balancer");
    const designText = frameEvidence(scene, "design").text;
    expect(designText).toContain("[Load balancer]");
    expect(designText).not.toContain("p99");
  });

  it("keeps an arrow to a box in another frame as joined, so it does not ask for an image", () => {
    const lb = shape("rectangle", "lb", 100, 700, 160, 60, "Load balancer");
    const note = shape("rectangle", "goal", 40, 60, 200, 60, "Redirects first");
    const link = arrow("a1", [260, 730], [240, 90], { from: lb[0], to: note[0] });
    const evidence = frameEvidence([req, design, ...lb, ...note, ...link], "design");
    expect(evidence.text).toContain("[Load balancer] -> [Redirects first]");
    expect(evidence.needsImage).toBe(false);
  });

  it("asks for an image for freehand strokes, a loose arrow or a shape with no label", () => {
    expect(frameEvidence([design, freedraw("fd", 200, 800)], "design")).toMatchObject({ needsImage: true, reasons: ["freehand drawing"] });
    const lb = shape("rectangle", "lb", 100, 700, 160, 60, "Load balancer");
    const loose = arrow("a1", [260, 730], [600, 730], { from: lb[0] });
    expect(frameEvidence([design, ...lb, ...loose], "design").reasons).toContain("an arrow not joined at both ends");
    expect(frameEvidence([design, ...shape("rectangle", "blank", 100, 700, 160, 60)], "design").reasons).toContain("a shape with no label");
  });

  it("reads plain labelled boxes and text without an image", () => {
    const evidence = frameEvidence([req, freeText("r1", "Shorten and redirect", 40, 60), ...shape("rectangle", "b", 300, 60, 160, 60, "Alias")], "requirements");
    expect(evidence.needsImage).toBe(false);
  });

  it("says so when the step has no frame or the frame is empty", () => {
    expect(frameEvidence([req], "design")).toEqual({ frameId: null, text: "", empty: true, needsImage: false, reasons: [] });
    expect(frameEvidence([req], "requirements")).toMatchObject({ text: "Nothing in this frame yet.", empty: true });
  });
});

describe("pinTargets", () => {
  it("lists boxes and arrows with their ids, labels and steps, and nothing else", () => {
    const lb = shape("rectangle", "lb", 100, 700, 160, 60, "Load balancer");
    const db = shape("ellipse", "db", 600, 700, 160, 60, "Postgres");
    const link = arrow("a1", [260, 730], [600, 730], { from: lb[0], to: db[0], label: "SQL" });
    const targets = pinTargets([design, ...lb, ...db, ...link, freeText("t", "a note", 40, 600), freedraw("fd", 900, 900)]);
    expect(targets).toEqual([
      { id: "lb", kind: "box", label: "Load balancer", step: "design" },
      { id: "db", kind: "box", label: "Postgres", step: "design" },
      { id: "a1", kind: "arrow", label: "SQL", step: "design" },
    ]);
    expect(pinTargetsText(targets)).toContain('- lb: box "Load balancer" in step design');
    expect(stepOfElement([design, ...lb], "lb")).toBe("design");
    expect(stepOfElement([design, ...lb], "missing")).toBeNull();
  });
});
