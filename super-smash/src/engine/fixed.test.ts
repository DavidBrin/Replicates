import { describe, expect, it } from "vitest";

import { ONE, fx, isqrt, sqrt } from "./fixed";

/** The integer square root the engine has one of (Plan 5, Task 13c fix round 1). */
describe("isqrt", () => {
  // Up to 94,906,264: its (r + 1)² − 1 is the last square neighbour below 2^53.
  it("is the exact floor of the square root, whole squares and their neighbours alike", () => {
    for (const r of [0, 1, 2, 3, 63, 64, 4095, 4096, 65535, 1_000_003, 46_340, 94_906_264]) {
      expect(isqrt(r * r), `${r}²`).toBe(r);
      if (r > 0) expect(isqrt(r * r - 1), `${r}² − 1`).toBe(r - 1);
      expect(isqrt(r * r + 2 * r), `${r}² + 2${r}`).toBe(r);
    }
  });

  it("is zero for zero and below", () => {
    expect([isqrt(0), isqrt(-5)]).toEqual([0, 0]);
  });

  it("is what `sqrt` takes the Q12 root with", () => {
    for (const v of [fx(2), fx(0.3), fx(144), 1, ONE * 7 + 13]) expect(sqrt(v)).toBe(isqrt(v * ONE));
  });
});
