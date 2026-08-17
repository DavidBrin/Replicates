import "server-only";

import { config } from "@/config/env";
import type { BlobKey, BlobStore } from "@/ports/blob-store";

/**
 * The one blob store, chosen by configuration and memoised for the process.
 *
 * Memoised on a promise rather than a value for the same reason
 * `adapters/db/index.ts` is: two requests arriving before the first has
 * finished constructing would otherwise each build their own, and the R2
 * adapter's `S3Client` carries a connection pool that is worth having exactly
 * one of.
 *
 * Both adapters are imported dynamically. `@aws-sdk/client-s3` is declared in
 * `serverExternalPackages`, and a static import here would pull it into every
 * route's server bundle including the ones a filesystem-backed development run
 * never touches.
 */
let instance: Promise<BlobStore> | null = null;

export function blobStore(): Promise<BlobStore> {
  instance ??= create();
  return instance;
}

async function create(): Promise<BlobStore> {
  const { blobDriver, env } = config();

  if (blobDriver === "r2") {
    const { createR2BlobStore } = await import("./r2");
    // Non-null: `config()` refuses to resolve with `blobDriver === "r2"` and
    // any of these unset, so the assertion is checked, just not by the type.
    return createR2BlobStore({
      accountId: env.R2_ACCOUNT_ID!,
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      bucket: env.R2_BUCKET!,
      publicBaseUrl: env.R2_PUBLIC_BASE_URL,
    });
  }

  const { FilesystemBlobStore } = await import("./filesystem");
  return new FilesystemBlobStore(env.BLOB_FS_ROOT);
}

/** Tests only: forget the memoised store so a new environment takes effect. */
export function resetBlobStoreForTests(): void {
  instance = null;
}

/* ----------------------------------------------------------------- keys --- */

/** R2's ceiling, and a bound worth having on anything derived from a URL. */
const MAX_KEY_BYTES = 1024;

/** `.` and `..` are directory operators, never a segment of a blob key. */
const RESERVED_SEGMENTS = new Set([".", ".."]);

/**
 * Build a key from the path segments of a URL, or `null` if the URL is not
 * naming a key.
 *
 * It lives beside the store rather than in either route that needs it because
 * it is a statement about the key namespace, not about HTTP — `BlobKey` is
 * documented as "slash-separated, no leading slash", and this is that sentence
 * made executable. Two routes take a key from a URL and both must agree; one
 * copy each is one refactor away from disagreeing.
 *
 * **The bypass this exists to close.** A catch-all route hands back one array
 * element per literal `/` in the path, already percent-decoded. So a segment
 * containing a slash can only have arrived as `%2F` — a client describing a key
 * that does not correspond to the URL it requested — and a segment equal to
 * `..` can arrive as `..` or as `%2e%2e`, identically, because decoding happens
 * before we see it. Rejecting on the decoded segments catches both spellings,
 * and refusing embedded separators means there is no way to reassemble a
 * traversal after this function has approved the pieces.
 *
 * `FilesystemBlobStore` refuses an escaping key as well, by comparing resolved
 * paths. That is deliberate duplication: this layer decides what a key may
 * look like, that one decides what a path may point at, and neither is trusted
 * to be the only one.
 */
export function blobKeyFromSegments(
  segments: readonly string[] | undefined,
): BlobKey | null {
  if (!segments || segments.length === 0) return null;

  for (const segment of segments) {
    if (segment.length === 0) return null;
    if (RESERVED_SEGMENTS.has(segment)) return null;
    // A separator inside one segment can only have arrived percent-encoded,
    // which is a client describing a key its own URL does not spell.
    if (segment.includes("/") || segment.includes("\\")) return null;
    // A NUL truncates a path in every syscall that takes one, and no other
    // control character belongs in a key either.
    for (const character of segment) {
      const code = character.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return null;
    }
  }

  const key = segments.join("/");
  return Buffer.byteLength(key, "utf8") <= MAX_KEY_BYTES ? key : null;
}

/** `{videos|channels}/{id}/{rest}`, matching the key layout in §7. */
const WRITABLE_NAMESPACE =
  /^(videos|channels)\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._/-]{1,256}$/;

/**
 * Whether a client may be handed a write target for this key.
 *
 * This is *shape*, not authorisation. It stops a target being issued for a
 * namespace nothing in this app owns; it says nothing about whether the caller
 * owns the video. See the note in `src/app/api/upload/target/route.ts` for what
 * that costs and who owes it.
 *
 * The segment check is not decoration on top of the pattern — it is the load
 * bearing half. The namespace pattern alone accepts `videos/v1/../../etc`,
 * because `.` and `/` are both legal in a filename and the pattern cannot tell
 * a dot in `seg-00001.m4s` from a dot in `..`. Deferring to
 * `blobKeyFromSegments` means the two entry points that take a key from a
 * client — this one from a JSON body, the other from a URL path — enforce the
 * same rule, rather than one of them having its own weaker copy.
 */
export function isWritableBlobKey(key: BlobKey): boolean {
  if (blobKeyFromSegments(key.split("/")) !== key) return false;
  return WRITABLE_NAMESPACE.test(key);
}

/* ------------------------------------------------------------- caching --- */

/**
 * Research §6. A segment, an init segment, a thumbnail and the progressive
 * fallback are written once at a key and never rewritten (§7.1), so there is no
 * revalidation that could ever return anything different.
 *
 * `immutable` is the load-bearing half, not `max-age`: it is what suppresses
 * the conditional request browsers otherwise send on a user-triggered reload
 * regardless of freshness. On R2 behind a custom domain that is also what keeps
 * Class B read operations near the unique-object count instead of scaling with
 * view count — §1.3's caveat, and the difference between $24/month and $7,355
 * at the scale §1.3 models.
 *
 * A year is not a measurement; it is the ceiling browsers and CDNs treat as
 * forever.
 */
export const CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Research §6, the "playlist before finalization" row.
 *
 * A *finalized* VOD playlist is as immutable as a segment, and callers that
 * know an upload is complete say so by passing `immutable: true`. Nothing on
 * the delivery path knows that: whether a manifest is final lives in Postgres,
 * behind a slice this one does not own. So the inferred default for a playlist
 * is the conservative branch — cacheable, briefly, with a background refresh.
 *
 * The asymmetry is deliberate and cheap. Caching an in-progress manifest for a
 * year is a video that stays broken until the cache expires; not caching a
 * finalized one costs 2 origin hits out of the 53 requests a view makes (§1.2),
 * and the segments — all the actual bytes — still cache forever.
 *
 * **Assumed, not measured:** §6's worked example for this case is
 * `max-age=2, stale-while-revalidate=10`, sized for a status endpoint polled in
 * a tight loop. A playlist is fetched twice per view, so the same shape with a
 * longer window trades no correctness for far fewer origin hits.
 */
export const CACHE_CONTROL_REVALIDATE =
  "public, max-age=5, stale-while-revalidate=60";

/** Nothing servable should be cached: a 404 here often means "not yet". */
export const CACHE_CONTROL_NONE = "no-store";

const MANIFEST_EXTENSIONS = new Set(["m3u8", "mpd"]);

/**
 * The caching policy for a key, inferred from what the key is.
 *
 * It lives here rather than in the route that serves it because the R2 adapter
 * stamps the same value onto the object at upload time. When R2 is fronted by a
 * custom domain the browser never reaches our route at all and reads the stored
 * header instead — so if the two disagreed, a video would cache differently
 * depending on which driver was deployed, which is the kind of difference that
 * only shows up in production.
 */
export function cacheControlForKey(key: BlobKey): string {
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  return MANIFEST_EXTENSIONS.has(extension)
    ? CACHE_CONTROL_REVALIDATE
    : CACHE_CONTROL_IMMUTABLE;
}
