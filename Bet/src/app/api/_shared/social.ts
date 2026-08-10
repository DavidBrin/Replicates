/**
 * Small helpers shared across Task 6's users/friends/groups/invites routes.
 * This directory has no `route.ts` of its own (and the leading underscore
 * marks it a Next.js "private folder"), so none of this is ever reachable
 * as an endpoint — it exists purely to avoid duplicating the same few
 * lines across half a dozen `route.ts` files.
 */

import { createHash } from "node:crypto";
import type { User } from "@/domain/entities";

/**
 * The only fields of a `User` any route in this task is ever allowed to
 * hand back for someone OTHER than the caller themself. Never `balance`,
 * never `createdAt`, never anything else — ambiguity resolutions: "never
 * emails, never friend lists, never counts of another user's friends."
 */
export type PublicUser = {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string;
  avatarInitials: string;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    avatarInitials: user.avatarInitials,
  };
}

/**
 * `name` -> slug: lowercased, every run of non-alphanumerics collapsed to
 * one `-`, leading/trailing `-` trimmed (David's ambiguity resolution for
 * `POST /api/groups`). Falls back to `"group"` if nothing alphanumeric
 * survives (e.g. an all-emoji/punctuation name) so callers never have to
 * handle an empty slug.
 */
export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "group";
}

/** 7-day expiry, applied uniformly to every invite this task creates
 * (link AND direct) — David's ambiguity resolution states it for link
 * tokens specifically, and the Task 5 seed data already applies the same
 * 7-day window to direct market invites, so this keeps both kinds
 * consistent rather than special-casing links only. */
export const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * SHA-256 hex digest — used both to mint a link invite's stored
 * `tokenHash` and to re-hash a presented token for lookup on redemption.
 * Same function both directions so minting and verifying can never drift.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mints a link-invite token: 32 random bytes via the Web Crypto
 * `crypto.getRandomValues` global (David's ambiguity resolution — Node
 * exposes this globally, no import needed, and it's the same primitive
 * `proxy.ts`/`demo-session.ts` already lean on for Edge-runtime
 * compatibility), base64url-encoded. Returns the raw token — handed to
 * the caller exactly once, in the creation response, and never
 * persisted — alongside its hash, which IS the only thing ever written to
 * storage (`Invite.tokenHash`).
 */
export function mintInviteToken(): { token: string; tokenHash: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Buffer.from(bytes).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}
