import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Ids, lobby codes, secrets and the constant-time compare the cookie needs.
 *
 * Every value here lands in the database and several land in the action log,
 * so **none of them come from `Math.random`**: the house rule is
 * `crypto.getRandomValues` / `crypto.randomUUID` for anything a replay or an
 * auth check depends on. This is server code, outside the engine, so the
 * engine's "no randomness at all" rule does not apply — but the weaker rule
 * does, and a biased modulo would make a 4-letter lobby code measurably
 * easier to guess.
 *
 * Ids are minted in application code rather than by the database
 * (`gen_random_uuid()`) because PGlite ships without pgcrypto (§6.2).
 */

/** nanoid's URL-safe alphabet: 64 symbols, so one byte maps with no bias. */
const ID_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict";

/**
 * The lobby-code alphabet: 24 uppercase letters, **without `I` and `O`** —
 * short enough to say in one breath and free of the pairs that get misheard
 * (D17). 24⁴ = 331,776 codes.
 */
export const LOBBY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const LOBBY_CODE_LENGTH = 4;

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * `count` symbols drawn uniformly from `alphabet`, by rejection sampling.
 *
 * `byte % alphabet.length` would be biased whenever 256 is not a multiple of
 * the alphabet size — for the 24-letter code alphabet the first 16 letters
 * would appear 11/256 of the time and the last 8 only 10/256. Rejecting the
 * bytes above the largest multiple of the size removes it exactly.
 */
function randomString(alphabet: string, count: number): string {
  const size = alphabet.length;
  const ceiling = Math.floor(256 / size) * size;
  let out = "";
  while (out.length < count) {
    for (const byte of randomBytes((count - out.length) * 2)) {
      if (byte >= ceiling) continue;
      out += alphabet[byte % size];
      if (out.length === count) break;
    }
  }
  return out;
}

/** A player id: `p_` plus 21 URL-safe symbols (~125 bits). */
export function newPlayerId(): string {
  return `p_${randomString(ID_ALPHABET, 21)}`;
}

/** A game id: `g_` plus 21 URL-safe symbols. */
export function newGameId(): string {
  return `g_${randomString(ID_ALPHABET, 21)}`;
}

/** A fresh four-letter lobby code. Collisions are retried against the PK. */
export function newLobbyCode(): string {
  return randomString(LOBBY_CODE_ALPHABET, LOBBY_CODE_LENGTH);
}

/** A game seed. Hex, so it is safe in a query string and in a log line. */
export function newSeed(): string {
  return Buffer.from(randomBytes(16)).toString("hex");
}

/** The cookie's secret half: 32 random bytes, hex-encoded. */
export function newSecret(): string {
  return Buffer.from(randomBytes(32)).toString("hex");
}

/** `sha256(value)` as lowercase hex. What `players.secret_hash` stores. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Constant-time hex comparison.
 *
 * `===` on a hash leaks its prefix through timing. `timingSafeEqual` throws on
 * a length mismatch, which would leak the length, so the lengths are compared
 * first and a mismatch is answered by comparing the value against itself —
 * same work, same time, always false.
 */
export function secretMatches(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(sha256Hex(secret), "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  if (candidate.length !== stored.length) {
    timingSafeEqual(candidate, candidate);
    return false;
  }
  return timingSafeEqual(candidate, stored);
}
