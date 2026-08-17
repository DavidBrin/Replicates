import { z } from "zod";

import {
  CACHE_CONTROL_NONE,
  blobStore,
  isWritableBlobKey,
} from "@/adapters/blob";
import { guessContentType } from "@/adapters/blob/filesystem";
import { mediaAccess } from "@/adapters/repositories/media-access";
import { currentViewerId, mayWriteMedia } from "@/lib/auth/guard";

/**
 * Ask where to upload one object, and get back somewhere that works.
 *
 * This endpoint exists because of a single finding in research §5.3: Vercel
 * caps a function's *request body* at 4.5 MB, the cap lives in the ingress
 * layer before any code runs, and Vercel documents it as "an
 * infrastructure-level restriction that cannot be bypassed by changing
 * application code settings" — streaming the read does not help, because the
 * bytes are refused before the function is invoked. Segments cross that ceiling
 * routinely and the progressive fallback file is ~190 MB (§1.2). So in
 * production the browser must `PUT` straight to R2 on a presigned URL.
 *
 * And in development it cannot: the filesystem adapter has no separate storage
 * origin to sign against, so `signedUrl()` returns `null` by design. Neither
 * path can be the only one, and the difference is not something the client can
 * infer — which is why this is a request rather than a constant. The client
 * asks for a target and is told both *where* to send the bytes and *exactly
 * which headers* to send with them.
 *
 * The `headers` field in the response is load-bearing, not documentation.
 * §2.3: a presigned PUT's signature covers the content type, and if the
 * uploading request's own header differs by so much as a parameter R2 answers
 * `403 SignatureDoesNotMatch` — an error the browser's JS cannot even read,
 * because R2's 403s arrive without CORS headers attached. Returning the header
 * set alongside the URL removes the client's opportunity to guess.
 *
 * ---
 *
 * **What this route enforces.**
 *
 * Three things, in this order, and the order is the design:
 *
 * 1. **Shape** — the key is syntactically a key and inside a namespace this app
 *    owns (`videos/…` or `channels/…`). It goes first because it reads only the
 *    caller's own request and so discloses nothing, and because it keeps a
 *    session lookup off a request that could never have succeeded.
 * 2. **Identity** — 401 for a caller with no session. This is the gap the
 *    storage slice left open here: without it, anyone who could reach this
 *    endpoint held a 15-minute write grant for any key under `videos/` or
 *    `channels/`, including one already holding a published segment. That is
 *    an unauthenticated write primitive against the object store, and it is
 *    now closed.
 * 3. **Ownership** — the key's video or channel is resolved and the caller must
 *    own the channel behind it.
 *
 * A caller who owns nothing gets the **same 404 as a key naming a row that does
 * not exist**, not a 403, for the reason `/api/media` gives: a 403 confirms the
 * id names something. The one distinguishable answer is the 401, and it
 * discloses nothing because it is returned before anything is looked up, for
 * every key equally.
 *
 * **The video that does not exist yet.** A row precedes its segments —
 * `videos.upload_status` starts at `uploading` exactly so a video can exist
 * long before it is playable — so by the time anyone asks for a target, the id
 * names a row. The permissive reading ("no row, so nobody is harmed, issue the
 * grant") would let any signed-in account write bytes under any id it invented
 * and squat the key the real upload was going to use. So: no row, no grant.
 * The create-video step is what mints the id, and it is the only thing that
 * does.
 *
 * The lookup is deliberately the *uncached* one. A write grant is more
 * consequential than a read and is asked for once per object rather than once
 * every two seconds, so there is nothing to amortise and no reason to accept a
 * stale answer about who owns an id.
 */
export const runtime = "nodejs";

const RequestBody = z.object({
  key: z.string().min(1).max(1024),
  /**
   * Optional, and inferred from the extension when absent — but whatever is
   * decided here is what the client is told to send, so the two can never
   * disagree.
   */
  contentType: z.string().min(1).max(255).optional(),
  /** §3.1: "short-lived (minutes, not the 7-day max)"; adapters clamp. */
  expiresIn: z.number().int().positive().max(604_800).optional(),
});

/**
 * Not exported: a Route Handler module may only export handlers and the
 * framework's own config keys, and Next's generated type check rejects
 * anything else. The shape is the contract regardless — it is what the JSON
 * body is, spelled out in one place.
 */
type UploadTarget =
  | {
      readonly mode: "direct";
      readonly key: string;
      readonly url: string;
      readonly method: "PUT";
      readonly headers: Readonly<Record<string, string>>;
      readonly expiresIn: number;
    }
  | {
      readonly mode: "proxy";
      readonly key: string;
      readonly url: string;
      readonly method: "PUT";
      readonly headers: Readonly<Record<string, string>>;
    };

/** §3.1's "minutes, not the 7-day max", stated once so both paths agree. */
const DEFAULT_EXPIRES_IN = 900;

export async function POST(request: Request): Promise<Response> {
  const parsed = RequestBody.safeParse(await readJson(request));
  if (!parsed.success) {
    return json(400, { error: "Expected { key, contentType?, expiresIn? }." });
  }

  const { key } = parsed.data;
  if (!isWritableBlobKey(key)) {
    return json(400, { error: "Not a writable media key." });
  }

  const viewer = await currentViewerId(request);
  if (!viewer) return json(401, { error: "Sign in to upload." });

  // `null` covers both "no such row" and "a key shape this app does not write",
  // and the answer is the same for both — see the header.
  const subject = await (await mediaAccess()).subjectForKey(key);
  if (!subject || !mayWriteMedia(subject, viewer)) {
    return json(404, { error: "No such video or channel." });
  }

  const contentType = parsed.data.contentType ?? guessContentType(key);
  const expiresIn = parsed.data.expiresIn ?? DEFAULT_EXPIRES_IN;
  const store = await blobStore();

  const signed = await store.signedUrl(key, {
    method: "PUT",
    expiresIn,
    contentType,
  });

  /**
   * `null` is not a failure — it is the filesystem adapter saying it cannot be
   * written to except through us. The client's code path is the same either
   * way: `PUT` to `url` with `headers`.
   */
  if (signed === null) {
    const target: UploadTarget = {
      mode: "proxy",
      key,
      url: `/api/upload/blob/${key.split("/").map(encodeURIComponent).join("/")}`,
      method: "PUT",
      headers: { "Content-Type": contentType },
    };
    return json(200, target);
  }

  const target: UploadTarget = {
    mode: "direct",
    key,
    url: signed,
    method: "PUT",
    headers: { "Content-Type": contentType },
    expiresIn,
  };
  return json(200, target);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // A signed URL is minted per request and expires; caching one anywhere
      // hands a later caller a grant that was issued to someone else.
      "Cache-Control": CACHE_CONTROL_NONE,
    },
  });
}
