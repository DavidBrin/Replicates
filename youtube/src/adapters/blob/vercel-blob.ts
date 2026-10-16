import "server-only";

import {
  BlobNotFoundError as VercelBlobNotFoundError,
  del,
  head,
  issueSignedToken,
  list,
  presignUrl,
  put,
} from "@vercel/blob";

import {
  BlobNotFoundError,
  BlobRangeNotSatisfiableError,
  type BlobGetOptions,
  type BlobKey,
  type BlobListOptions,
  type BlobListResult,
  type BlobMetadata,
  type BlobPutOptions,
  type BlobReadResult,
  type BlobStore,
  type SignedUrlOptions,
} from "@/ports/blob-store";
import { formatRangeHeader, parseContentRange } from "@/lib/http/range";

import { guessContentType } from "./filesystem";
import { cacheControlForKey } from "./index";

/**
 * Vercel Blob, for the deployment this repository actually has (D21).
 *
 * The store is **public**: every object has a stable URL on the store's own
 * host, and that URL is what `signedUrl` hands the player for a `GET`. The
 * bytes therefore never pass through a function — the half of D14's argument
 * that is about architecture rather than price — and a shared cache can hold
 * them, because the URL never changes.
 *
 * Reads go over plain HTTP to that host, so `Range`, `If-Range` and `ETag` are
 * the CDN's own and the media route's semantics are unchanged. Writes, `HEAD`,
 * listing and deletion go through the SDK with the read-write token. `PUT`
 * targets are presigned in two SDK calls (a signed token, then a URL), which is
 * what keeps `/api/upload/target`'s direct mode working here.
 *
 * Two things the port promises that the SDK does not hand back for free: a
 * `put` result carries no size and no validator, so `put` costs one extra
 * `HEAD`; and `Cache-Control` is max-age only with a 60-second floor, so a
 * manifest that D14 caches for five seconds is cached for a minute here.
 */

/** The slice of the SDK this adapter calls. Injectable, so a test needs no store. */
export interface VercelBlobClient {
  put: typeof put;
  head: typeof head;
  del: typeof del;
  list: typeof list;
  issueSignedToken: typeof issueSignedToken;
  presignUrl: typeof presignUrl;
}

export interface VercelBlobStoreOptions {
  /** The store's read-write token (`vercel_blob_rw_<store>_…`). */
  readonly token: string;
  /**
   * Where the public URLs live. Derived from the token's store id when absent;
   * set it for a custom domain in front of the store.
   */
  readonly publicBaseUrl?: string;
  /** Injected by tests; production uses the SDK. */
  readonly client?: VercelBlobClient;
  /** Injected by tests; production uses the global `fetch`. */
  readonly fetch?: typeof fetch;
}

/**
 * The public host of a store, from its token.
 *
 * A read-write token is `vercel_blob_rw_<storeId>_<secret>`, and a public
 * store serves from `<storeId>.public.blob.vercel-storage.com` with the id
 * lowercased. The secret is never read, only skipped.
 */
export function publicBaseUrlFromToken(token: string): string {
  const storeId = /^vercel_blob_rw_([A-Za-z0-9]+)_[A-Za-z0-9]+$/.exec(token)?.[1];
  if (!storeId) {
    throw new TypeError(
      "BLOB_READ_WRITE_TOKEN is not a Vercel Blob read-write token " +
        "(expected vercel_blob_rw_<store>_<secret>); set BLOB_PUBLIC_BASE_URL " +
        "if the store's host cannot be derived from it.",
    );
  }
  return `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

export function createVercelBlobStore(
  options: VercelBlobStoreOptions,
): VercelBlobStore {
  return new VercelBlobStore(options);
}

/* -------------------------------------------------------------- the store - */

export class VercelBlobStore implements BlobStore {
  private readonly token: string;
  private readonly client: VercelBlobClient;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: VercelBlobStoreOptions) {
    this.token = options.token;
    this.client = options.client ?? { put, head, del, list, issueSignedToken, presignUrl };
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = (
      options.publicBaseUrl ?? publicBaseUrlFromToken(options.token)
    ).replace(/\/+$/, "");
  }

  /** The public URL of a key. Stable, cacheable, readable by anyone who has it. */
  urlFor(key: BlobKey): string {
    return `${this.baseUrl}/${encodePath(key)}`;
  }

  async put(
    key: BlobKey,
    body: ReadableStream<Uint8Array> | Uint8Array,
    options: BlobPutOptions,
  ): Promise<BlobMetadata> {
    const isBytes = body instanceof Uint8Array;

    await this.client.put(
      key,
      isBytes ? Buffer.from(body.buffer, body.byteOffset, body.byteLength) : body,
      {
        access: "public",
        token: this.token,
        // The key *is* the pathname: a random suffix would make every URL
        // unpredictable and `urlFor` impossible, and the port's keys are
        // write-once by design (§7), so overwriting is the documented contract.
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: options.contentType,
        cacheControlMaxAge: maxAgeFor(key, options.immutable === true),
        // A stream of unknown length can only go up in parts. Bytes go whole.
        multipart: !isBytes,
      },
    );

    // The SDK's put result carries neither a size nor a validator, and the
    // port promises both. One `HEAD`, on a path that is a seed or an upload
    // through us rather than the player's hot path.
    const stored = await this.head(key);
    return { ...stored, contentType: options.contentType };
  }

  async head(key: BlobKey): Promise<BlobMetadata> {
    try {
      const result = await this.client.head(this.urlFor(key), { token: this.token });
      return {
        key,
        size: result.size,
        contentType: result.contentType || guessContentType(key),
        etag: result.etag,
        lastModified: result.uploadedAt,
      };
    } catch (error) {
      if (error instanceof VercelBlobNotFoundError) throw new BlobNotFoundError(key);
      throw error;
    }
  }

  async get(key: BlobKey, options?: BlobGetOptions): Promise<BlobReadResult> {
    const range = options?.range;
    const ifRange = options?.ifRange;

    let response = await this.fetchObject(key, range, ifRange);

    /**
     * `If-Range` is the CDN's to honour, and a mismatch is answered with the
     * whole object as RFC 9110 §13.1.5 requires. The check below is for a CDN
     * that ignored the header and served the range anyway: the same re-fetch
     * the R2 adapter does, for the same reason — splicing two encodings is the
     * one outcome worse than an extra request.
     */
    if (range && ifRange && response.status === 206) {
      const etag = response.headers.get("etag");
      if (etag !== null && etag !== ifRange) {
        await discard(response);
        response = await this.fetchObject(key, undefined, undefined);
      }
    }

    const body = response.body;
    if (!body) throw new BlobNotFoundError(key);

    const contentRange =
      response.status === 206
        ? parseContentRange(response.headers.get("content-range") ?? undefined)
        : undefined;
    const totalSize =
      contentRange?.total ?? Number(response.headers.get("content-length") ?? 0);

    const metadata: BlobMetadata = {
      key,
      size: totalSize,
      contentType: response.headers.get("content-type") ?? guessContentType(key),
      etag: response.headers.get("etag") ?? "",
      lastModified: new Date(response.headers.get("last-modified") ?? 0),
    };

    return {
      body: body as ReadableStream<Uint8Array>,
      metadata,
      ...(contentRange
        ? {
            range: {
              start: contentRange.start,
              end: contentRange.end,
              total: contentRange.total,
            },
          }
        : {}),
    };
  }

  private async fetchObject(
    key: BlobKey,
    range: BlobGetOptions["range"],
    ifRange: string | undefined,
  ): Promise<Response> {
    const headers = new Headers();
    if (range) headers.set("range", formatRangeHeader(range));
    if (ifRange) headers.set("if-range", ifRange);

    const response = await this.fetchImpl(this.urlFor(key), { headers });

    if (response.status === 404) {
      await discard(response);
      throw new BlobNotFoundError(key);
    }
    if (response.status === 416) {
      // A 416 states the size in `Content-Range: bytes */N` (§4.1); fall back
      // to a HEAD only if this CDN left it out.
      const stated = /bytes \*\/(\d+)/.exec(response.headers.get("content-range") ?? "");
      await discard(response);
      const size = stated ? Number(stated[1]) : (await this.head(key)).size;
      throw new BlobRangeNotSatisfiableError(key, range ?? { start: 0 }, size);
    }
    if (response.status !== 200 && response.status !== 206) {
      await discard(response);
      throw new Error(`Vercel Blob answered HTTP ${response.status} for ${key}`);
    }
    return response;
  }

  async delete(key: BlobKey): Promise<void> {
    try {
      await this.client.del(this.urlFor(key), { token: this.token });
    } catch (error) {
      // The SDK already treats a missing blob as deleted; the guard is for a
      // version that stops doing so.
      if (error instanceof VercelBlobNotFoundError) return;
      throw error;
    }
  }

  /**
   * Keys under a prefix, following the cursor until the caller's limit is
   * filled — the same loop as the R2 adapter, for the same reason: a page is
   * at most 1000 keys and a ladder for a long video passes that.
   */
  async list(prefix: string, options?: BlobListOptions): Promise<BlobListResult> {
    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    if (limit <= 0) return { objects: [] };

    const objects: BlobMetadata[] = [];
    let cursor = options?.cursor;

    for (;;) {
      const page = await this.client.list({
        prefix,
        cursor,
        limit: Math.min(MAX_KEYS_PER_CALL, limit - objects.length),
        token: this.token,
      });

      for (const blob of page.blobs) {
        objects.push({
          key: blob.pathname,
          size: blob.size,
          // A listing carries no content type; the key layout (§7) makes the
          // extension sufficient, exactly as for R2.
          contentType: guessContentType(blob.pathname),
          etag: blob.etag,
          lastModified: blob.uploadedAt,
        });
      }

      const next = page.cursor;
      if (!page.hasMore || !next || next === cursor) return { objects };
      cursor = next;
      if (objects.length >= limit) return { objects, cursor };
    }
  }

  /**
   * `GET` is the public URL: permanent, cacheable, and readable by anyone who
   * holds it — the same trade R2 with a public base URL makes, and the same
   * caveat about private videos applies (see `lib/auth/guard.ts`).
   *
   * `PUT` is presigned by the SDK: a signed token scoped to this one pathname
   * and content type, then a URL carrying it. The uploading request sends the
   * body with the matching `Content-Type`, which is what `/api/upload/target`
   * already tells the client to do.
   */
  async signedUrl(key: BlobKey, options?: SignedUrlOptions): Promise<string | null> {
    const method = options?.method ?? "GET";
    if (method === "GET") return this.urlFor(key);

    if (!options?.contentType) {
      throw new TypeError(
        `A presigned PUT for ${key} needs contentType: the signed token is ` +
          "scoped to it and the upload's own header must match it.",
      );
    }

    const validUntil =
      Date.now() + clampExpiry(options.expiresIn ?? DEFAULT_EXPIRES_IN) * 1000;

    const signed = await this.client.issueSignedToken({
      token: this.token,
      pathname: key,
      operations: ["put"],
      validUntil,
      allowedContentTypes: [options.contentType],
    });
    const { presignedUrl } = await this.client.presignUrl(signed, {
      operation: "put",
      pathname: key,
      access: "public",
      validUntil,
      allowedContentTypes: [options.contentType],
      allowOverwrite: true,
      addRandomSuffix: false,
      cacheControlMaxAge: maxAgeFor(key, false),
    });
    return presignedUrl;
  }
}

/* ---------------------------------------------------------------- helpers - */

/**
 * The store's one caching knob, derived from the port's policy. `immutable`
 * and every non-manifest key get a year; a manifest gets the policy's
 * `max-age` raised to the store's 60-second floor.
 */
export function maxAgeFor(key: BlobKey, immutable: boolean): number {
  if (immutable) return ONE_YEAR;
  const match = /max-age=(\d+)/.exec(cacheControlForKey(key));
  const seconds = match ? Number(match[1]) : ONE_YEAR;
  return Math.max(MIN_MAX_AGE, seconds);
}

/** Encode a slash-separated key, keeping the separators as separators. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** 1 second to 7 days, the same window the R2 adapter allows. */
function clampExpiry(seconds: number): number {
  return Math.min(Math.max(Math.floor(seconds), 1), MAX_EXPIRES_IN);
}

/** Release a body we are not going to read, so its connection returns to the pool. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed or already closed; nothing is held either way.
  }
}

/* -------------------------------------------------------------- constants - */

const ONE_YEAR = 31_536_000;
/** Vercel Blob rejects a `cacheControlMaxAge` below one minute. */
const MIN_MAX_AGE = 60;
const MAX_EXPIRES_IN = 604_800;
/** Fifteen minutes, matching the R2 adapter's reasoning. */
const DEFAULT_EXPIRES_IN = 900;
/** What one `list` call returns at most. */
const MAX_KEYS_PER_CALL = 1000;
/** Matched to the other adapters so cursors behave alike. */
const DEFAULT_LIST_LIMIT = 1000;
