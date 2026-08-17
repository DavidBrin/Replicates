/**
 * Where the bytes live.
 *
 * This is the port that exists before there is anything to swap into it, and
 * that is deliberate. Every other project in this repository stores kilobytes
 * of rows; this one stores a rendition ladder per video, and egress is a real
 * line item for the first time. The whole point of encoding in the uploader's
 * browser is that the server never transcodes — so the server's entire job on
 * the media path is to accept opaque byte ranges and hand them back. That job
 * is small enough to state completely, which is what makes it a port rather
 * than an abstraction over a vendor.
 *
 * Two adapters ship:
 *
 * - **filesystem** — writes under `.data/blobs`. The development and test
 *   default; no account, no network, no credentials.
 * - **r2** — Cloudflare R2 over the S3 API. Chosen over S3 for one reason:
 *   zero egress fees. A video platform's cost curve is egress, not storage,
 *   and R2 is the only major object store that does not charge for it.
 *
 * One environment variable moves between them, and nothing above this file
 * knows which is in use.
 */

/** A key in the store. Slash-separated, no leading slash. */
export type BlobKey = string;

/**
 * A half-open byte range, `[start, end]` inclusive at both ends — the HTTP
 * convention, not the JavaScript one, because every caller of this is either
 * parsing or emitting a `Range` header and a translation in the middle is
 * exactly where an off-by-one hides.
 *
 * `end` may be omitted to mean "to the end of the object".
 */
export interface ByteRange {
  readonly start: number;
  readonly end?: number;
}

/** What a store knows about an object without reading it. */
export interface BlobMetadata {
  readonly key: BlobKey;
  readonly size: number;
  readonly contentType: string;
  /** Strong validator, used for `If-Range` and cache revalidation. */
  readonly etag: string;
  readonly lastModified: Date;
}

/** The result of a read. `body` is a stream — segments are not small. */
export interface BlobReadResult {
  readonly body: ReadableStream<Uint8Array>;
  readonly metadata: BlobMetadata;
  /**
   * Present when the read was ranged, describing what was actually returned.
   * A store is permitted to return less than asked for; the route handler
   * echoes *this*, not the requested range, into `Content-Range`.
   */
  readonly range?: { start: number; end: number; total: number };
}

export interface BlobPutOptions {
  readonly contentType: string;
  /**
   * Required when `body` is a stream.
   *
   * The filesystem adapter does not need this and an earlier version of this
   * port therefore did not have it — which would have worked in development
   * and failed in production, because a non-multipart S3 `PutObject` requires
   * `Content-Length` up front and cannot derive it from a stream it has not
   * finished reading. Making it part of the contract means the caller is
   * forced to know the length at the moment it can still cheaply find out.
   */
  readonly contentLength?: number;
  /**
   * `immutable` marks content that can never change under this key. Every
   * media and init segment qualifies: a rendition is written once during an
   * upload and never rewritten. The adapter turns it into a long-lived
   * `Cache-Control`, and a CDN in front of it then never revalidates.
   */
  readonly immutable?: boolean;
}

export interface BlobGetOptions {
  readonly range?: ByteRange;
  /**
   * RFC 9110 §13.1.5. When the entity has changed since the client last saw
   * it, the range is meaningless and the whole object must be returned
   * instead — a player resuming a partially-buffered segment across a
   * redeploy is exactly this case, and honouring the range regardless would
   * splice two different encodings together.
   */
  readonly ifRange?: string;
}

export interface BlobListOptions {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface BlobListResult {
  readonly objects: readonly BlobMetadata[];
  /** Present when more remain. Pass back as `cursor`. */
  readonly cursor?: string;
}

export interface SignedUrlOptions {
  readonly method?: "GET" | "PUT";
  /** Seconds. Adapters clamp to their backend's maximum (R2/S3: 604800). */
  readonly expiresIn?: number;
  /**
   * Required for a PUT URL, and it becomes part of the signature — the
   * uploading request's own `Content-Type` header must match this exactly or
   * the storage backend rejects it with an opaque signature error.
   */
  readonly contentType?: string;
}

export interface BlobStore {
  /**
   * Store bytes. Overwrites. Accepts a stream so that a 40 MB upload is never
   * resident in the server's memory — the fallback path uploads whole source
   * files, and buffering one of those is how a serverless function dies.
   */
  put(
    key: BlobKey,
    body: ReadableStream<Uint8Array> | Uint8Array,
    options: BlobPutOptions,
  ): Promise<BlobMetadata>;

  /** Read, optionally a range. Rejects with {@link BlobNotFoundError}. */
  get(key: BlobKey, options?: BlobGetOptions): Promise<BlobReadResult>;

  /** Metadata only. Rejects with {@link BlobNotFoundError}. */
  head(key: BlobKey): Promise<BlobMetadata>;

  /** Idempotent: deleting an absent key succeeds. */
  delete(key: BlobKey): Promise<void>;

  /**
   * Keys under a prefix, paginated.
   *
   * Paginated because `ListObjectsV2` is: it returns at most 1000 keys and a
   * continuation token, and an adapter that ignored the token would silently
   * return a truncated ladder. A six-rung ladder for a long video passes 1000
   * segments easily, so "delete this video" would have left most of it behind
   * — and the filesystem adapter, which has no such limit, would never have
   * shown the bug.
   */
  list(prefix: string, options?: BlobListOptions): Promise<BlobListResult>;

  /**
   * A URL the *browser* can use directly, or `null` when the adapter cannot
   * serve without going through us.
   *
   * This is the one method that leaks the adapter's nature upward, and it does
   * so on purpose. The filesystem adapter returns `null`, and the player then
   * fetches segments through a route handler; the R2 adapter returns a public
   * or presigned URL and the bytes never touch our server at all. That is the
   * difference between paying for egress twice and paying for it once, and it
   * is too important to hide behind an interface that pretends both adapters
   * are the same shape.
   *
   * With `method: "PUT"` it is an upload URL, which is how a browser sends a
   * segment straight to storage instead of through us.
   */
  signedUrl(
    key: BlobKey,
    options?: SignedUrlOptions,
  ): Promise<string | null>;
}

export class BlobNotFoundError extends Error {
  constructor(readonly key: BlobKey) {
    super(`No blob at key: ${key}`);
    this.name = "BlobNotFoundError";
  }
}

export class BlobRangeNotSatisfiableError extends Error {
  constructor(
    readonly key: BlobKey,
    readonly requested: ByteRange,
    readonly size: number,
  ) {
    super(
      `Range ${requested.start}-${requested.end ?? ""} not satisfiable for ${key} (size ${size})`,
    );
    this.name = "BlobRangeNotSatisfiableError";
  }
}

/* ------------------------------------------------------------- key layout - */

/**
 * Keys are structural, not content-addressed.
 *
 * A content hash would make every key immutable and cacheable forever, which
 * is genuinely attractive. It also makes "delete this video" a query rather
 * than a prefix scan, and makes a half-finished upload unrecoverable — you
 * cannot resume what you cannot name. The ladder is already immutable in
 * practice because a rendition is written once and never rewritten, so the
 * caching benefit is available without the cost.
 */
export const blobKeys = {
  /** The fMP4 initialisation segment for one rung of the ladder. */
  init: (videoId: string, rendition: string): BlobKey =>
    `videos/${videoId}/${rendition}/init.mp4`,

  /** One media segment. Zero-padded so lexical order is numeric order. */
  segment: (videoId: string, rendition: string, index: number): BlobKey =>
    `videos/${videoId}/${rendition}/seg-${String(index).padStart(5, "0")}.m4s`,

  /** The per-rendition HLS media playlist. */
  mediaPlaylist: (videoId: string, rendition: string): BlobKey =>
    `videos/${videoId}/${rendition}/index.m3u8`,

  /** The HLS master playlist naming every rung. */
  masterPlaylist: (videoId: string): BlobKey =>
    `videos/${videoId}/master.m3u8`,

  /**
   * The untranscoded source, for the no-WebCodecs fallback only. Served whole
   * over `Range`; never segmented, never laddered.
   */
  progressive: (videoId: string, extension: string): BlobKey =>
    `videos/${videoId}/source.${extension}`,

  thumbnail: (videoId: string, variant: string): BlobKey =>
    `videos/${videoId}/thumb-${variant}.jpg`,

  /** The animated hover preview: a handful of seconds, no audio. */
  preview: (videoId: string): BlobKey => `videos/${videoId}/preview.mp4`,

  /**
   * A caption track.
   *
   * **`source` is part of the key, and it has to be.** This took only the
   * language, which reads as sufficient until you look at what the schema
   * permits: `captions` is unique on `(video_id, language, source)`, so an
   * English track a creator uploaded and an English one the recogniser produced
   * are two legitimate rows for one video — and they were two rows pointing at
   * one blob key, where the second write silently replaced the first. The CC
   * menu would then offer both and play the same file for either.
   *
   * `automatic` rather than `auto` in the path because it is the column's own
   * value, so the key can be read back to the row it belongs to without a
   * lookup table of abbreviations.
   */
  captions: (
    videoId: string,
    language: string,
    source: "uploaded" | "automatic" = "uploaded",
  ): BlobKey => `videos/${videoId}/captions-${source}-${language}.vtt`,

  avatar: (channelId: string): BlobKey => `channels/${channelId}/avatar.jpg`,

  banner: (channelId: string): BlobKey => `channels/${channelId}/banner.jpg`,

  /** Everything belonging to one video, for deletion. */
  videoPrefix: (videoId: string): string => `videos/${videoId}/`,
} as const;
