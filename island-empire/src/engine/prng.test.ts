import { describe, expect, it } from "vitest";
import { chance, deriveSeed, next, nextInt, nextIntRange, pick, shuffle } from "./prng";

describe("prng (mulberry32)", () => {
  it("is deterministic and advances the seed", () => {
    const a = next(42);
    const b = next(42);
    expect(a).toEqual(b);
    expect(a.seed).not.toBe(42);
    expect(next(a.seed).value).not.toBe(a.value);
  });

  it("yields values in [0, 1) and integers in range", () => {
    let seed = 7;
    for (let i = 0; i < 2000; i++) {
      const r = next(seed);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(1);
      const n = nextIntRange(seed, 3, 9);
      expect(n.value).toBeGreaterThanOrEqual(3);
      expect(n.value).toBeLessThan(9);
      seed = r.seed;
    }
    expect(nextInt(1, 0)).toEqual({ value: 0, seed: 1 });
  });

  it("shuffles into a permutation without touching the input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const { value } = shuffle(3, input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...value].sort((a, b) => a - b)).toEqual(input);
    expect(shuffle(3, input).value).toEqual(value);
    expect(pick(5, []).value).toBeUndefined();
    expect([true, false]).toContain(chance(1, 0.5).value);
    expect(chance(1, 1).value).toBe(true);
    expect(chance(1, 0).value).toBe(false);
  });

  it("derives distinct streams per salt and normalises odd seeds", () => {
    expect(deriveSeed(1, 0)).not.toBe(deriveSeed(1, 1));
    expect(next(-1).seed).toBe(next(0xffffffff).seed);
    expect(next(Number.NaN)).toEqual(next(0));
  });
});
