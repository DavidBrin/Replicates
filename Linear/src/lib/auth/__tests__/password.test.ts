// @vitest-environment node
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { hashPassword, needsRehash, verifyPassword } from "../password";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt is deliberately slow — each of these hashes costs ~100 ms — so the
 * file is short on purpose and every test earns its place.
 */

describe("hashPassword", () => {
  it("round-trips", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a near miss", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("embeds the parameters next to the salt and the hash", async () => {
    const stored = await hashPassword("whatever");
    const parts = stored.split(":");
    expect(parts).toHaveLength(7);
    expect(parts[0]).toBe("scrypt");
    // N, r, p, keyLength — all readable, all numbers.
    for (const part of parts.slice(1, 5)) {
      expect(Number(part)).toBeGreaterThan(0);
    }
    // The password must not be recoverable from anything stored.
    expect(stored).not.toContain("whatever");
  });

  it("treats a unicode password by its normalized form", async () => {
    // "é" as one codepoint and as e + combining acute must be one password, or
    // the same keyboard produces a login failure on a different OS.
    const stored = await hashPassword("café-password-1");
    expect(await verifyPassword("café-password-1", stored)).toBe(true);
  });
});

describe("verifyPassword", () => {
  it("uses the parameters stored with the hash, not today's", async () => {
    // A hash written under weaker parameters must keep verifying, or raising
    // the cost would lock every existing account out.
    const salt = randomBytes(16);
    const legacyParameters = { N: 16384, r: 8, p: 1, maxmem: 128 * 16384 * 8 * 2 };
    const digest = await scrypt("legacy password", salt, 64, legacyParameters);
    const stored = [
      "scrypt",
      legacyParameters.N,
      legacyParameters.r,
      legacyParameters.p,
      64,
      salt.toString("base64"),
      digest.toString("base64"),
    ].join(":");

    expect(await verifyPassword("legacy password", stored)).toBe(true);
    expect(needsRehash(stored)).toBe(true);
  });

  it("says no to a missing or corrupt hash without throwing", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "scrypt:1:1:1:1:zz:zz")).toBe(false);
  });

  /**
   * The enumeration guard, measured rather than asserted by inspection.
   *
   * A sign-in for an address with no account must not return faster than one
   * for a real account, or the endpoint answers "is this person a member?" to
   * anyone with a stopwatch. The margin is deliberately loose — this asserts
   * "the work happened", not a duration — because a tight bound would be a
   * flaky test on a busy machine.
   */
  it("costs the same when there is no user", async () => {
    const stored = await hashPassword("a real password here");

    const startReal = performance.now();
    await verifyPassword("a real password here", stored);
    const real = performance.now() - startReal;

    const startMissing = performance.now();
    await verifyPassword("a real password here", null);
    const missing = performance.now() - startMissing;

    expect(missing).toBeGreaterThan(real / 5);
  });
});

describe("needsRehash", () => {
  it("is false for a hash written today", async () => {
    expect(needsRehash(await hashPassword("current"))).toBe(false);
  });

  it("is true for anything unreadable", () => {
    expect(needsRehash("garbage")).toBe(true);
  });
});
