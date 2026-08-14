import { describe, expect, it } from "vitest";

import {
  FIRST_KEY,
  OrderKeyError,
  compareOrderKeys,
  keyBetween,
  keyForIndex,
  keysBetween,
  shouldRebalance,
  validateOrderKey,
} from "../ordering";

/**
 * The property that matters is not any particular key's value — it is that
 * byte-wise string order always agrees with list order, no matter how the list
 * was assembled. Most of these tests therefore assert on ordering rather than
 * on literals, and the last block hammers the case that kills the float
 * implementation: thousands of insertions into the same gap.
 */

/** Rebuild a list by inserting `key` at `index`, then assert it stays sorted. */
function isSorted(keys: readonly string[]): boolean {
  for (let i = 1; i < keys.length; i += 1) {
    if (!(keys[i - 1]! < keys[i]!)) return false;
  }
  return true;
}

describe("keyBetween", () => {
  it("gives the first item a stable key", () => {
    expect(keyBetween(null, null)).toBe(FIRST_KEY);
  });

  it("appends above an existing key", () => {
    const first = keyBetween(null, null);
    const second = keyBetween(first, null);
    expect(second > first).toBe(true);
  });

  it("prepends below an existing key", () => {
    const first = keyBetween(null, null);
    const zeroth = keyBetween(null, first);
    expect(zeroth < first).toBe(true);
  });

  it("produces a key strictly between two neighbours", () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const middle = keyBetween(a, b);
    expect(a < middle).toBe(true);
    expect(middle < b).toBe(true);
  });

  it("refuses keys given in the wrong order", () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    expect(() => keyBetween(b, a)).toThrow(OrderKeyError);
  });

  it("refuses two equal keys", () => {
    const a = keyBetween(null, null);
    expect(() => keyBetween(a, a)).toThrow(OrderKeyError);
  });

  it("rejects a malformed key rather than sorting it somewhere surprising", () => {
    expect(() => keyBetween("!!!", null)).toThrow(OrderKeyError);
    expect(() => validateOrderKey("a10")).toThrow(OrderKeyError); // trailing zero
  });
});

describe("ordering across magnitudes", () => {
  it("keeps byte order aligned with list order when the integer part widens", () => {
    // Append far enough that the integer part has to grow a digit (az -> b00).
    let key = keyBetween(null, null);
    const keys = [key];
    for (let i = 0; i < 200; i += 1) {
      key = keyBetween(key, null);
      keys.push(key);
    }
    expect(isSorted(keys)).toBe(true);
    // The widening actually happened — otherwise this test proves nothing.
    expect(keys.some((k) => k.startsWith("b"))).toBe(true);
  });

  it("keeps byte order aligned when prepending past the bottom of a magnitude", () => {
    let key = keyBetween(null, null);
    const keys = [key];
    for (let i = 0; i < 200; i += 1) {
      key = keyBetween(null, key);
      keys.unshift(key);
    }
    expect(isSorted(keys)).toBe(true);
    // Prepending walks into the negative heads (Z, Y, ...).
    expect(keys.some((k) => k.startsWith("Z"))).toBe(true);
  });

  it("sorts negative heads before positive ones", () => {
    const first = keyBetween(null, null);
    const below = keyBetween(null, first);
    const above = keyBetween(first, null);
    expect([above, below, first].sort(compareOrderKeys)).toEqual([
      below,
      first,
      above,
    ]);
  });
});

describe("the case that breaks float ordering", () => {
  it("survives 1000 insertions into the same gap", () => {
    // With `(a + b) / 2` on IEEE-754 doubles this collapses after ~50 rounds:
    // the midpoint stops being strictly between its neighbours and the list
    // silently loses its order. A string key just gets longer.
    let low = keyBetween(null, null);
    const high = keyBetween(low, null);

    for (let i = 0; i < 1000; i += 1) {
      const middle = keyBetween(low, high);
      expect(low < middle).toBe(true);
      expect(middle < high).toBe(true);
      low = middle;
    }
  });

  it("grows keys slowly, not once per insertion", () => {
    let low = keyBetween(null, null);
    const high = keyBetween(low, null);
    for (let i = 0; i < 60; i += 1) low = keyBetween(low, high);
    // Growth is sub-linear, because each new character carries 62 positions
    // before it has to add another: 60 subdivisions of one gap cost about a
    // dozen characters, not sixty. Asserting the loose bound rather than the
    // exact length keeps this a statement about the encoding's efficiency
    // rather than a change-detector for the library's midpoint choices.
    expect(low.length).toBeLessThan(20);
  });
});

describe("keysBetween", () => {
  it("returns nothing for a count of zero", () => {
    expect(keysBetween(null, null, 0)).toEqual([]);
  });

  it("distributes n keys in ascending order with no bounds", () => {
    const keys = keysBetween(null, null, 50);
    expect(keys).toHaveLength(50);
    expect(isSorted(keys)).toBe(true);
  });

  it("distributes n keys inside a bounded gap", () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const keys = keysBetween(a, b, 32);
    expect(keys).toHaveLength(32);
    expect(isSorted(keys)).toBe(true);
    expect(a < keys[0]!).toBe(true);
    expect(keys[keys.length - 1]! < b).toBe(true);
  });

  it("keeps bulk keys much shorter than sequential ones would be", () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);

    const bulk = keysBetween(a, b, 100);

    // The naive loop: always subdivide the leading gap. This is what a caller
    // gets for reaching for keyBetween in a `for`, and it is why keysBetween
    // exists — the chain leans right and grows a character per item.
    let cursor = a;
    const sequential: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      cursor = keyBetween(cursor, b);
      sequential.push(cursor);
    }

    const longestBulk = Math.max(...bulk.map((k) => k.length));
    const longestSequential = Math.max(...sequential.map((k) => k.length));
    expect(longestBulk).toBeLessThan(longestSequential);
  });

  it("prepends a block below an existing key in ascending order", () => {
    const anchor = keyBetween(null, null);
    const keys = keysBetween(null, anchor, 10);
    expect(keys).toHaveLength(10);
    expect(isSorted(keys)).toBe(true);
    expect(keys[keys.length - 1]! < anchor).toBe(true);
  });
});

describe("keyForIndex", () => {
  const list = keysBetween(null, null, 5);

  it("moves an item to the head", () => {
    const key = keyForIndex(list, 0);
    expect(key < list[0]!).toBe(true);
  });

  it("moves an item to the tail", () => {
    const key = keyForIndex(list, list.length);
    expect(key > list[list.length - 1]!).toBe(true);
  });

  it("moves an item into the middle", () => {
    const key = keyForIndex(list, 2);
    expect(list[1]! < key).toBe(true);
    expect(key < list[2]!).toBe(true);
  });

  it("clamps an out-of-range index instead of throwing", () => {
    expect(keyForIndex(list, -5) < list[0]!).toBe(true);
    expect(keyForIndex(list, 99) > list[list.length - 1]!).toBe(true);
  });

  it("returns the first key for an empty list", () => {
    expect(keyForIndex([], 0)).toBe(FIRST_KEY);
  });
});

describe("simulated drag sessions", () => {
  it("keeps a list consistent across many random moves", () => {
    // A deterministic pseudo-random walk: 500 drags of random rows to random
    // positions. After each one the list must still be sorted by key, which is
    // the only invariant the rest of the app relies on.
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const items = keysBetween(null, null, 20).map((key, i) => ({ id: i, key }));

    for (let move = 0; move < 500; move += 1) {
      const from = Math.floor(random() * items.length);
      const to = Math.floor(random() * items.length);
      const [moved] = items.splice(from, 1);
      const remaining = items.map((item) => item.key);
      const key = keyForIndex(remaining, to);
      items.splice(to, 0, { ...moved!, key });

      const sortedByKey = [...items].sort((a, b) => compareOrderKeys(a.key, b.key));
      expect(sortedByKey.map((i) => i.id)).toEqual(items.map((i) => i.id));
    }
  });
});

describe("shouldRebalance", () => {
  it("is quiet for a freshly built list", () => {
    expect(shouldRebalance(keysBetween(null, null, 100))).toBe(false);
  });

  it("is quiet for a list that has been reordered a lot but not pathologically", () => {
    let low = keyBetween(null, null);
    const high = keyBetween(low, null);
    for (let i = 0; i < 60; i += 1) low = keyBetween(low, high);
    expect(shouldRebalance([low])).toBe(false);
  });

  it("flags a scope once any key passes the threshold", () => {
    const short = keyBetween(null, null);
    const long = `a0${"z".repeat(60)}`;
    expect(shouldRebalance([short, long])).toBe(true);
    expect(shouldRebalance([short, long], 100)).toBe(false);
  });
});
