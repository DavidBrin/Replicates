// @vitest-environment node

import { describe, expect, it } from "vitest";

import { clientKeyFor, createRateLimiter } from "./rate-limit";

function fixedWindowLimiter(limit: number, windowMs: number) {
  let now = 1_000_000;
  const limiter = createRateLimiter({ limit, windowMs, now: () => now });
  return {
    limiter,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("allows up to the limit and then refuses", () => {
    const { limiter } = fixedWindowLimiter(3, 60_000);

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("reports a positive retry-after once refusing", () => {
    const { limiter } = fixedWindowLimiter(1, 60_000);
    limiter.check("a");

    const decision = limiter.check("a");

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("keys are independent", () => {
    const { limiter } = fixedWindowLimiter(1, 60_000);
    limiter.check("a");

    expect(limiter.check("b").allowed).toBe(true);
  });

  it("opens a fresh window once the old one lapses", () => {
    const { limiter, advance } = fixedWindowLimiter(1, 60_000);
    limiter.check("a");
    expect(limiter.check("a").allowed).toBe(false);

    advance(60_001);

    expect(limiter.check("a").allowed).toBe(true);
  });

  it("reset() drops all state, which is what makes route tests independent", () => {
    const { limiter } = fixedWindowLimiter(1, 60_000);
    limiter.check("a");

    limiter.reset();

    expect(limiter.check("a").allowed).toBe(true);
  });
});

describe("clientKeyFor", () => {
  function withHeaders(headers: Record<string, string>): Request {
    return new Request("https://fake-phone.test/api/voice/session", { headers });
  }

  it("takes the leftmost x-forwarded-for entry", () => {
    const key = clientKeyFor(
      withHeaders({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" }),
    );

    expect(key).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip", () => {
    expect(clientKeyFor(withHeaders({ "x-real-ip": "203.0.113.6" }))).toBe("203.0.113.6");
  });

  it("fails closed onto one shared bucket rather than no bucket at all", () => {
    expect(clientKeyFor(withHeaders({}))).toBe("unknown");
  });
});
