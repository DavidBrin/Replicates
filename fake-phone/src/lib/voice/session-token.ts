/**
 * A voice session as a signed token rather than a row in somebody's memory.
 *
 * `/api/voice/session` and `/api/voice/turn` are two separate serverless
 * functions on the documented deploy target. They do not share a heap, they are
 * not even guaranteed to be on the same machine, and either can cold-start
 * between one request and the next. A session held in a module-level `Map`
 * therefore fails on the *first* turn of a real deployment: the mint lands on
 * instance A and the turn asks instance B, which has never heard of it. "Fails
 * closed" was the previous defence of that, and it is not one — a cap that also
 * cancels every call is not a cap, it is an outage.
 *
 * So the server keeps no session state at all. The mint returns a token that
 * *carries* the facts the caps are enforced against — which session, which
 * persona, when it was issued, when it dies — with an HMAC-SHA-256 signature
 * over them. Any instance holding the same signing key can verify it, so:
 *
 *   - the duration cap is exact and stateless: elapsed time is measured from the
 *     **signed** `issuedAt`, so a client can no more reset its own clock than it
 *     can invent a session;
 *   - a tampered payload, an expired token and a token from another deployment
 *     are all indistinguishable from a forgery, and all get the same 404.
 *
 * The token carries no secret and is safe in a request body: everything inside
 * it is already known to the client. The signing key never leaves this module —
 * it is imported as a non-extractable `CryptoKey`, so there is no return value
 * anywhere in the codebase that could accidentally be serialised into a
 * response.
 *
 * Web Crypto only (`crypto.subtle`), which both Vercel runtimes provide, so this
 * adds no dependency and nothing here is Node-specific. Marked `server-only`
 * like `config.ts`: this module reads the signing secret, so importing it from a
 * component must be a build error rather than a key leak.
 */

import "server-only";

import { z } from "zod";

/** What the server signed, and therefore the only facts it will act on. */
export interface VoiceSessionClaims {
  readonly sessionId: string;
  /** Which persona was requested at mint time. Carried for log correlation. */
  readonly personaId: string;
  /** Epoch ms. The only clock the duration cap trusts. */
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface MintSessionInput {
  readonly personaId: string;
  /** Epoch ms. Passed in rather than read here so the caller owns the clock. */
  readonly issuedAt: number;
  readonly ttlMs: number;
}

export interface MintedVoiceSession {
  /** The opaque string the client sends back on every turn. Carries no secret. */
  readonly token: string;
  readonly claims: VoiceSessionClaims;
}

/**
 * Where a dedicated signing secret lives, if the operator sets one.
 *
 * Optional on purpose: the point of the AI tier is that adding one key lights it
 * up, and demanding a second one to make it *work* would undo that. Set this if
 * you rotate the provider key — a rotation without it invalidates every live
 * session, which ends some calls a few minutes early and nothing worse.
 */
export const VOICE_SESSION_SECRET_ENV = "VOICE_SESSION_SECRET";

/**
 * Domain separation. The derived key is used for exactly one purpose, and this
 * label is what stops a signature ever being meaningful anywhere else — including
 * against the provider key it may have been derived from.
 */
const KEY_DERIVATION_LABEL = "fake-phone/voice-session-token/v1";

/** Bumped if the payload shape ever changes; an old `v` then fails to parse. */
const TOKEN_VERSION = 1;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The signing key for this deployment, or `null` when nothing is configured.
 *
 * Derived from `VOICE_SESSION_SECRET` if present, else from the selected
 * provider's API key — which is already server-only, already required for the
 * tier to run at all, and never sent anywhere. Derivation is an HMAC over the
 * label above rather than the raw secret used directly, so a signature can never
 * be replayed as anything else and the provider key itself is never the key that
 * signs anything.
 *
 * `null` is only reachable on a deployment the routes already answer 503 for.
 */
export async function voiceSessionSigningKey(
  apiKeyEnvVar: string,
  env: Env = process.env,
): Promise<CryptoKey | null> {
  const secret = present(env[VOICE_SESSION_SECRET_ENV]) ?? present(env[apiKeyEnvVar]);
  if (secret === undefined) return null;

  const material = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign("HMAC", material, utf8(KEY_DERIVATION_LABEL));

  // `extractable: false`: from here on the key exists only as a handle. Nothing
  // can read the bytes back out, so nothing can leak them.
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Mints a session. The id is a v4 UUID — unguessable, though the signature is what counts. */
export async function mintVoiceSessionToken(
  input: MintSessionInput,
  key: CryptoKey,
): Promise<MintedVoiceSession> {
  const claims: VoiceSessionClaims = {
    sessionId: crypto.randomUUID(),
    personaId: input.personaId,
    issuedAt: input.issuedAt,
    expiresAt: input.issuedAt + input.ttlMs,
  };

  const body = encodeBody(claims);
  const signature = await crypto.subtle.sign("HMAC", key, utf8(body));

  return { token: `${body}.${base64Url(new Uint8Array(signature))}`, claims };
}

/**
 * The claims this token proves, or `null` if it proves nothing.
 *
 * One return value for every way a token can fail — wrong shape, wrong
 * signature, wrong key, expired — because the caller has exactly one thing to do
 * about all of them, and telling a forger *which* check they failed is telling
 * them how to pass it.
 */
export async function verifyVoiceSessionToken(
  token: string,
  key: CryptoKey,
  at: number,
): Promise<VoiceSessionClaims | null> {
  const separator = token.indexOf(".");
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = fromBase64Url(token.slice(separator + 1));
  if (!signature) return null;

  // `subtle.verify` compares in constant time, which is why the comparison is
  // not written out here.
  const signed = await crypto.subtle.verify("HMAC", key, signature, utf8(body));
  if (!signed) return null;

  const claims = decodeBody(body);
  if (!claims) return null;

  // Checked after the signature, so an expiry can never be read off an unsigned
  // payload. A token minted with a clock slightly ahead is fine: elapsed time
  // clamps at zero rather than going negative.
  if (claims.expiresAt <= at) return null;

  return claims;
}

/** Wall-clock seconds since the server minted the session. Not the client's view. */
export function elapsedSecondsSince(claims: VoiceSessionClaims, at: number): number {
  return Math.max(0, Math.floor((at - claims.issuedAt) / 1000));
}

/**
 * Short keys because this string travels on every turn: `v`ersion, `s`ession
 * `id`, `p`ersona `id`, `i`ssued `at`, `exp`iry.
 */
const payloadSchema = z.object({
  v: z.literal(TOKEN_VERSION),
  sid: z.string().min(1),
  pid: z.string(),
  iat: z.number().int().finite(),
  exp: z.number().int().finite(),
});

function encodeBody(claims: VoiceSessionClaims): string {
  return base64Url(
    utf8(
      JSON.stringify({
        v: TOKEN_VERSION,
        sid: claims.sessionId,
        pid: claims.personaId,
        iat: claims.issuedAt,
        exp: claims.expiresAt,
      }),
    ),
  );
}

function decodeBody(body: string): VoiceSessionClaims | null {
  const bytes = fromBase64Url(body);
  if (!bytes) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }

  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return null;

  return {
    sessionId: parsed.data.sid,
    personaId: parsed.data.pid,
    issuedAt: parsed.data.iat,
    expiresAt: parsed.data.exp,
  };
}

/**
 * A byte view `crypto.subtle` will accept. The annotation is load-bearing:
 * `TextEncoder` is typed as possibly returning a view over a `SharedArrayBuffer`,
 * which `BufferSource` excludes, and it never actually does.
 */
type Bytes = Uint8Array<ArrayBuffer>;

function utf8(value: string): Bytes {
  return new TextEncoder().encode(value) as Bytes;
}

/** Base64url, unpadded — URL- and header-safe, so the token can move anywhere later. */
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Bytes | null {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;

  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** An unset var and an empty-string var mean the same thing: not configured. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
