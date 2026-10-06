import "server-only";

import { config } from "@/config/env";

import { getDb } from "@/adapters/db";
import type { PlayerRow } from "@/adapters/db/repositories/players";
import { playersRepository } from "@/adapters/db/repositories/players";

/**
 * The entire auth system: one cookie (SPEC §6).
 *
 * `risk_sid = <playerId>.<secret>`, **httpOnly · Secure (prod) ·
 * SameSite=Lax · Path=/ · Max-Age 30 days**, value minted server-side (32
 * random bytes, `sha256(secret)` stored in `players.secret_hash`). Every
 * request splits the cookie and compares the hash in constant time. No
 * passwords, no email, no library.
 *
 * The cookie is read and written as raw headers rather than through
 * `next/headers`, for two reasons: a route test can then call a handler with
 * a plain `Request` and read `Set-Cookie` off a plain `Response`, and
 * `cookies()` is unavailable outside a request scope, which is where half of
 * these tests run.
 *
 * `Secure` is omitted outside production **only** so an `http://localhost`
 * dev server and the e2e suite can hold a session at all; it is on for every
 * deployment, where `config().isProduction` is true.
 */

export const COOKIE_NAME = "risk_sid";
export const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Build the `Set-Cookie` value for a freshly minted session. */
export function sessionCookie(playerId: string, secret: string): string {
  const parts = [
    `${COOKIE_NAME}=${playerId}.${secret}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (config().isProduction) parts.push("Secure");
  return parts.join("; ");
}

/** The `Set-Cookie` value that clears it: same attributes, `Max-Age=0`. */
export function clearedCookie(): string {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (config().isProduction) parts.push("Secure");
  return parts.join("; ");
}

/** Split `risk_sid` out of a `Cookie` header, without a cookie library. */
export function readSessionCookie(request: Request): { id: string; secret: string } | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    if (pair.slice(0, index).trim() !== COOKIE_NAME) continue;
    const value = pair.slice(index + 1).trim();
    // Exactly one `.`: a player id never contains one, and neither does a
    // hex secret, so a value with two is malformed rather than ambiguous.
    const dot = value.indexOf(".");
    if (dot <= 0 || dot === value.length - 1) return null;
    const id = value.slice(0, dot);
    const secret = value.slice(dot + 1);
    if (secret.includes(".")) return null;
    return { id, secret };
  }
  return null;
}

/**
 * The authenticated player, or `null` for no cookie, a stale cookie (the
 * account was reaped) or a wrong secret. The three are deliberately
 * indistinguishable from outside: all three are the route's `401`.
 */
export async function currentPlayer(request: Request): Promise<PlayerRow | null> {
  const cookie = readSessionCookie(request);
  if (!cookie) return null;
  return playersRepository(getDb()).authenticate(cookie.id, cookie.secret);
}

/**
 * The player, with their presence heartbeat stamped.
 *
 * Every authenticated poll stamps `players.last_seen_at` and the caller's
 * `game_players.last_seen_at` in the same invocation — presence is never its
 * own request (D12). The seat stamp is what the away sweep and POLL 3's
 * `presence` read, and it is what flips a bot-held seat back to its human on
 * their next poll.
 */
export async function heartbeat(player: PlayerRow): Promise<void> {
  const players = playersRepository(getDb());
  await players.touch(player.id);
  await players.touchSeats(player.id);
}
