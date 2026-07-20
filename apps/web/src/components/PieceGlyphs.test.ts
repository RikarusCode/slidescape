import { describe, expect, it } from "vitest";
import { nearestFacingRotation } from "./PieceGlyphs.js";

describe("walrus facing animation", () => {
  it("uses the shortest turn instead of rotating through the opposite direction", () => {
    expect(nearestFacingRotation(180, "left")).toBe(270);
    expect(nearestFacingRotation(-90, "down")).toBe(-180);
    expect(nearestFacingRotation(270, "left")).toBe(270);
  });
});
