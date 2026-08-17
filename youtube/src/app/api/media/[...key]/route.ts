import {
  BlobNotFoundError,
  BlobRangeNotSatisfiableError,
  type ByteRange,
} from "@/ports/blob-store";
import {
  CACHE_CONTROL_NONE,
  blobKeyFromSegments,
  blobStore,
  cacheControlForKey,
} from "@/adapters/blob";
import {
  formatContentRange,
  formatUnsatisfiedContentRange,
  parseRangeHeader,
  rangeLength,
  resolveRangeHeader,
} from "@/lib/http/range";
import { mediaAccess } from "@/adapters/repositories/media-access";
import {
  currentViewerId,
  mayViewMedia,
  needsViewerIdentity,
} from "@/lib/auth/guard";

/**
 * Serve one blob, with byte ranges.
 *
 * This is the media path for the filesystem driver, and the fallback for R2
 * when there is no public domain in front of the bucket. In the configuration
 * that matters economically it is *not* on the hot path at all: R2 behind a
 * custom domain hands the browser a URL and the bytes never reach this process
 * (research §1.3, §2.3). It still has to be exactly right, because it is the
 * only media path in development and because §4.2 makes clear that a range
 * response which is slightly wrong does not degrade — Safari simply refuses to
 * play, with no error anyone can see.
 *
 * `HEAD` is not exported. Next's App Router implements it by calling `GET` and
 * letting the HTTP layer drop the body — verified in
 * `next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js`,
 * which assigns `methods.HEAD = handlers.GET`. That is the behaviour §4.2 wants
 * anyway: Safari's probe expects `Accept-Ranges` and `Content-Length` from a
 * `HEAD` to agree with what a `GET` would report, and deriving one from the
 * other is the only way they cannot drift.
 *
 * ---
 *
 * **What this route enforces.**
 *
 * First, that the key is well-formed and cannot escape the store (see
 * `blobKeyFromSegments`, and the resolved-path check inside
 * `FilesystemBlobStore` behind it).
 *
 * Second — and this was the gap the storage slice left open at exactly this
 * seam — **visibility**. The key is reversed to the video or channel that owns
 * it (`mediaOwnerFromKey`), that row's visibility and owner are resolved, and
 * a private video is served only to the user who owns its channel. A key that
 * names no shape this application writes, or whose row is not there, is
 * refused rather than served: the fall-through is closed in the direction of
 * refusing.
 *
 * The refusal is a **404 identical to the one a key nothing was ever written
 * to produces** — same status, same body, same headers — because a 403 would
 * confirm that the id names something, which is the one thing an unguessable
 * id was protecting. The suite asserts the two responses are
 * indistinguishable, since a property like that decays the moment nothing
 * checks it.
 *
 * `unlisted` is served to anyone, like `public`, and `lib/auth/guard.ts`
 * carries the argument for why that is the design rather than a hole: an
 * unlisted video is a capability URL by definition, and gating its segments on
 * a session would break the only thing unlisted is for without making it any
 * more private.
 *
 * **Cost.** The lookup is cached per video for a few seconds
 * (`MEDIA_ACCESS_CACHE_TTL_MS`), so a public video's playback pays one indexed
 * read per video rather than one per segment — a player fetches a segment every
 * couple of seconds and §1.2 puts a view at ~53 requests. Resolving the
 * session is skipped entirely unless the video is private, which is the only
 * visibility that needs to know who is asking; public playback therefore costs
 * no session read at all. `media-access.ts` states what the cache costs in
 * exchange, which is that making a video private takes effect within one TTL
 * rather than instantly.
 *
 * The R2 caveat the storage slice named is now executable rather than
 * advisory: with a public base URL in front of the bucket the bytes are served
 * from a domain this process is not in the path of, so
 * `assertPrivateMediaIsEnforceable` refuses to answer for a private video in
 * that configuration instead of returning a permission that means nothing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key: segments } = await context.params;
  const key = blobKeyFromSegments(segments);
  if (!key) return refuse(400, "Not a media key.");

  /**
   * The visibility gate, before `blobStore()` is touched — which is where the
   * storage slice said the seam was.
   *
   * Both refusals below are the same `refuse(404, …)` the missing-object path
   * uses at the bottom of this handler, and they have to stay that way: two
   * spellings of "no" that differ by a header are an enumeration oracle, and
   * the suite compares the responses byte for byte.
   *
   * `needsViewerIdentity` is what keeps this off the hot path. Resolving a
   * session is a database read of its own, and a public video never needs one
   * — so the only playback that pays for identity is the playback whose answer
   * depends on it.
   */
  const subject = await (await mediaAccess()).cachedSubjectForKey(key);
  if (!subject) return refuse(404, "No such media.");

  const viewer = needsViewerIdentity(subject)
    ? await currentViewerId(request)
    : null;
  if (!mayViewMedia(subject, viewer)) return refuse(404, "No such media.");

  const store = await blobStore();
  const rangeHeader = request.headers.get("range");
  const ifRange = request.headers.get("if-range") ?? undefined;

  try {
    const requested = await requestedRange(rangeHeader, () =>
      store.head(key).then((metadata) => metadata.size),
    );
    if (requested.kind === "unsatisfiable") {
      return unsatisfiable(requested.totalSize);
    }

    const result = await store.get(key, {
      ...(requested.kind === "range" ? { range: requested.range } : {}),
      ...(ifRange ? { ifRange } : {}),
    });

    const { metadata } = result;
    const headers = new Headers({
      "Content-Type": metadata.contentType,
      // §4.1: on *every* response, not only the partial ones. Its absence is
      // what tells a client that ranges are unavailable, and §4.2 is why that
      // matters more than it sounds.
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControlForKey(key),
      "Last-Modified": metadata.lastModified.toUTCString(),
    });

    // Only when there is one. An empty `ETag:` is not "no validator", it is a
    // validator equal to the empty string, and a cache that compares it against
    // the next response's would match two different objects.
    if (metadata.etag) headers.set("ETag", metadata.etag);

    /**
     * `result.range`, not the range that was asked for. The store is allowed to
     * return less than requested, and — for `If-Range` — to ignore the range
     * entirely and hand back the whole object. Echoing the request instead of
     * the result is how a response ends up declaring a length it does not send.
     */
    if (!result.range) {
      headers.set("Content-Length", String(metadata.size));
      return new Response(result.body, { status: 200, headers });
    }

    headers.set(
      "Content-Range",
      formatContentRange(result.range, result.range.total),
    );
    headers.set("Content-Length", String(rangeLength(result.range)));
    return new Response(result.body, { status: 206, headers });
  } catch (error) {
    if (error instanceof BlobRangeNotSatisfiableError) {
      return unsatisfiable(error.size);
    }
    if (error instanceof BlobNotFoundError) {
      return refuse(404, "No such media.");
    }
    throw error;
  }
}

type Requested =
  | { readonly kind: "whole" }
  | { readonly kind: "range"; readonly range: ByteRange }
  | { readonly kind: "unsatisfiable"; readonly totalSize: number };

/**
 * Turn the `Range` header into what the store should be asked for.
 *
 * The shape here is about round trips. A single bounded range (`bytes=0-499`,
 * `bytes=500-`) is passed straight through, because the store resolves it
 * against a size it has to look up anyway — one request, which across Safari's
 * window-by-window fetching is the difference between one call per ~4 MB and
 * two (§4.2).
 *
 * A suffix range (`bytes=-500`) cannot be written in absolute offsets without
 * the size, and picking between several ranges needs the size to know which are
 * satisfiable. Those two cases pay for a metadata read; nothing else does.
 */
async function requestedRange(
  header: string | null,
  sizeOf: () => Promise<number>,
): Promise<Requested> {
  const specs = parseRangeHeader(header);
  // Absent or malformed. §14.2: ignore it and serve the whole object — a 400
  // here would break the client that sent it and every proxy in between.
  if (!specs) return { kind: "whole" };

  const only = specs.length === 1 ? specs[0] : undefined;
  if (only?.kind === "bounded") {
    return {
      kind: "range",
      range:
        only.end === undefined
          ? { start: only.start }
          : { start: only.start, end: only.end },
    };
  }

  const totalSize = await sizeOf();
  const outcome = resolveRangeHeader(header, totalSize);
  if (outcome.kind === "unsatisfiable") {
    return { kind: "unsatisfiable", totalSize };
  }
  if (outcome.kind === "whole") return { kind: "whole" };
  return { kind: "range", range: outcome.range };
}

/**
 * §15.5.17. `Content-Range: bytes * /<size>` is required, not decorative: it is
 * how the client learns the real size and can reissue a range that works.
 */
function unsatisfiable(totalSize: number): Response {
  return new Response(null, {
    status: 416,
    headers: {
      "Content-Range": formatUnsatisfiedContentRange(totalSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": CACHE_CONTROL_NONE,
    },
  });
}

/**
 * `no-store` on the failures. A 404 here usually means "not finalised yet"
 * rather than "never", and a cached one outlives the upload that fixes it.
 */
function refuse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": CACHE_CONTROL_NONE,
    },
  });
}
