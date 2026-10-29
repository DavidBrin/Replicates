import { describe, expect, it } from "vitest";

import { MAX_DRAW_CALLS, MAX_TRIANGLES_PER_FRAME } from "./budget";

describe("the frame budget", () => {
  // The R§4 numbers (spec: under 100 draw calls and 500k triangles at 1080p with four fighters). Every budget
  // test in the unit suite and in `e2e/render3d.spec.ts` compares against these constants, so raising one would
  // pass them all with no signal: a change here is a decision, made in this file.
  it("is 100 draw calls and 500,000 triangles", () => {
    expect(MAX_DRAW_CALLS).toBe(100);
    expect(MAX_TRIANGLES_PER_FRAME).toBe(500_000);
  });
});
