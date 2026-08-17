import "server-only";

/**
 * The two questions a route handler asks before it does anything: who is this,
 * and may they.
 *
 * They are separated on purpose. `currentSession` knows nothing about videos;
 * the predicates know nothing about cookies, databases or HTTP. Everything
 * below the session functions is pure, synchronous and total — which is what
 * makes "private is servable only to the owning channel's owner" a sentence
 * that can be read off one function rather than reconstructed from a handler.
 *
 * ## Session resolution, and the `Set-Cookie` that is not here
 *
 * `currentSession` reads and never writes. Sessions have a fixed thirty-day
 * TTL from sign-in, no sliding expiry and no token rotation — `session.ts`
 * explains why the schema makes rotation unimplementable — so there is no
 * renewed cookie for a handler to forward. That absence is worth stating,
 * because the usual shape of this function in other codebases is "resolve, and
 * re-issue if it is close to expiry", and a handler written against that
 * assumption would silently drop a `Set-Cookie` this never produces.
 *
 * ## Unlisted and private differ here, and it is not an inconsistency
 *
 * At *this* layer — a blob key, no page around it — `unlisted` behaves exactly
 * like `public`: served to anyone who asks. That looks wrong beside a
 * `visibility` column that lists three values, and it is not.
 *
 * An unlisted video is defined by what it is excluded from, not by who may
 * fetch it: it is absent from feeds, from search and from the channel's video
 * list, and anyone holding the link may watch it. That is the entire promise,
 * and it is the promise YouTube makes too. A link is transferable, so an
 * unlisted video is a **capability URL** — its protection is that the eleven
 * character id is unguessable, and every layer either honours that or does
 * not. Gating segments on a session would not make an unlisted video more
 * private; it would only mean that the person the link was shared with cannot
 * watch it, which breaks the one thing unlisted is for.
 *
 * `private` promises something structurally different — *nobody but the owner*
 * — and that promise cannot be kept by an unguessable id, because ids leak: a
 * shared link, a log line, a referrer, a screenshot. It is the only one of the
 * three that needs to know who is asking, and it is therefore the only one
 * that costs a session lookup. See {@link needsViewerIdentity}.
 *
 * ## 404, never 403
 *
 * A 403 on a private video's segment confirms that the id names something,
 * which is exactly the signal an enumerator wants and the one thing an
 * unguessable id was protecting. The refusal is a 404 identical to the one a
 * key nothing was ever written to produces — same status, same body, same
 * headers. That decision was taken at the storage seam and is honoured rather
 * than re-litigated here; the media route's suite asserts the two responses
 * are indistinguishable, because a rule like this decays the moment nothing
 * checks it.
 */

import type { SqlDatabase, SqlExecutor } from "@/adapters/db/driver";
import { config } from "@/config/env";
import type { Visibility } from "@/domain/types";

import type { ResolvedSession } from "./session";
import { resolveSession, sessionTokenFromRequest } from "./session";

/* ============================================================= identity == */

export interface GuardOptions {
  /** Defaults to the process-wide handle. Tests pass their own. */
  readonly db?: SqlDatabase | SqlExecutor;
}

/**
 * The session a request is carrying, or `null`.
 *
 * Every failure is `null` and they are not distinguished — no cookie, a cookie
 * for another app on the same `localhost`, a forged signature, an expired JWT,
 * a revoked row. {@link resolveSession} already collapses them for the reason
 * given there, and a guard that reported which one had happened would be
 * telling somebody probing with edited cookies exactly how close they were.
 */
export async function currentSession(
  request: Request,
  options: GuardOptions = {},
): Promise<ResolvedSession | null> {
  return resolveSession(sessionTokenFromRequest(request), options);
}

/**
 * Just the user id, which is all the predicates below take.
 *
 * They take an id rather than a `ResolvedSession` so that they stay pure and
 * so that "who is asking" cannot accidentally widen into "and what else does
 * their session say" — an authorisation rule that reads a second field of the
 * session is one that a test of the rule cannot fully cover.
 */
export async function currentViewerId(
  request: Request,
  options: GuardOptions = {},
): Promise<string | null> {
  return (await currentSession(request, options))?.userId ?? null;
}

/* ============================================================ resources == */

/**
 * What a guard needs to know about the thing being reached for.
 *
 * Structural, and deliberately narrower than `MediaSubject`: the predicates
 * live in `lib/auth` and must not import an adapter, and a rule that can only
 * see an owner and a visibility is a rule that cannot quietly start depending
 * on an upload status or a channel handle.
 */
export interface OwnedResource {
  /** The **user** who owns the channel the object hangs off, not the channel. */
  readonly ownerId: string;
}

export interface VisibleResource extends OwnedResource {
  readonly visibility: Visibility;
}

/* ============================================================= viewing == */

/**
 * Does deciding this need to know who is asking?
 *
 * Exported so the media route can skip resolving a session — itself a database
 * read — for the public and unlisted keys that are almost all of its traffic.
 * Without it, closing the visibility gap would have made every public video's
 * playback pay for a session lookup it never uses, which is the one thing the
 * brief for this work ruled out.
 */
export function needsViewerIdentity(resource: VisibleResource): boolean {
  return resource.visibility === "private";
}

/**
 * May this viewer be served these bytes?
 *
 * `viewerId` is `null` for a signed-out caller. See the header for why
 * `unlisted` and `public` are the same answer here and why `private` is not.
 */
export function mayViewMedia(
  resource: VisibleResource,
  viewerId: string | null,
): boolean {
  switch (resource.visibility) {
    case "public":
    case "unlisted":
      return true;
    case "private":
      // Before answering, not after: a `true` returned in a deployment where
      // the bytes are also served from a public bucket is not the permission
      // it looks like. See below.
      assertPrivateMediaIsEnforceable();
      return viewerId !== null && viewerId === resource.ownerId;
  }
}

/* ============================================================= writing == */

/**
 * May this caller obtain a write grant for these bytes?
 *
 * Visibility is not consulted and must not become part of this rule: a public
 * video's segments are no more writable by a stranger than a private one's.
 * The parameter type says so — this takes an {@link OwnedResource}, which has
 * no `visibility` to read.
 *
 * There is no "not signed in yet, but the row does not exist so nobody is
 * harmed" branch, and that absence is the answer to the not-yet-created video.
 * A video row is written before its segments are — `videos.upload_status`
 * starts at `uploading` precisely so that a row can exist long before the
 * video is playable — so the id being uploaded to always names a row by the
 * time a target is asked for. Permitting a grant for an id with no row would
 * mean any signed-in account could write bytes under any id it liked, and
 * claim the key before the real upload ever ran. The caller resolves the row
 * first and refuses when there is none.
 */
export function mayWriteMedia(
  resource: OwnedResource,
  viewerId: string | null,
): boolean {
  return viewerId !== null && viewerId === resource.ownerId;
}

/* =============================================== the R2 public-URL case == */

export class PrivateMediaNotEnforceableError extends Error {
  constructor() {
    super(
      "This deployment cannot enforce private video visibility: " +
        "R2_PUBLIC_BASE_URL puts the bucket behind a public domain, so a " +
        "private video's segments are served from an origin no route " +
        "handler is in the path of. Either unset R2_PUBLIC_BASE_URL and let " +
        "/api/media serve the bytes, or stop offering private visibility.",
    );
    this.name = "PrivateMediaNotEnforceableError";
  }
}

/**
 * Refuse to pretend.
 *
 * Once R2 is given a public base URL, `signedUrl(key, { method: "GET" })`
 * returns `${R2_PUBLIC_BASE_URL}/${key}` and the browser fetches segments
 * straight from Cloudflare. That is the entire economic argument for R2 and it
 * is the right default — and it means the check `mayViewMedia` performs is
 * decorative for that deployment, because the bytes have a second door with no
 * lock on it. A decorative check is worse than an absent one: it produces a
 * false belief, and the storage slice's note at the media seam already said so
 * in a comment. This is that comment made executable.
 *
 * **Why here and not at boot.** A boot-time refusal was the first choice and is
 * the wrong one twice over. It would have to live in `config/env.ts`, which
 * this slice does not own; and it would refuse a perfectly sound
 * public-bucket deployment that happens to host only public videos, because
 * nothing at boot knows whether a private video exists. Throwing at the moment
 * a private video is actually resolved fires exactly when the invariant is
 * violated in fact rather than in principle, and leaves public and unlisted
 * playback — the traffic — untouched.
 *
 * **Why a throw and not a refusal.** Returning `false` was the other candidate:
 * it would keep the 404 uniform and preserve the byte-identical property. It
 * would also hide the video from its own owner while the world went on reading
 * it from the bucket, which is the worst of both outcomes and would present as
 * "private videos are broken" rather than as "this deployment is
 * misconfigured". A 500 with the sentence above in it is read by somebody; a
 * silent 404 is filed as a bug in the player.
 *
 * The enumeration argument against a distinguishable response does not apply
 * in this configuration: the object is already public at the bucket's domain,
 * so there is nothing left for a 500 to disclose.
 */
export function assertPrivateMediaIsEnforceable(): void {
  const { blobDriver, env } = config();
  // Only R2 reads `R2_PUBLIC_BASE_URL`; a stray one under the filesystem
  // driver is inert, and treating it as a fault would fail a development run
  // over a variable nothing is using.
  if (blobDriver === "r2" && env.R2_PUBLIC_BASE_URL) {
    throw new PrivateMediaNotEnforceableError();
  }
}
