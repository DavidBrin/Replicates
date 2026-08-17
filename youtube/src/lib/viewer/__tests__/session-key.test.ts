import { describe, expect, it } from "vitest";

import {
  VIEWER_KEY_COOKIE,
  VIEWER_KEY_IDLE_SECONDS,
  VIEWER_KEY_MAX_AGE_MS,
  decideViewerKey,
  mintViewerKey,
  parseViewerKey,
  viewerKeyCookie,
} from "../session-key";

/**
 * The viewing session key.
 *
 * Two things are being asserted, and they are not the same kind of claim.
 *
 * The first is that the **sessionisation rule** is the one
 * `research/04-recommender-covisitation.md` §1.1 recommends — a 30-minute idle
 * gap with a 24-hour hard cap — and that both halves are enforced by different
 * mechanisms. The idle gap is not testable here at all, because it is the
 * browser dropping an expired cookie; what *is* testable is that the cookie
 * carries the `Max-Age` that makes the browser do it, which is why the cookie
 * assertions are as specific as they are.
 *
 * The second is that `parseViewerKey` is strict about a value that arrives from
 * a request header and goes on to be a grouping key in the database.
 */

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0);

describe("mintViewerKey", () => {
  it("is 128 bits of hex and the issue time", () => {
    const key = mintViewerKey(NOW);
    expect(key.value).toMatch(/^[0-9a-f]{32}\.\d+$/);
    expect(key.issuedAtMs).toBe(NOW);
    expect(key.value.endsWith(`.${NOW}`)).toBe(true);
  });

  it("does not repeat", () => {
    // Not a randomness test — it cannot be one. It is a guard against the
    // failure that actually happens: a refactor that hoists the array or the
    // string out of the function and hands every viewer the same key, which
    // would merge every signed-out session in the world into one.
    const seen = new Set(
      Array.from({ length: 100 }, () => mintViewerKey(NOW).value),
    );
    expect(seen.size).toBe(100);
  });
});

describe("parseViewerKey", () => {
  it("reads back what it minted", () => {
    const key = mintViewerKey(NOW);
    expect(parseViewerKey(key.value)).toEqual(key);
  });

  it.each([
    ["absent", null],
    ["undefined", undefined],
    ["empty", ""],
    ["no timestamp", "0123456789abcdef0123456789abcdef"],
    ["no random half", ".1755000000000"],
    ["too short", "0123456789abcdef.1755000000000"],
    ["too long", "0123456789abcdef0123456789abcdef0.1755000000000"],
    ["uppercase hex", "0123456789ABCDEF0123456789ABCDEF.1755000000000"],
    ["not hex", "0123456789abcdef0123456789abcdeg.1755000000000"],
    ["negative time", "0123456789abcdef0123456789abcdef.-1"],
    ["fractional time", "0123456789abcdef0123456789abcdef.1.5"],
    ["two dots", "0123456789abcdef0123456789abcdef.1.2"],
    ["absurd time", "0123456789abcdef0123456789abcdef.1755000000000000000000"],
  ])("refuses %s", (_label, raw) => {
    expect(parseViewerKey(raw)).toBeNull();
  });

  it("refuses a value long enough to be an attack on the index", () => {
    // The parsed value becomes `watch_events.session_key`. A cookie of a
    // megabyte of hex would otherwise be a megabyte of index entry.
    expect(parseViewerKey(`${"a".repeat(100_000)}.${NOW}`)).toBeNull();
  });
});

describe("decideViewerKey", () => {
  it("mints when nothing was presented", () => {
    const decision = decideViewerKey(null, NOW);
    expect(decision.minted).toBe(true);
    expect(decision.key.issuedAtMs).toBe(NOW);
  });

  it("mints when what was presented is not one of ours", () => {
    expect(decideViewerKey("not-a-key", NOW).minted).toBe(true);
  });

  it("carries a live key forward unchanged", () => {
    const existing = mintViewerKey(NOW - 20 * 60 * 1000);
    const decision = decideViewerKey(existing.value, NOW);
    expect(decision.minted).toBe(false);
    expect(decision.key.value).toBe(existing.value);
  });

  it("carries one forward at one millisecond under the cap", () => {
    const existing = mintViewerKey(NOW - VIEWER_KEY_MAX_AGE_MS + 1);
    expect(decideViewerKey(existing.value, NOW).minted).toBe(false);
  });

  it("mints at the cap — §1.1's 24 hours regardless of gaps", () => {
    // The case §1.1 names: "a user who leaves videos playing in a background
    // tab for a week doesn't silently accumulate one giant session". The idle
    // gap alone never fires for them, because they never idle.
    const existing = mintViewerKey(NOW - VIEWER_KEY_MAX_AGE_MS);
    const decision = decideViewerKey(existing.value, NOW);
    expect(decision.minted).toBe(true);
    expect(decision.key.value).not.toBe(existing.value);
  });

  it("mints for a key stamped in the future", () => {
    // Not clamped to "very fresh": a forger would otherwise hold a session that
    // can never reach the cap.
    const existing = mintViewerKey(NOW + 60_000);
    expect(decideViewerKey(existing.value, NOW).minted).toBe(true);
  });
});

describe("viewerKeyCookie", () => {
  const key = mintViewerKey(NOW);

  it("carries the idle gap as Max-Age — that attribute IS the 30-minute rule", () => {
    expect(VIEWER_KEY_IDLE_SECONDS).toBe(30 * 60);
    expect(viewerKeyCookie(key, { secure: false })).toContain(
      `Max-Age=${VIEWER_KEY_IDLE_SECONDS}`,
    );
  });

  it("is HttpOnly and SameSite=Lax", () => {
    const cookie = viewerKeyCookie(key, { secure: false });
    expect(cookie).toContain(`${VIEWER_KEY_COOKIE}=${key.value}`);
    expect(cookie).toContain("HttpOnly");
    // `Strict` would drop the key on a shared video link, which is exactly the
    // arrival most worth attributing to the referring session.
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("takes Secure from the argument and not from the environment", () => {
    // The mistake this repository already made once with the session cookie: a
    // production build on http://localhost set `Secure`, and the browser
    // silently discarded every cookie the app issued.
    expect(viewerKeyCookie(key, { secure: false })).not.toContain("Secure");
    expect(viewerKeyCookie(key, { secure: true })).toContain("Secure");
  });
});
