import "server-only";

/**
 * Password hashing — `scrypt` from `node:crypto`, and nothing else.
 *
 * ## Why not Argon2, which is the better function
 *
 * Every Node binding for Argon2id is a native module: `pnpm install` either
 * compiles it or downloads a platform binary, which breaks the clone-and-run
 * promise `config/env.ts` is written to keep, and breaks a deploy whose glibc
 * does not match the prebuilt. bcrypt has the same packaging problem plus a
 * 72-byte input truncation that silently discards the tail of a long
 * passphrase. scrypt is memory-hard, in the same family, and already present on
 * every machine that can run this application.
 *
 * ## The stored format
 *
 * `scrypt$N$r$p$keyLength$salt$hash`, salt and hash base64.
 *
 * The parameters travel *with* each hash rather than being read from a constant
 * at verification time. That is precisely the difference between being able to
 * raise the cost later and not: every existing row keeps verifying under the
 * parameters it was written with, and {@link needsRehash} tells the sign-in path
 * which rows to upgrade the next time their owner supplies the plaintext. Read
 * the cost from a constant instead and the first cost increase locks every
 * account in the database out.
 *
 * ## What this file must never do
 *
 * Log. Not the password, not the hash, not the salt, not "verifying password
 * for x@example.com". There is no logger imported here, on purpose.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

interface ScryptParameters {
  /** CPU/memory cost. A power of two. */
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
 * `N = 2^17, r = 8, p = 1`. **Measured on this machine** (Apple silicon, Node
 * 20, one derivation at a time): `2^14` → 24.8 ms, `2^15` → 46.6 ms, `2^16` →
 * 96.2 ms, `2^17` → 200.7 ms. So the cost is linear in `N` here, and 200 ms is
 * where the curve stops being free and is still under the point at which a
 * sign-in stops feeling immediate. It is paid once per sign-in, not per
 * request.
 *
 * The number that actually matters is not the latency, it is the memory:
 * scrypt's cost is `128 · N · r · p` bytes that an attacker has to hold *per
 * guess in flight*. At these parameters that is 128 MB per guess, which is what
 * makes a GPU or FPGA farm expensive rather than the 200 ms, and it is why
 * moving from `2^15` to `2^17` is a 4× cut in an attacker's parallelism rather
 * than merely a 4× cut in their throughput.
 *
 * Raising this later invalidates nothing — {@link decode} reads the parameters
 * from each stored hash.
 */
const CURRENT: ScryptParameters = Object.freeze({
  N: 131_072,
  r: 8,
  p: 1,
  keyLength: 64,
});

const SALT_BYTES = 16;

/**
 * How many derivations may be in flight at once, process-wide.
 *
 * This is the other half of choosing an expensive parameter set, and omitting
 * it turns a hardening decision into a denial-of-service vector. Each
 * derivation holds `128 · N · r · p` = **128 MB** for its duration, and the
 * memory is allocated *before* the password is compared — so the attacker needs
 * no account and no valid address. Twenty concurrent sign-in attempts would ask
 * the runtime for 2.5 GB at one instant, and a serverless function with a 1 GB
 * ceiling does not slow down under that, it dies.
 *
 * Four is chosen against the smallest plausible deployment rather than the
 * largest: ~512 MB of scrypt arenas, which fits a 1 GB function, and on a
 * multi-core laptop still keeps every core busy. Beyond four, callers wait —
 * the right failure mode for a queue that drains in ~200 ms.
 *
 * It gates {@link hashPassword} and {@link verifyPassword} alike, and that
 * includes the decoy path. A gate that only queued *real* users would restore
 * the timing difference the decoy exists to remove, under load, which is
 * exactly when nobody is looking at it.
 */
const MAX_CONCURRENT_DERIVATIONS = 4;

/**
 * How many callers may queue behind those four before the answer is "no".
 *
 * Memory stays bounded by the gate above whatever happens here; what grows
 * without a cap is the *line*, and a caller at the back of an unbounded line
 * holds a socket open waiting for a slot that arrives after its own request has
 * timed out somewhere upstream. Sixty-four is about three seconds of backlog at
 * four-way concurrency and ~200 ms each. Refusing cheaply is a better answer
 * than accepting expensively.
 */
const MAX_WAITING_DERIVATIONS = 64;

/**
 * Thrown when the queue is full. A route should turn this into a 503.
 *
 * A distinct type rather than `false`, because "wrong password" would be a lie
 * that also spends whatever attempt budget sits in front of the route — so a
 * momentary overload would lock out precisely the accounts trying to sign in.
 */
export class DerivationOverloadedError extends Error {
  constructor() {
    super("Too many password derivations in flight.");
    this.name = "DerivationOverloadedError";
  }
}

let inFlight = 0;
const waiting: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT_DERIVATIONS) {
    inFlight += 1;
    return;
  }
  if (waiting.length >= MAX_WAITING_DERIVATIONS) {
    throw new DerivationOverloadedError();
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  // FIFO: whoever has waited longest goes next, so a burst cannot starve the
  // first arrival indefinitely.
  waiting.shift()?.();
}

/**
 * Node's default `maxmem` is 32 MB, and scrypt needs `128 · N · r · p` — which
 * at our own defaults is 128 MB, so the default ceiling rejects the default
 * parameters. Deriving the ceiling from the parameters means raising the cost
 * later is one edit rather than two, and the second edit is the one that gets
 * forgotten until a sign-in throws in production.
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
    // NFKC first, so that "é" typed as one codepoint and as `e` + U+0301
    // verify the same way. Without it the failure is a sign-in that works on
    // one keyboard and not another, which nobody ever diagnoses.
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

function encode(
  parameters: ScryptParameters,
  salt: Buffer,
  hash: Buffer,
): string {
  return [
    "scrypt",
    parameters.N,
    parameters.r,
    parameters.p,
    parameters.keyLength,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

interface DecodedHash {
  readonly parameters: ScryptParameters;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

function decode(stored: string): DecodedHash | null {
  const parts = stored.split("$");
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
    parameters.r < 1 ||
    parameters.p < 1 ||
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

/** A new hash for a new password. Every call produces a fresh salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, CURRENT);
  return encode(CURRENT, salt, hash);
}

/**
 * A syntactically valid hash of a password nobody holds.
 *
 * {@link verifyPassword} derives against this when there is no account, so that
 * "no such address" and "wrong password" take the same code path and cost the
 * same. Without it, a sign-in for an unknown address returns in microseconds
 * against ~200 ms for a known one — a 200 ms difference is trivially
 * measurable over the internet, and the endpoint becomes a list of which
 * addresses have accounts here.
 *
 * The digest is zeroes because its value is irrelevant: the comparison is meant
 * to fail. What matters is that the derivation runs, and
 * `__tests__/password.test.ts` asserts that by counting `scrypt` invocations
 * rather than by timing the call — a wall-clock assertion on a 200 ms operation
 * is a flaky test that proves nothing on a loaded CI box.
 */
const DECOY = decode(
  encode(CURRENT, Buffer.alloc(SALT_BYTES, 0x2a), Buffer.alloc(CURRENT.keyLength, 0)),
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
  const real = stored === null ? null : decode(stored);
  // A corrupted row joins the missing-account path rather than returning early,
  // for the same reason the decoy exists: an early return is a timing
  // difference, and here it would also be a *detectable* one — it would
  // distinguish "this row is malformed" from "this password is wrong".
  const decoded = real ?? DECOY;
  if (!decoded) return false;

  const candidate = await derive(password, decoded.salt, decoded.parameters);
  // `timingSafeEqual` throws rather than returning false on a length mismatch,
  // so the lengths are compared first. Only a truncated stored value can reach
  // this, and it is already on the decoy path.
  if (candidate.length !== decoded.hash.length) return false;
  const matches = timingSafeEqual(candidate, decoded.hash);
  // `real !== null` is belt and braces: the decoy's digest is 64 zero bytes and
  // no derivation produces it. It is here so that the guarantee "a null
  // `stored` can never authenticate" is visible in the code rather than being a
  // property of a constant defined forty lines away.
  return matches && real !== null;
}

/**
 * Was `stored` written with parameters weaker than today's?
 *
 * Call it after a *successful* verification — the one moment the plaintext is
 * in hand and can be re-hashed at the current cost.
 *
 * All four parameters are compared, `p` included. Omitting `p` is not harmless:
 * it is a linear multiplier on total work, so a row written at `p = 1` when the
 * current tuple says `p = 2` costs an attacker half of what this file claims,
 * and it would never be upgraded because nothing else in the comparison can see
 * the difference. Whichever way the tuple moves next, every parameter that
 * contributes to the cost has to be able to trigger a rehash, or the weakest of
 * them quietly becomes the real setting.
 *
 * An undecodable value returns `true`: it cannot be verified against anyway, so
 * the only useful thing to do with it is replace it.
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
