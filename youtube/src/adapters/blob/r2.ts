import "server-only";

import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type DeleteObjectCommandOutput,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type ListObjectsV2CommandOutput,
  type PutObjectCommandOutput,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

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
import {
  formatRangeHeader,
  parseContentRange,
} from "@/lib/http/range";

import { guessContentType } from "./filesystem";
import { CACHE_CONTROL_IMMUTABLE, cacheControlForKey } from "./index";

/**
 * Cloudflare R2 over the S3 API.
 *
 * R2 is chosen for exactly one property: egress is free. Research §1.3 prices
 * the same catalog and traffic four ways — at 1,000,000 views/month R2 costs
 * ~$24 and S3+CloudFront ~$7,355, a gap that does not exist at toy scale
 * because CloudFront's 1 TB free tier hides it. Storage and request pricing are
 * the same order of magnitude everywhere; transfer is the whole decision.
 *
 * What that buys structurally is more interesting than the money: because R2
 * can hand a browser a URL, segments never pass through our server at all — and
 * on Vercel they could not, since a 4.5 MB request body cap sits in the ingress
 * layer *before* any function runs and streaming does not exempt it (§5.3).
 * That single limit is why {@link R2BlobStore.signedUrl} is on the hot path
 * rather than being a convenience.
 */

/* ------------------------------------------------------------- the client - */

/**
 * The slice of `S3Client` this adapter uses.
 *
 * Declared as overloads rather than taking the concrete `S3Client` so a test
 * can hand in a hand-written fake — which is the only way to exercise the
 * pagination loop below without either credentials or a network. A real
 * `S3Client` satisfies this structurally, so there is no wrapper in between
 * that could drift from the thing it wraps.
 *
 * Note what this deliberately does *not* abstract: the command objects are the
 * SDK's own. That keeps every field name (`ContinuationToken` and not
 * `NextContinuationToken`, `MaxKeys` and not `Limit`) under the type checker
 * rather than under a mapping layer that a fake would happily agree with while
 * production disagreed.
 */
export interface S3Like {
  send(command: PutObjectCommand): Promise<PutObjectCommandOutput>;
  send(command: GetObjectCommand): Promise<GetObjectCommandOutput>;
  send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput>;
  send(command: DeleteObjectCommand): Promise<DeleteObjectCommandOutput>;
  send(command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput>;
}

export interface R2Credentials {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface R2BlobStoreOptions extends R2Credentials {
  readonly bucket: string;
  /**
   * A custom domain in front of the bucket. Present means `signedUrl` can
   * return a plain, permanently cacheable URL instead of a signed one; absent
   * means every read URL is presigned and therefore uncacheable by a shared
   * cache. §2.3: `r2.dev` is explicitly non-production — rate limited, 429s
   * under load, and no caching controls at all, which is what makes the
   * immutable policy above worthless there.
   */
  readonly publicBaseUrl?: string;
  /** Injected by tests; production builds one from {@link r2ClientConfig}. */
  readonly client?: S3Like;
}

/** The endpoint R2 signs against. Account-scoped, not bucket-scoped. */
export function r2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/**
 * The `S3Client` configuration R2 requires.
 *
 * Separate from the client so it can be asserted without constructing one. Two
 * of these four settings are not preferences:
 *
 * - **`requestChecksumCalculation` / `responseChecksumValidation`.** From
 *   `@aws-sdk/client-s3` v3.729.0 the SDK began attaching
 *   `x-amz-checksum-crc32` to every `PutObject` and validating checksums on
 *   every `GetObject` by default. R2 does not implement CRC32 and rejects the
 *   header outright with `NotImplemented`. This broke production uploads for
 *   people who bumped a *minor* version with no code change (§2.3). Pinned
 *   explicitly rather than left to the default, because the default has already
 *   moved underneath people once.
 * - **`region: "auto"`.** Required by the SDK, ignored by R2 — but it is also
 *   the literal string that goes into the SigV4 credential scope, so it has to
 *   match what {@link presignR2Url} signs or the signature does not validate.
 *
 * `forcePathStyle` is a choice rather than a requirement: R2 accepts both
 * shapes, and pinning to `/{bucket}/{key}` means the SDK's URLs and the ones
 * this file signs by hand are the same shape. A bucket name containing a dot
 * also breaks virtual-host TLS, which is a failure nobody diagnoses quickly.
 */
export function r2ClientConfig(credentials: R2Credentials): S3ClientConfig {
  return {
    region: R2_REGION,
    endpoint: r2Endpoint(credentials.accountId),
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
}

export function createR2BlobStore(options: R2BlobStoreOptions): R2BlobStore {
  return new R2BlobStore(options);
}

/* -------------------------------------------------------------- the store - */

export class R2BlobStore implements BlobStore {
  private readonly client: S3Like;
  private readonly bucket: string;
  private readonly credentials: R2Credentials;
  private readonly publicBaseUrl: string | undefined;

  constructor(options: R2BlobStoreOptions) {
    this.client = options.client ?? new S3Client(r2ClientConfig(options));
    this.bucket = options.bucket;
    this.credentials = options;
    this.publicBaseUrl = options.publicBaseUrl?.replace(/\/+$/, "");
  }

  async put(
    key: BlobKey,
    body: ReadableStream<Uint8Array> | Uint8Array,
    options: BlobPutOptions,
  ): Promise<BlobMetadata> {
    const isBytes = body instanceof Uint8Array;
    const contentLength = isBytes ? body.byteLength : options.contentLength;

    /**
     * A non-multipart `PutObject` sends `Content-Length` in the request that
     * opens the upload, so it cannot be derived from a stream that has not been
     * read yet. The alternative — buffering the stream to measure it — is how a
     * serverless function dies on the progressive fallback file, which §1.2
     * sizes at ~190 MB. Refusing here names the problem at the call site
     * instead of letting the SDK fail on an unrelated-looking error.
     */
    if (contentLength === undefined) {
      throw new TypeError(
        `Streaming put of ${key} needs contentLength: S3 PutObject sends ` +
          "Content-Length up front and cannot measure an unread stream.",
      );
    }

    const output = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: isBytes ? body : Readable.fromWeb(body as NodeWebStream),
        ContentType: options.contentType,
        ContentLength: contentLength,
        CacheControl:
          options.immutable === true
            ? CACHE_CONTROL_IMMUTABLE
            : cacheControlForKey(key),
      }),
    );

    return {
      key,
      size: contentLength,
      contentType: options.contentType,
      etag: output.ETag ?? "",
      lastModified: new Date(),
    };
  }

  async head(key: BlobKey): Promise<BlobMetadata> {
    try {
      const output = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        size: output.ContentLength ?? 0,
        contentType: output.ContentType ?? guessContentType(key),
        etag: output.ETag ?? "",
        lastModified: output.LastModified ?? new Date(0),
      };
    } catch (error) {
      if (isNotFound(error)) throw new BlobNotFoundError(key);
      throw error;
    }
  }

  async get(key: BlobKey, options?: BlobGetOptions): Promise<BlobReadResult> {
    const range = options?.range;

    let output = await this.getObject(key, range);

    /**
     * `If-Range` (RFC 9110 §13.1.5), implemented here rather than delegated.
     *
     * **The surprise:** the S3 API models `If-Match`, `If-None-Match` and
     * `Range`, but not `If-Range` — `GetObjectCommandInput` has no field for
     * it, so there is nothing to forward. `If-Match` is not a substitute: it
     * answers a mismatch with 412, where §13.1.5 requires the *whole* object.
     *
     * So: ask for the range optimistically, compare the validator on the way
     * back, and re-fetch unranged only when it moved. §4.1 notes that for
     * write-once keys the validator never changes after publish, which makes
     * the mismatch branch nearly dead and a pre-flight `HeadObject` on every
     * ranged read pure cost. The first body is cancelled rather than dropped,
     * because an unread response body holds its connection open.
     */
    if (
      range &&
      options?.ifRange &&
      output.ETag !== undefined &&
      output.ETag !== options.ifRange
    ) {
      await discard(output.Body);
      output = await this.getObject(key, undefined);
    }

    const body = output.Body;
    if (!body) throw new BlobNotFoundError(key);

    const contentRange = parseContentRange(output.ContentRange);
    const totalSize = contentRange?.total ?? output.ContentLength ?? 0;

    const metadata: BlobMetadata = {
      key,
      size: totalSize,
      contentType: output.ContentType ?? guessContentType(key),
      etag: output.ETag ?? "",
      lastModified: output.LastModified ?? new Date(0),
    };

    return {
      body: body.transformToWebStream() as ReadableStream<Uint8Array>,
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

  private async getObject(
    key: BlobKey,
    range: BlobGetOptions["range"],
  ): Promise<GetObjectCommandOutput> {
    try {
      return await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: range ? formatRangeHeader(range) : undefined,
        }),
      );
    } catch (error) {
      if (isNotFound(error)) throw new BlobNotFoundError(key);
      /**
       * 416 arrives as a bare service exception, and this SDK models no field
       * carrying the object's size — which a 416 response is required to state
       * (§4.1) and which the port's error therefore carries. One extra
       * `HeadObject`, on a path that only runs when a client asked for bytes
       * that do not exist, is a fair price for not parsing it back out of the
       * raw response.
       */
      if (httpStatus(error) === 416) {
        const metadata = await this.head(key);
        throw new BlobRangeNotSatisfiableError(
          key,
          range ?? { start: 0 },
          metadata.size,
        );
      }
      throw error;
    }
  }

  async delete(key: BlobKey): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      // S3 and R2 both answer 204 for a key that was never there, so this is
      // already idempotent; the guard is for a backend that disagrees.
      if (isNotFound(error)) return;
      throw error;
    }
  }

  /**
   * Keys under a prefix, following the continuation token until the caller's
   * limit is filled.
   *
   * This loop is the whole reason `list` is paginated in the port.
   * `ListObjectsV2` returns at most 1000 keys per call *regardless of what
   * `MaxKeys` asks for*, and the truncation is signalled rather than raised —
   * an adapter that sent one command and returned `Contents` would look correct
   * in every test and silently drop everything past the thousandth key. The
   * caller of that is `delete this video`: a six-rung ladder passes 1000
   * segments at about 20 minutes of runtime, so the bug's symptom is a deleted
   * video that keeps billing for the storage nobody can see.
   *
   * The filesystem adapter, which has no such limit, would never have shown it.
   */
  async list(
    prefix: string,
    options?: BlobListOptions,
  ): Promise<BlobListResult> {
    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    if (limit <= 0) return { objects: [] };

    const objects: BlobMetadata[] = [];
    let cursor = options?.cursor;

    for (;;) {
      const output: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: cursor,
          MaxKeys: Math.min(MAX_KEYS_PER_CALL, limit - objects.length),
        }),
      );

      for (const object of output.Contents ?? []) {
        if (object.Key === undefined) continue;
        objects.push({
          key: object.Key,
          size: object.Size ?? 0,
          // `ListObjectsV2` does not return content types — S3 does not carry
          // them in a listing at all. Inferred from the extension, which is
          // exactly what the key layout (§7) was designed to make possible.
          contentType: guessContentType(object.Key),
          etag: object.ETag ?? "",
          lastModified: object.LastModified ?? new Date(0),
        });
      }

      const next = output.NextContinuationToken;
      // `next === cursor` cannot happen against R2 or S3, both of which always
      // advance. It is guarded anyway because the failure mode if one ever did
      // not is a request that never returns.
      if (output.IsTruncated !== true || !next || next === cursor) {
        return { objects };
      }
      cursor = next;
      if (objects.length >= limit) return { objects, cursor };
    }
  }

  /**
   * A URL the browser uses directly.
   *
   * `GET` prefers the public custom domain when one is configured: it is
   * cacheable by every shared cache between us and the viewer, where a
   * presigned URL is unique per issue and therefore cacheable by nobody. That
   * is the difference §6 describes between R2 read operations tracking the
   * unique-object count and tracking the view count.
   *
   * **What a public base URL costs, stated plainly:** a key under it is
   * readable by anyone who knows the key. Nothing in this adapter enforces a
   * video's visibility, and nothing can once the bytes are served from a domain
   * we are not in the path of. Private and unlisted videos need either an
   * unguessable key component or presigned reads with a short expiry, and that
   * decision belongs to whichever slice owns video visibility — not here. See
   * the same note in `src/app/api/media/[...key]/route.ts`.
   */
  async signedUrl(
    key: BlobKey,
    options?: SignedUrlOptions,
  ): Promise<string | null> {
    const method = options?.method ?? "GET";

    if (method === "GET" && this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${encodePath(key)}`;
    }

    /**
     * §2.3: the content type is part of the signature, and the uploading
     * request must send it byte-identically or R2 answers 403
     * `SignatureDoesNotMatch` — an error the browser cannot even read, because
     * a 403 from R2 arrives without CORS headers attached. Guessing a default
     * here would produce exactly that failure at a distance, so a PUT URL
     * without a stated content type is refused at the call site instead.
     */
    if (method === "PUT" && !options?.contentType) {
      throw new TypeError(
        `A presigned PUT for ${key} needs contentType: it is part of the ` +
          "signature and the upload's own header must match it exactly.",
      );
    }

    return presignR2Url({
      method,
      credentials: this.credentials,
      bucket: this.bucket,
      key,
      expiresIn: options?.expiresIn ?? DEFAULT_EXPIRES_IN,
      contentType: options?.contentType,
    });
  }
}

/* ---------------------------------------------------------------- signing - */

/**
 * SigV4 query-string presigning, by hand.
 *
 * **Rejected:** `@aws-sdk/s3-request-presigner`, which is the ordinary way to
 * do this and is what §2.3 describes. It is not installed, and `package.json`
 * is shared with five other slices building concurrently — adding a dependency
 * to it is not a change this slice can make safely. The algorithm is a
 * documented HMAC chain and `node:crypto` has every primitive, so the cost of
 * writing it is a page of code and a known-answer test against AWS's own
 * published signing-key vectors (see `__tests__/r2.test.ts`), against which
 * this implementation is checked rather than merely being checked against
 * itself.
 *
 * The R2-specific parts, per §2.3: `region` must be the literal `auto` and the
 * endpoint must be the account-scoped R2 host, or the signature will not
 * validate; expiry runs from 1 second to 7 days.
 */
export interface PresignInput {
  readonly method: "GET" | "PUT";
  readonly credentials: R2Credentials;
  readonly bucket: string;
  readonly key: BlobKey;
  readonly expiresIn: number;
  readonly contentType?: string | undefined;
  /** Injected so the signature is reproducible in a test. */
  readonly now?: Date;
}

export function presignR2Url(input: PresignInput): string {
  const { credentials, bucket, key, method } = input;

  const host = new URL(r2Endpoint(credentials.accountId)).host;
  const canonicalUri = `/${encodePath(bucket)}/${encodePath(key)}`;

  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;

  /**
   * Only headers named here are signed, and every one of them must be present
   * and identical on the request that uses the URL. `host` always; the content
   * type only when the caller stated one, so that a GET URL does not oblige the
   * browser to send a header it has no reason to send.
   */
  const headers: Array<[string, string]> = [["host", host]];
  if (input.contentType) headers.push(["content-type", input.contentType]);
  headers.sort(([a], [b]) => (a < b ? -1 : 1));

  const signedHeaders = headers.map(([name]) => name).join(";");
  const canonicalHeaders =
    headers.map(([name, value]) => `${name}:${value.trim()}`).join("\n") + "\n";

  const query: Array<[string, string]> = [
    ["X-Amz-Algorithm", ALGORITHM],
    ["X-Amz-Credential", `${credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(clampExpiry(input.expiresIn))],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  const canonicalQuery = canonicalQueryString(query);

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    // A presigned URL cannot commit to a body hash: the body does not exist
    // when the URL is issued and the browser supplies it later.
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac(
    "sha256",
    sigv4SigningKey(
      credentials.secretAccessKey,
      dateStamp,
      R2_REGION,
      R2_SERVICE,
    ),
  )
    .update(stringToSign, "utf8")
    .digest("hex");

  return `${r2Endpoint(credentials.accountId)}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * The four-step HMAC chain that derives a signing key from a secret access key.
 *
 * Exported so it can be checked against AWS's published test vectors. Deriving
 * this wrongly produces a signature that is *structurally* perfect and rejected
 * by the server, which is indistinguishable from a wrong secret.
 */
export function sigv4SigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const hmac = (key: Buffer | string, data: string): Buffer =>
    createHmac("sha256", key).update(data, "utf8").digest();

  return hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    "aws4_request",
  );
}

/**
 * RFC 3986 percent-encoding, which is stricter than `encodeURIComponent`.
 *
 * `encodeURIComponent` leaves `!'()*` alone; SigV4's canonical form does not,
 * and a key containing any of them would sign one way and be requested another.
 */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode a slash-separated path, keeping the separators as separators. */
function encodePath(path: string): string {
  return path.split("/").map(encodeRfc3986).join("/");
}

function canonicalQueryString(entries: ReadonlyArray<[string, string]>): string {
  return [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
    .join("&");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** §2.3: 1 second to 7 days, the same ceiling S3 enforces. */
function clampExpiry(seconds: number): number {
  return Math.min(Math.max(Math.floor(seconds), 1), MAX_EXPIRES_IN);
}

/* ----------------------------------------------------------------- errors - */

function metadataOf(error: unknown): { httpStatusCode?: number } | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const meta = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return typeof meta === "object" && meta !== null ? meta : undefined;
}

function httpStatus(error: unknown): number | undefined {
  return metadataOf(error)?.httpStatusCode;
}

/**
 * S3 answers a missing key with `NoSuchKey` on `GetObject` and `NotFound` on
 * `HeadObject` — two names for one condition, because `HeadObject` has no body
 * to put an error document in. The status code is checked as well because R2
 * is S3-compatible rather than S3, and a compatibility layer disagreeing about
 * an error *name* is far more likely than one disagreeing about a 404.
 */
function isNotFound(error: unknown): boolean {
  if (httpStatus(error) === 404) return true;
  const name = (error as { name?: unknown } | null)?.name;
  return name === "NoSuchKey" || name === "NotFound";
}

/**
 * Release a response body we are not going to read. An unconsumed HTTP body
 * keeps its socket checked out of the agent's pool until it times out, so
 * abandoning one per `If-Range` miss is a slow leak rather than an obvious bug.
 */
async function discard(
  body: GetObjectCommandOutput["Body"] | undefined,
): Promise<void> {
  if (!body) return;
  try {
    await body.transformToWebStream().cancel();
  } catch {
    // Already consumed or already destroyed; either way there is nothing held.
  }
}

/* -------------------------------------------------------------- constants - */

const ALGORITHM = "AWS4-HMAC-SHA256";
/** Required by the SDK, ignored by R2, load-bearing in the credential scope. */
const R2_REGION = "auto";
const R2_SERVICE = "s3";
/** §2.3 / §8: R2 and S3 both cap a presigned URL at 7 days. */
const MAX_EXPIRES_IN = 604_800;
/**
 * §3.1: "short-lived (minutes, not the 7-day max)". Fifteen minutes is long
 * enough for one segment upload to retry on a bad connection and short enough
 * that a URL leaking from a client log is not a standing write grant.
 */
const DEFAULT_EXPIRES_IN = 900;
/** What `ListObjectsV2` returns per call whatever `MaxKeys` asks for. */
const MAX_KEYS_PER_CALL = 1000;
/** Matched to the filesystem adapter's default so cursors behave alike. */
const DEFAULT_LIST_LIMIT = 1000;

/**
 * `Readable.fromWeb` is typed against `node:stream/web`'s `ReadableStream`,
 * which is structurally the same object as the global one the port uses and a
 * different declaration to TypeScript. The cast is at this one boundary rather
 * than at every call site.
 */
type NodeWebStream = Parameters<typeof Readable.fromWeb>[0];
