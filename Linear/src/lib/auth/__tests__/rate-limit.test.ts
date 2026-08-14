// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bucketCountForTests,
  consumeAuthAttempt,
  resetAuthRateLimitForTests,
} from "../rate-limit";

/**
 * The limiter in front of the two endpoints that run scrypt for a stranger.
 *
 * Two things are being pinned here, and the second is the one that matters.
 *
 * The first is the ordinary behaviour: a budget that depletes, refills on a
 * clock, refunds a correct password and does not refund a new account.
 *
 * The second is what happens when the limiter is *attacked rather than used*.
 * A token bucket keyed on attacker-supplied strings is a map an attacker can
 * grow, so it needs a ceiling — and the moment it has one, eviction becomes a
 * way to *reset a limit*, because a key with no entry gets a full budget on its
 * next request. An eviction policy chosen for cache-friendliness (drop the
 * oldest) hands a throttled attacker their allowance back for the price of some
 * junk traffic. That is the bypass the last block below exists to catch, and it
 * is invisible to every test that only checks that the limit works.
 */

function request(ip: string): Request {
  return new Request("https://example.test/api/auth/signin", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  resetAuthRateLimitForTests();
});

afterEach(() => {
  vi.useRealTimers();
  resetAuthRateLimitForTests();
});

/* ============================================================= behaviour = */

describe("the budget", () => {
  it("allows a burst up to capacity, then refuses", () => {
    // Sign-in's per-email budget is the smaller of the pair, at ten.
    for (let i = 0; i < 10; i += 1) {
      expect(
        consumeAuthAttempt("signin", request(`10.0.0.${i}`), "a@x.test").limited,
        `attempt ${i + 1}`,
      ).toBe(false);
    }
    const verdict = consumeAuthAttempt("signin", request("10.0.0.99"), "a@x.test");
    expect(verdict.limited).toBe(true);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("refills on the clock", () => {
    for (let i = 0; i < 10; i += 1) {
      consumeAuthAttempt("signin", request(`10.0.1.${i}`), "b@x.test");
    }
    expect(
      consumeAuthAttempt("signin", request("10.0.1.99"), "b@x.test").limited,
    ).toBe(true);

    // One token per 90s on the sign-in email budget.
    vi.advanceTimersByTime(91_000);
    expect(
      consumeAuthAttempt("signin", request("10.0.1.98"), "b@x.test").limited,
    ).toBe(false);
  });

  it("gives the tokens back when the password was right", () => {
    // The honest user must never meet the limiter. Twenty correct sign-ins
    // from one address stay under a budget of twenty because each refunds.
    for (let i = 0; i < 40; i += 1) {
      const verdict = consumeAuthAttempt("signin", request("10.0.2.1"), "c@x.test");
      expect(verdict.limited, `sign-in ${i + 1}`).toBe(false);
      verdict.succeeded();
    }
  });

  it("does not give them back for a new account", () => {
    // A successful sign-up is not evidence of an honest caller the way a
    // correct password is — it is an account, at 200ms of scrypt each.
    let limited = false;
    for (let i = 0; i < 12; i += 1) {
      const verdict = consumeAuthAttempt("signup", request("10.0.3.1"), `d${i}@x.test`);
      verdict.succeeded();
      if (verdict.limited) limited = true;
    }
    expect(limited).toBe(true);
  });

  it("charges the IP even when the email budget is already empty", () => {
    // Otherwise an attacker keeps one budget full by exhausting the other.
    for (let i = 0; i < 10; i += 1) {
      consumeAuthAttempt("signin", request("10.0.4.1"), "e@x.test");
    }
    // The email bucket is spent; the IP bucket should have been charged all
    // ten times too, so it is ten down from twenty rather than untouched.
    for (let i = 0; i < 10; i += 1) {
      consumeAuthAttempt("signin", request("10.0.4.1"), `f${i}@x.test`);
    }
    expect(
      consumeAuthAttempt("signin", request("10.0.4.1"), "g@x.test").limited,
    ).toBe(true);
  });
});

/* ============================================================== the map = */

describe("under a flood of distinct keys", () => {
  it("keeps the map bounded", () => {
    // The defect this replaced: eviction only dropped entries idle for an hour,
    // so a burst — where nothing is idle at all — grew without limit and made
    // every insert scan the whole map to delete nothing.
    for (let i = 0; i < 25_000; i += 1) {
      consumeAuthAttempt("signin", request(`10.1.${i % 256}.${i % 251}`), `u${i}@x.test`);
    }
    expect(bucketCountForTests()).toBeLessThanOrEqual(20_000);
  });

  it("does not let a flood buy a throttled key its budget back", () => {
    // The bypass. Spend one key's budget, then flood the map hard enough to
    // force eviction, then come back. If eviction dropped the oldest entries,
    // the attacker's own spent bucket would be among the first to go and this
    // final attempt would be allowed — a limit reset for the price of junk.
    const victim = "victim@x.test";
    for (let i = 0; i < 10; i += 1) {
      consumeAuthAttempt("signin", request("10.2.0.1"), victim);
    }
    expect(
      consumeAuthAttempt("signin", request("10.2.0.2"), victim).limited,
    ).toBe(true);

    for (let i = 0; i < 25_000; i += 1) {
      consumeAuthAttempt("signin", request(`10.3.${i % 256}.${i % 251}`), `n${i}@x.test`);
    }

    expect(bucketCountForTests()).toBeLessThanOrEqual(20_000);
    expect(
      consumeAuthAttempt("signin", request("10.2.0.3"), victim).limited,
      "the throttled key survived the flood",
    ).toBe(true);
  });
});

/* ============================================================= disclosure = */

describe("what a refusal reveals", () => {
  it("says the same thing whether or not the address is real", () => {
    // The limiter runs before the user lookup precisely so it cannot become a
    // cheaper version of the timing attack `password.ts` exists to refuse.
    const spend = (email: string) => {
      for (let i = 0; i < 11; i += 1) {
        consumeAuthAttempt("signin", request("10.4.0.1"), email);
      }
      return consumeAuthAttempt("signin", request("10.4.0.2"), email);
    };

    const real = spend("owner@demo.test");
    resetAuthRateLimitForTests();
    const fake = spend("nobody-at-all@x.test");

    expect(real.limited).toBe(fake.limited);
    expect(real.retryAfterSeconds).toBe(fake.retryAfterSeconds);
  });

  it("treats an address as one budget regardless of capitalisation", () => {
    // Matching `lower(email)`, the expression the unique index is built on.
    // Otherwise the limit is multiplied by holding down shift.
    for (let i = 0; i < 10; i += 1) {
      consumeAuthAttempt("signin", request("10.5.0.1"), "Mixed@X.test");
    }
    expect(
      consumeAuthAttempt("signin", request("10.5.0.2"), "mixed@x.test").limited,
    ).toBe(true);
  });
});
