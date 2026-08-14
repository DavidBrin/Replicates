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
 * `N = 2^17, r = 8, p = 1` — 128 MB and ~200 ms per derivation, measured on the
 * development machine this was tuned on (2^15 → 52 ms, 2^16 → 103 ms,
 * 2^17 → 203 ms). That is the floor `research/06-stack-deployment.md` §5 sets
 * for interactive use and calls out as the thing to verify before shipping:
 * *"OWASP's 2026 floor is `N = 2^17, r = 8, p = 1`"*. This file shipped at
 * `2^15` — two doublings under its own written requirement, which is a quarter
 * of the intended cost to an offline attacker.
 *
 * The number that matters is not the latency, it is the memory: scrypt's cost
 * is `128 · N · r · p` bytes that an attacker must hold *per guess in flight*,
 * so 32 MB → 128 MB is a 4× cut in how many guesses a given GPU or FPGA can run
 * at once. 200 ms is still under the threshold at which a sign-in stops feeling
 * immediate, and it is paid once per sign-in rather than per request.
 *
 * Raising this does not invalidate anything: {@link decode} reads the
 * parameters from each stored hash, so every existing row keeps verifying under
 * the parameters it was written with and {@link needsRehash} upgrades it on the
 * owner's next successful sign-in.
 */
const CURRENT: ScryptParameters = Object.freeze({
  N: 131072,
  r: 8,
  p: 1,
  keyLength: 64,
});

const SALT_BYTES = 16;

/**
 * How many derivations may be in flight at once, process-wide.
 *
 * This is the other half of raising the cost, and skipping it turns a hardening
 * change into a denial-of-service vector. Each derivation holds
 * `128 · N · r · p` = **128 MB** for its duration; twenty concurrent sign-in
 * requests would ask the runtime for 2.5 GB at the same instant, and a
 * serverless function with a 1 GB ceiling does not slow down under that, it
 * dies. The attacker needs no credentials and no account — the memory is
 * allocated before the password is compared.
 *
 * Four is chosen against the smallest deployment target rather than the
 * largest: ~512 MB of scrypt arenas, which fits the 1 GB Vercel function, and
 * on a multi-core laptop still keeps every core busy. Requests beyond it wait
 * rather than fail, which is the right failure mode for a queue that drains in
 * ~200 ms, and the rate limiter in front of the routes is what stops the queue
 * growing without bound.
 *
 * It applies to `hashPassword` and `verifyPassword` alike, so the decoy path
 * and the real path continue to cost the same — a gate that only queued real
 * users would be a timing oracle wearing a helmet.
 */
const MAX_CONCURRENT_DERIVATIONS = 4;

let inFlight = 0;
const waiting: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT_DERIVATIONS) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  // FIFO: the request that has waited longest goes next, so a burst cannot
  // starve the first arrival indefinitely.
  waiting.shift()?.();
}

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
  await acquireSlot();
  try {
    // Normalising first means "é" typed as one codepoint and as two verifies
    // the same way, which is otherwise a login failure nobody can explain.
    return await scrypt(password.normalize("NFKC"), salt, parameters.keyLength, {
      N: parameters.N,
      r: parameters.r,
      p: parameters.p,
      maxmem: maxmemFor(parameters),
    });
  } finally {
    releaseSlot();
  }
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
 *
 * All four parameters are compared, `p` included. Its omission was not
 * harmless: `p` is a linear multiplier on the total work, so a row written at
 * `p = 1` when the current tuple says `p = 2` costs an attacker half of what
 * this file claims — and it would never be upgraded, because nothing else in
 * the comparison can see the difference. Whichever way the tuple moves next,
 * every column that contributes to the cost has to be able to trigger a
 * rehash, or the weakest of them silently becomes the real setting.
 */
export function needsRehash(stored: string): boolean {
  const decoded = decode(stored);
  if (!decoded) return true;
  const { parameters } = decoded;
  return (
    parameters.N < CURRENT.N ||
    parameters.r < CURRENT.r ||
    parameters.p < CURRENT.p ||
    parameters.keyLength < CURRENT.keyLength
  );
}
