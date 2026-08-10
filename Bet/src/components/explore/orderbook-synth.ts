/**
 * Synthesizes a plausible-looking, clearly-labeled-illustrative order-book
 * depth ladder for the Explore detail page (SPEC §3.6: "a display-only
 * order-book depth table (synthesize plausible bids/asks around the current
 * price...)"). There is no real CLOB behind Explore markets — this exists
 * purely so the detail page reads as a Kalshi/Polymarket market page
 * (§3.4/§3.4 of the research docs both describe a bid/ask depth ladder as a
 * first-class element) without inventing a matching-engine.
 *
 * Deterministic, not random: this renders inside a Server Component, so a
 * `Math.random()` call here would produce a different ladder on every
 * request (and diverge between the server-rendered HTML and any client
 * re-render), not a subtle bug so much as a guaranteed hydration mismatch
 * the moment this ever needs a client boundary. A tiny string-seeded PRNG
 * (mulberry32 — same algorithm `seed-data/prng.ts` uses for the seed
 * dataset, reimplemented locally rather than imported: `src/adapters/**` is
 * off-limits to `src/components/**`, G1) keyed on the market id makes the
 * ladder stable per-market and stable across renders.
 */

function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DepthLevel {
  /** 0..1 probability-style price, matching this app's convention. */
  price: number;
  /** Synthetic resting size, in shares — illustrative only. */
  size: number;
}

export interface SyntheticOrderBook {
  bids: DepthLevel[];
  asks: DepthLevel[];
}

/** `levels` price steps on each side of `midPrice`, spaced roughly 1% apart
 * and clamped to `[0.01, 0.99]` (Kalshi's 1¢-99¢ contract range), with size
 * that grows the further a level sits from the touch — thin near the mid,
 * deep further out, the standard shape of a real book. */
export function synthesizeOrderBook(
  seedKey: string,
  midPrice: number,
  levels = 6,
): SyntheticOrderBook {
  const rng = mulberry32(hashSeed(seedKey));
  const clampedMid = Math.min(0.99, Math.max(0.01, midPrice));

  function side(direction: -1 | 1): DepthLevel[] {
    const out: DepthLevel[] = [];
    for (let i = 1; i <= levels; i++) {
      const step = i * 0.01 * (0.7 + rng() * 0.6);
      const price = Math.min(0.99, Math.max(0.01, clampedMid + direction * step));
      const base = 200 + i * 350;
      const size = Math.round(base * (0.5 + rng()));
      out.push({ price: Math.round(price * 1000) / 1000, size });
    }
    return out;
  }

  return {
    bids: side(-1),
    asks: side(1),
  };
}
