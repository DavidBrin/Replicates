import { config } from "@/config/env";
import {
  CACHE_CONTROL_NONE,
  blobKeyFromSegments,
  blobStore,
  isWritableBlobKey,
} from "@/adapters/blob";
import {
  contentTypeForKey,
  declaredTypeMatchesKey,
} from "@/adapters/blob/content-types";
import { mediaAccess } from "@/adapters/repositories/media-access";
import { currentViewerId, mayWriteMedia } from "@/lib/auth/guard";

/**
 * Receive an upload for one key — the other half of `/api/upload/target`.
 *
 * This is the `mode: "proxy"` destination, and it exists for exactly one
 * configuration: a blob store that cannot issue a signed URL, which today means
 * the filesystem adapter and therefore means development and the test suite.
 * It is not a fallback for R2 and must never become one, because the thing it
 * would be falling back *to* is the path research §5.3 rules out: Vercel
 * refuses a request body over 4.5 MB at the ingress layer, before this function
 * runs, and streaming the read does not exempt it. A 6-second 1080p segment can
 * exceed that on its own; the progressive fallback file (~190 MB, §1.2) exceeds
 * it by two orders of magnitude.
 *
 * So the driver check below is not defensive tidiness. If R2 is configured and
 * something still routes an upload through here, the honest answer is that this
 * endpoint does not exist — because in that configuration it does not work, and
 * a 404 is a much faster diagnosis than a 413 that only appears on Vercel and
 * only above a size threshold.
 *
 * ---
 *
 * **What this route enforces.** Exactly what `/api/upload/target` does, in the
 * same order and for the same reasons: driver, then shape (400), then identity
 * (401), then ownership (404). The gate matters more here than there, because
 * this endpoint writes the bytes rather than handing out permission to — a
 * target that was never issued is inert, whereas an unauthorised `PUT` that
 * reaches this handler has already overwritten a published segment by the time
 * anyone could notice.
 *
 * The driver check stays first. Answering 401 in a configuration where this
 * endpoint does not exist would be a worse diagnosis than the 404, and it would
 * also be a lie: signing in would not make it work.
 */
export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  if (config().blobDriver !== "filesystem") {
    return json(404, { error: "No such endpoint." });
  }

  const { key: segments } = await context.params;
  const key = blobKeyFromSegments(segments);
  if (!key || !isWritableBlobKey(key)) {
    return json(400, { error: "Not a writable media key." });
  }

  const viewer = await currentViewerId(request);
  if (!viewer) return json(401, { error: "Sign in to upload." });

  const subject = await (await mediaAccess()).subjectForKey(key);
  if (!subject || !mayWriteMedia(subject, viewer)) {
    return json(404, { error: "No such video or channel." });
  }

  /**
   * Derived from the key, never taken from the request.
   *
   * This line used to read `request.headers.get("content-type") ?? guess(key)`,
   * which let an authenticated uploader store `text/html` under a key they own
   * and have `/api/media/…` serve it back as a document on this origin, with
   * the viewer's session cookie attached. See `adapters/blob/content-types.ts`.
   *
   * A declared type is still *checked* — a client that disagrees with the
   * derivation is confused about what it is uploading and is better told so
   * than silently corrected, because the mismatch usually means the file
   * picker and the key have drifted apart.
   */
  const contentType = contentTypeForKey(key);
  if (contentType === null) {
    return json(415, { error: "That key names no storable media type." });
  }
  const declared = request.headers.get("content-type");
  if (declared !== null && !declaredTypeMatchesKey(key, declared)) {
    return json(415, {
      error: `This key stores ${contentType}, not ${declared}.`,
    });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  const store = await blobStore();

  /**
   * A `PUT` with no body is a zero-byte object, not an error — that is what the
   * verb means. `request.body` is `null` for an empty body rather than an empty
   * stream, so the two cases are separated here instead of downstream.
   */
  const body = request.body ?? new Uint8Array();

  const metadata = await store.put(key, body as ReadableStream<Uint8Array>, {
    contentType,
    /**
     * Only when the client actually declared one. The port requires a length
     * for a stream because a non-multipart S3 `PutObject` sends it up front;
     * the filesystem adapter does not need it, and passing `NaN` from an absent
     * header would be worse than passing nothing.
     */
    ...(Number.isSafeInteger(declaredLength) && declaredLength >= 0
      ? { contentLength: declaredLength }
      : {}),
    /**
     * §6 / §7.1: every key in this scheme is written once and never rewritten,
     * so the object may be cached forever. The one exception is a playlist that
     * is not final yet, and `cacheControlForKey` already gives those the
     * revalidating policy — which is why this passes the fact rather than the
     * policy.
     */
    immutable: !key.endsWith(".m3u8") && !key.endsWith(".mpd"),
  });

  return json(201, {
    key: metadata.key,
    size: metadata.size,
    etag: metadata.etag,
    contentType: metadata.contentType,
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": CACHE_CONTROL_NONE,
    },
  });
}
