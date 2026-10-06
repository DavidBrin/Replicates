/**
 * PCG32 and the purpose-tagged sub-streams (SPEC §4.4, §4.11; D4).
 *
 * The golden sequences below were produced by an independent 64-bit reference
 * implementation of PCG32's XSH-RR output function, so they pin the two-u32
 * arithmetic in `u64.ts` as well as the generator itself. If one of them moves,
 * every stored replay has moved with it (R92).
 */
import { describe, expect, it } from "vitest";

import { fnv1a64Hex, nextBelow, pcg32, pickOne, rngFor, seedFor, shuffled } from "./prng";
import { addU64, hexU64, mulU32, mulU64, shrU64, xorU64 } from "./u64";

function take(n: number, next: () => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(next());
  return out;
}

describe("u64", () => {
  it("multiplies two u32s into a full 64-bit product", () => {
    expect(mulU32(0, 0)).toEqual([0, 0]);
    expect(mulU32(1, 1)).toEqual([0, 1]);
    expect(mulU32(0xffffffff, 0xffffffff)).toEqual([0xfffffffe, 1]);
    expect(mulU32(0x10000, 0x10000)).toEqual([1, 0]);
    expect(mulU32(0x12345678, 0x9abcdef0)).toEqual([0x0b00ea4e, 0x242d2080]);
  });

  it("adds with carry, modulo 2^64", () => {
    expect(addU64([0, 0xffffffff], [0, 1])).toEqual([1, 0]);
    expect(addU64([0xffffffff, 0xffffffff], [0, 1])).toEqual([0, 0]);
  });

  it("multiplies modulo 2^64", () => {
    expect(mulU64([0, 2], [0, 3])).toEqual([0, 6]);
    expect(mulU64([0, 0x80000000], [0, 2])).toEqual([1, 0]);
    // 0xffffffffffffffff * 0xffffffffffffffff === 1 mod 2^64
    expect(mulU64([0xffffffff, 0xffffffff], [0xffffffff, 0xffffffff])).toEqual([0, 1]);
  });

  it("shifts right across the word boundary", () => {
    expect(shrU64([1, 0], 32)).toEqual([0, 1]);
    expect(shrU64([0xff, 0], 8)).toEqual([0, 0xff000000]);
    expect(shrU64([0, 0xff], 0)).toEqual([0, 0xff]);
    expect(shrU64([0xdeadbeef, 0x12345678], 63)).toEqual([0, 1]);
  });

  it("xors and prints hex", () => {
    expect(xorU64([0xf0f0f0f0, 0x0f0f0f0f], [0x0f0f0f0f, 0xf0f0f0f0])).toEqual([0xffffffff, 0xffffffff]);
    expect(hexU64([0x1, 0x2])).toBe("0000000100000002");
  });
});

describe("pcg32", () => {
  it("reproduces a fixed-seed golden sequence", () => {
    const rng = pcg32(0, 1);
    expect(take(8, rng.nextU32)).toEqual([
      1412771199, 1791099446, 124312908, 1968572995, 1080415314, 2578637408, 2103691749, 1218125110,
    ]);
  });

  it("reproduces a second golden sequence from a full 64-bit seed", () => {
    const rng = pcg32(0x12345678, 0x9abcdef0);
    expect(take(6, rng.nextU32)).toEqual([1129897928, 689246165, 17769723, 3219780061, 2503233616, 1385957503]);
  });

  it("is a pure function of its seed", () => {
    expect(take(20, pcg32(7, 7).nextU32)).toEqual(take(20, pcg32(7, 7).nextU32));
  });

  it("yields u32s, never a float or a negative", () => {
    const rng = pcg32(0xcafebabe, 0xdeadbeef);
    for (let i = 0; i < 500; i++) {
      const v = rng.nextU32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("nextFloat() lands in [0,1)", () => {
    const rng = pcg32(1, 2);
    for (let i = 0; i < 2000; i++) {
      const f = rng.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("nextFloat() is exactly nextU32() / 2**32", () => {
    const a = pcg32(5, 9);
    const b = pcg32(5, 9);
    for (let i = 0; i < 50; i++) expect(a.nextFloat()).toBe(b.nextU32() / 2 ** 32);
  });

  it("exposes its advancing state as two u32s", () => {
    const rng = pcg32(0, 1);
    const before = rng.state;
    expect(before).toHaveLength(2);
    rng.nextU32();
    expect(rng.state).not.toEqual(before);
    for (const word of rng.state) {
      expect(Number.isInteger(word)).toBe(true);
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("does not repeat inside a long run", () => {
    const rng = pcg32(0x9e3779b9, 0x85ebca6b);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(rng.nextU32());
    // 5000 draws from 2^32 values: a handful of birthday collisions at most.
    expect(seen.size).toBeGreaterThan(4990);
  });

  it("spreads nextFloat() roughly evenly over ten buckets", () => {
    const counts = new Array<number>(10).fill(0);
    const rng = pcg32(11, 13);
    for (let i = 0; i < 100_000; i++) {
      const b = Math.floor(rng.nextFloat() * 10);
      counts[b] = (counts[b] as number) + 1;
    }
    for (const c of counts) expect(c).toBeGreaterThan(9000);
  });
});

describe("rngFor", () => {
  it("derives a stable 64-bit seed from seed|purpose|turn", () => {
    expect(seedFor("seed-1", "deal", 0)).toEqual([0x103e2a83, 0xb6074013]);
    expect(seedFor("seed-1", "turnOrder", 0)).toEqual([0x925c6eb8, 0x6f77c503]);
    expect(seedFor("seed-1", "battle", 0)).toEqual([0x888bf929, 0x99c5e300]);
    expect(seedFor("seed-1", "bot:3", 0)).toEqual([0x35fbd4f9, 0x19fab880]);
    expect(seedFor("seed-1", "battle", 7)).toEqual([0xb295fc27, 0xe22d4cf3]);
  });

  it("reproduces golden sequences per purpose", () => {
    expect(take(4, rngFor("seed-1", "deal", 0).nextU32)).toEqual([1879863431, 959442555, 1008440839, 1598081040]);
    expect(take(4, rngFor("seed-1", "turnOrder", 0).nextU32)).toEqual([
      3682326041, 154119970, 2749356472, 1253825330,
    ]);
    expect(take(4, rngFor("seed-1", "battle", 0).nextU32)).toEqual([3613557560, 1449774866, 2542224690, 1815536466]);
    expect(take(4, rngFor("seed-1", "bot:3", 0).nextU32)).toEqual([3565178863, 2572702743, 880664055, 1902974321]);
    expect(take(4, rngFor("seed-1", "battle", 7).nextU32)).toEqual([3150469763, 362073337, 2839402853, 619796476]);
  });

  it("gives independent sub-streams for different purposes at the same turn (D4)", () => {
    const purposes = [
      "deal",
      "turnOrder",
      "cardDeck",
      "battle",
      "modifierPlace",
      "portalMove",
      "personaAssign",
      "personaJitter",
      "bot:0",
      "bot:5",
    ] as const;
    const heads = purposes.map((p) => take(6, rngFor("match-seed", p, 3).nextU32).join(","));
    expect(new Set(heads).size).toBe(purposes.length);
  });

  it("gives independent sub-streams for different turns at the same purpose", () => {
    const heads = [0, 1, 2, 3, 20, 400].map((t) => take(6, rngFor("match-seed", "battle", t).nextU32).join(","));
    expect(new Set(heads).size).toBe(6);
  });

  it("gives independent sub-streams for different seeds", () => {
    const heads = ["a", "b", "aa", "ab", ""].map((s) => take(6, rngFor(s, "deal", 0).nextU32).join(","));
    expect(new Set(heads).size).toBe(5);
  });

  it("is unaffected by how many draws another sub-stream took (D4)", () => {
    const deal = rngFor("s", "deal", 0);
    take(99, deal.nextU32);
    expect(take(4, rngFor("s", "battle", 0).nextU32)).toEqual(take(4, rngFor("s", "battle", 0).nextU32));
  });

  it("handles a template-literal bot purpose built from a seat index (F18)", () => {
    const seat = 4;
    expect(take(3, rngFor("s", `bot:${seat}`, 1).nextU32)).toEqual(take(3, rngFor("s", "bot:4", 1).nextU32));
  });
});

describe("draw helpers", () => {
  it("nextBelow stays in range and costs one draw", () => {
    const rng = pcg32(3, 4);
    const before = rng.state;
    expect(nextBelow(rng, 5)).toBeLessThan(5);
    expect(rng.state).not.toEqual(before);
    for (let i = 0; i < 1000; i++) {
      const v = nextBelow(rng, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it("nextBelow draws nothing for a bound of 1 or less", () => {
    const rng = pcg32(3, 4);
    const before = rng.state;
    expect(nextBelow(rng, 1)).toBe(0);
    expect(nextBelow(rng, 0)).toBe(0);
    expect(nextBelow(rng, -3)).toBe(0);
    expect(rng.state).toEqual(before);
  });

  it("nextBelow covers every value of a small range", () => {
    const rng = pcg32(17, 19);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) seen.add(nextBelow(rng, 6));
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("pickOne returns null for an empty list and draws nothing", () => {
    const rng = pcg32(1, 1);
    const before = rng.state;
    expect(pickOne(rng, [])).toBeNull();
    expect(rng.state).toEqual(before);
  });

  it("pickOne returns the only element of a singleton without drawing", () => {
    const rng = pcg32(1, 1);
    const before = rng.state;
    expect(pickOne(rng, ["x"])).toBe("x");
    expect(rng.state).toEqual(before);
  });

  it("shuffled permutes without mutating, in length-1 draws", () => {
    const input = [0, 1, 2, 3, 4, 5, 6, 7];
    const rng = pcg32(2, 3);
    const before = rng.state;
    const out = shuffled(rng, input);
    expect(input).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(rng.state).not.toEqual(before);
    // 7 draws for 8 elements.
    const counter = pcg32(2, 3);
    take(7, counter.nextU32);
    expect(rng.state).toEqual(counter.state);
  });

  it("shuffled draws nothing for zero or one element", () => {
    const rng = pcg32(2, 3);
    const before = rng.state;
    expect(shuffled(rng, [])).toEqual([]);
    expect(shuffled(rng, ["a"])).toEqual(["a"]);
    expect(rng.state).toEqual(before);
  });

  it("shuffled is a pure function of the rng state", () => {
    expect(shuffled(pcg32(9, 9), [1, 2, 3, 4, 5])).toEqual(shuffled(pcg32(9, 9), [1, 2, 3, 4, 5]));
  });
});

describe("fnv1a64Hex", () => {
  it("matches a 64-bit reference digest", () => {
    expect(fnv1a64Hex("")).toBe("cbf29ce484222325");
    expect(fnv1a64Hex("abc")).toBe("cec64e155111225d");
    expect(fnv1a64Hex("{}")).toBe("ed4d025ad0e8af6b");
  });

  it("always returns 16 lower-case hex characters", () => {
    for (const s of ["", "a", "a longer string with spaces", '{"a":1}']) {
      expect(fnv1a64Hex(s)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("separates near-identical inputs", () => {
    const digests = ["a", "b", "ab", "ba", "aa"].map(fnv1a64Hex);
    expect(new Set(digests).size).toBe(5);
  });
});
