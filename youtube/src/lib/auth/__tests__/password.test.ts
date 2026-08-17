// @vitest-environment node

/**
 * `node`, not jsdom: `node:crypto`'s `scrypt` is mocked below to count
 * derivations, and the jsdom environment's partial crypto shim gets in the way
 * of that in a manner that reads like a mocking bug rather than an environment
 * one.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The counter has to be created by `vi.hoisted`.
 *
 * `vi.mock` factories are hoisted above every `const` in the file, so a plain
 * module-level counter referenced inside one is in its temporal dead zone when
 * the factory runs. The failure is `Cannot access 'calls' before
 * initialization`, which points at the counter rather than at the hoisting.
 */
const calls = vi.hoisted(() => ({ scrypt: 0, timingSafeEqual: 0 }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    default: actual,
    scrypt: (...args: unknown[]) => {
      calls.scrypt += 1;
      return (actual.scrypt as (...a: unknown[]) => unknown)(...args);
    },
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      calls.timingSafeEqual += 1;
      return actual.timingSafeEqual(a, b);
    },
  };
});

import { scrypt as scryptCallback, randomBytes } from "node:crypto";
import { promisify } from "node:util";

import { hashPassword, needsRehash, verifyPassword } from "../password";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * A hash written under parameters weaker than the current ones.
 *
 * Built here rather than by calling the module, because the point of the test
 * is that the *stored format* is self-describing — a hash produced by some
 * earlier version of this file, which no longer exists to call, still has to
 * verify. Constructing the string by hand is the only way to assert that
 * contract from outside.
 */
async function legacyHash(password: string): Promise<string> {
  const N = 16_384;
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, {
    N,
    r: 8,
    p: 1,
    maxmem: 128 * N * 8 * 2,
  });
  return ["scrypt", N, 8, 1, 64, salt.toString("base64"), hash.toString("base64")].join(
    "$",
  );
}

beforeEach(() => {
  calls.scrypt = 0;
  calls.timingSafeEqual = 0;
});

describe("hashPassword", () => {
  it("writes the parameters alongside the digest", async () => {
    const stored = await hashPassword("correct-horse-battery-staple");
    const [scheme, n, r, p, keyLength, salt, hash] = stored.split("$");

    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBe(131_072);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(Number(keyLength)).toBe(64);
    expect(Buffer.from(salt ?? "", "base64")).toHaveLength(16);
    expect(Buffer.from(hash ?? "", "base64")).toHaveLength(64);
  });

  it("salts every hash separately", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword", () => {
  it("accepts the password it was given and rejects any other", async () => {
    const stored = await hashPassword("hunter2");
    await expect(verifyPassword("hunter2", stored)).resolves.toBe(true);
    await expect(verifyPassword("hunter3", stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("normalises the password, so the same text typed two ways matches", async () => {
    // "café" with a precomposed é, then with e + U+0301. Two different byte
    // strings that every user would call the same password.
    const stored = await hashPassword("café");
    await expect(verifyPassword("café", stored)).resolves.toBe(true);
  });

  it("compares with timingSafeEqual rather than by value", async () => {
    const stored = await hashPassword("hunter2");
    calls.timingSafeEqual = 0;
    await verifyPassword("wrong", stored);
    expect(calls.timingSafeEqual).toBe(1);
  });

  /**
   * The account-enumeration test, and the reason it counts calls instead of
   * milliseconds.
   *
   * A wall-clock assertion here would be measuring a 200 ms operation on a
   * machine that is also running a WASM Postgres in another worker; it would
   * fail often enough to be disabled, and a disabled test defends nothing. What
   * the property actually reduces to is "the derivation runs on the miss path
   * too", and that is a countable event.
   */
  it("derives even when there is no stored hash at all", async () => {
    await expect(verifyPassword("anything", null)).resolves.toBe(false);
    expect(calls.scrypt).toBe(1);
  });

  it("costs the same number of derivations for a miss as for a wrong password", async () => {
    const stored = await hashPassword("hunter2");

    calls.scrypt = 0;
    await verifyPassword("wrong", stored);
    const wrongPassword = calls.scrypt;

    calls.scrypt = 0;
    await verifyPassword("wrong", null);
    const noSuchUser = calls.scrypt;

    expect(noSuchUser).toBe(wrongPassword);
  });

  it("treats a corrupted stored value as a miss, still at full cost", async () => {
    for (const corrupt of ["", "not-a-hash", "scrypt$1$1$1$1$$", "scrypt$x$8$1$64$AA$AA"]) {
      calls.scrypt = 0;
      await expect(verifyPassword("hunter2", corrupt)).resolves.toBe(false);
      expect(calls.scrypt).toBe(1);
    }
  });
});

describe("cost upgrades", () => {
  it("verifies a hash written under weaker parameters", async () => {
    const stored = await legacyHash("hunter2");
    await expect(verifyPassword("hunter2", stored)).resolves.toBe(true);
    await expect(verifyPassword("wrong", stored)).resolves.toBe(false);
  });

  it("flags the weak hash for rehashing and leaves a current one alone", async () => {
    expect(needsRehash(await legacyHash("hunter2"))).toBe(true);
    expect(needsRehash(await hashPassword("hunter2"))).toBe(false);
  });

  it("flags anything it cannot decode, since the only thing to do with it is replace it", () => {
    expect(needsRehash("")).toBe(true);
    expect(needsRehash("plaintext-password-oh-no")).toBe(true);
    expect(needsRehash("bcrypt$12$whatever$aaa$bbb$ccc$ddd")).toBe(true);
  });
});
