import "server-only";

/**
 * Password hashing — `scrypt` from `node:crypto`, and nothing else.
 *
 * ## Why not Argon2
 *
 * Argon2id is the better function and it is not available here. Every Node
 * binding for it is a native module: `npm install` compiles or downloads a
 * platform binary, which breaks "clone and run" on the machine that has no
 * toolchain and breaks the deploy on the runtime whose glibc does not match.
 * `SPEC.md`'s zero-config promise is load-bearing, so the choice is scrypt in
 * the standard library — memory-hard, in the same family, and already on every
 * machine that can run the app.
 *
 * ## The stored format
 *
 * `scrypt:N:r:p:keyLength:salt:hash`, salt and hash base64.
 *
 * The parameters are stored *with* the hash rather than read from a constant at
 * verification time. That is the difference between being able to raise the
 * cost later and not: every existing row keeps verifying under the parameters
 * it was written with, and {@link needsRehash} tells the sign-in path which
 * rows to upgrade on the next successful password submission. A constant would
 * mean a cost increase invalidates every account in the database.
 *
 * ## What this file must never do
 *
 * Log. Not the password, not the hash, not the salt, not "verifying password
 * for user@example.com". There is no logger imported here on purpose.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

interface ScryptParameters {
  /** CPU/memory cost. Must be a power of two. */
  readonly N: number;
  /** Block size. */
  readonly r: number;
  /** Parallelism. */
  readonly p: number;
  readonly keyLength: number;
}

/**
 * The parameters new hashes are written with.
 *
 * `N = 2^15, r = 8, p = 1` is roughly 32 MB and ~100 ms of work per attempt on
 * a laptop — the point where a sign-in still feels instant and an offline
 * attacker's throughput has collapsed. Node's own default is `N = 2^14`, which
 * is where the OWASP minimum sits; going one doubling above it costs nothing a
 * user can perceive.
 */
const CURRENT: ScryptParameters = Object.freeze({
  N: 32768,
  r: 8,
  p: 1,
  keyLength: 64,
});

const SALT_BYTES = 16;

/**
 * Node's default `maxmem` is 32 MB and the memory scrypt actually needs is
 * `128 * N * r * p`, which at these parameters is exactly 32 MB — so the
 * default rejects our own default. Deriving the ceiling from the parameters
 * (with headroom) means raising the cost later is one edit rather than two, and
 * the second edit is the one everyone forgets.
 */
function maxmemFor(parameters: ScryptParameters): number {
  return 128 * parameters.N * parameters.r * parameters.p * 2;
}

async function derive(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  // Normalising first means "é" typed as one codepoint and as two verifies the
  // same way, which is otherwise a login failure nobody can explain.
  return scrypt(password.normalize("NFKC"), salt, parameters.keyLength, {
    N: parameters.N,
    r: parameters.r,
    p: parameters.p,
    maxmem: maxmemFor(parameters),
  });
}

function encode(parameters: ScryptParameters, salt: Buffer, hash: Buffer): string {
  return [
    "scrypt",
    parameters.N,
    parameters.r,
    parameters.p,
    parameters.keyLength,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join(":");
}

interface DecodedHash {
  readonly parameters: ScryptParameters;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

function decode(stored: string): DecodedHash | null {
  const parts = stored.split(":");
  if (parts.length !== 7) return null;
  const [scheme, n, r, p, keyLength, salt, hash] = parts;
  if (scheme !== "scrypt") return null;
  const parameters: ScryptParameters = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keyLength: Number(keyLength),
  };
  if (
    !Number.isInteger(parameters.N) ||
    !Number.isInteger(parameters.r) ||
    !Number.isInteger(parameters.p) ||
    !Number.isInteger(parameters.keyLength) ||
    parameters.N < 2 ||
    parameters.keyLength < 16
  ) {
    return null;
  }
  return {
    parameters,
    salt: Buffer.from(salt ?? "", "base64"),
    hash: Buffer.from(hash ?? "", "base64"),
  };
}

/** A new hash for a new password. Every call produces a different salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, CURRENT);
  return encode(CURRENT, salt, hash);
}

/**
 * A syntactically valid hash of a password nobody has.
 *
 * Verifying against it is what {@link verifyPassword} does when the account
 * does not exist, so "no such email" and "wrong password" take the same path
 * and about the same time. Without it, a sign-in for an unknown address returns
 * in microseconds and the endpoint is a user-enumeration oracle — the timing
 * difference is measurable over the network at scrypt's cost.
 *
 * The digest is zeroes because its value is irrelevant: the comparison is meant
 * to fail. What matters is that the derivation runs.
 */
const DECOY = encode(
  CURRENT,
  Buffer.alloc(SALT_BYTES, 0x2a),
  Buffer.alloc(CURRENT.keyLength, 0),
);

/**
 * Does `password` match `stored`?
 *
 * @param stored the value from `users.password_hash`, or `null` when no such
 *   user exists. Passing `null` deliberately still costs a full derivation.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  const decoded = decode(stored ?? DECOY) ?? decode(DECOY);
  // `decode(DECOY)` cannot fail — DECOY is produced by `encode` — but the
  // fallback keeps a corrupted row on the same code path as a missing user
  // instead of returning early and leaking the difference in timing.
  if (!decoded) return false;

  const candidate = await derive(password, decoded.salt, decoded.parameters);
  if (candidate.length !== decoded.hash.length) return false;
  const matches = timingSafeEqual(candidate, decoded.hash);
  // A real user with a real hash is the only way to reach a true here; the
  // decoy's digest is all zeroes and no derivation produces it.
  return matches && stored !== null;
}

/**
 * Was `stored` written with parameters weaker than today's?
 *
 * Call it after a *successful* verification — that is the one moment the plain
 * password is in hand and can be re-hashed at the current cost.
 */
export function needsRehash(stored: string): boolean {
  const decoded = decode(stored);
  if (!decoded) return true;
  const { parameters } = decoded;
  return (
    parameters.N < CURRENT.N ||
    parameters.r < CURRENT.r ||
    parameters.keyLength < CURRENT.keyLength
  );
}
