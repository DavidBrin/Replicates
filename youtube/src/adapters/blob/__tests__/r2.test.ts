// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
} from "@aws-sdk/client-s3";

import {
  BlobNotFoundError,
  BlobRangeNotSatisfiableError,
} from "@/ports/blob-store";
import { config, resetConfigForTests } from "@/config/env";
import {
  CACHE_CONTROL_IMMUTABLE,
  CACHE_CONTROL_REVALIDATE,
  blobStore,
  resetBlobStoreForTests,
} from "@/adapters/blob";
import {
  R2BlobStore,
  encodeRfc3986,
  presignR2Url,
  r2ClientConfig,
  r2Endpoint,
  sigv4SigningKey,
  type S3Like,
} from "@/adapters/blob/r2";

/**
 * No network, no credentials, no mocking library.
 *
 * The client is injected, so the fake below is an ordinary object that answers
 * the five commands this adapter sends. That is the only way to exercise the
 * things that actually break against R2 — the `ListObjectsV2` truncation loop,
 * the 416 path, the `If-Range` re-fetch — none of which a live R2 bucket would
 * let you provoke on demand either.
 *
 * The commands themselves are the SDK's real classes, deliberately. A fake that
 * accepted `{ bucket, key }` would agree with any field names this file
 * invented; these ones are checked by the same types production is.
 */

/* ------------------------------------------------------------- the fake --- */

type AnyCommand =
  | PutObjectCommand
  | GetObjectCommand
  | HeadObjectCommand
  | DeleteObjectCommand
  | ListObjectsV2Command;

type AnyOutput =
  | PutObjectCommandOutput
  | GetObjectCommandOutput
  | HeadObjectCommandOutput
  | DeleteObjectCommandOutput
  | ListObjectsV2CommandOutput;

interface StoredObject {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly etag: string;
  readonly lastModified: Date;
}

/** Whether a body handed out by the fake was ever cancelled rather than read. */
interface TrackedStream {
  cancelled: boolean;
}

class FakeS3 implements S3Like {
  readonly sent: AnyCommand[] = [];
  readonly objects = new Map<string, StoredObject>();
  readonly streams: TrackedStream[] = [];

  /** Queued answers for `ListObjectsV2`, consumed one per call. */
  listPages: ListObjectsV2CommandOutput[] = [];
  /** Thrown by the next `send`, whatever it is. */
  failWith: Error | null = null;

  send(command: PutObjectCommand): Promise<PutObjectCommandOutput>;
  send(command: GetObjectCommand): Promise<GetObjectCommandOutput>;
  send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput>;
  send(command: DeleteObjectCommand): Promise<DeleteObjectCommandOutput>;
  send(command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput>;
  async send(command: AnyCommand): Promise<AnyOutput> {
    this.sent.push(command);

    if (this.failWith) {
      const error = this.failWith;
      this.failWith = null;
      throw error;
    }

    if (command instanceof PutObjectCommand) return this.onPut();
    if (command instanceof HeadObjectCommand) return this.onHead(command);
    if (command instanceof GetObjectCommand) return this.onGet(command);
    if (command instanceof DeleteObjectCommand) return { $metadata: {} };
    return this.onList();
  }

  commandsOfType<T extends AnyCommand>(
    type: new (...args: never[]) => T,
  ): T[] {
    return this.sent.filter((c): c is T => c instanceof type);
  }

  private onPut(): PutObjectCommandOutput {
    return { $metadata: {}, ETag: '"put-etag"' };
  }

  private onHead(command: HeadObjectCommand): HeadObjectCommandOutput {
    const stored = this.objects.get(command.input.Key ?? "");
    if (!stored) throw s3Error("NotFound", 404);
    return {
      $metadata: {},
      ContentLength: stored.bytes.byteLength,
      ContentType: stored.contentType,
      ETag: stored.etag,
      LastModified: stored.lastModified,
    };
  }

  private onGet(command: GetObjectCommand): GetObjectCommandOutput {
    const key = command.input.Key ?? "";
    const stored = this.objects.get(key);
    if (!stored) throw s3Error("NoSuchKey", 404);

    const total = stored.bytes.byteLength;
    const requested = command.input.Range;

    if (requested === undefined) {
      return {
        $metadata: {},
        Body: this.streamOf(stored.bytes),
        ContentLength: total,
        ContentType: stored.contentType,
        ETag: stored.etag,
        LastModified: stored.lastModified,
      };
    }

    const match = /^bytes=(\d+)-(\d*)$/.exec(requested);
    if (!match) throw s3Error("InvalidArgument", 400);
    const start = Number(match[1]);
    if (start >= total) throw s3Error("InvalidRange", 416);
    const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;

    return {
      $metadata: {},
      Body: this.streamOf(stored.bytes.slice(start, end + 1)),
      ContentLength: end - start + 1,
      ContentRange: `bytes ${start}-${end}/${total}`,
      ContentType: stored.contentType,
      ETag: stored.etag,
      LastModified: stored.lastModified,
    };
  }

  private onList(): ListObjectsV2CommandOutput {
    const page = this.listPages.shift();
    return page ?? { $metadata: {}, Contents: [], IsTruncated: false };
  }

  /**
   * The SDK types a response body as `SdkStream<Readable>` — a Node stream with
   * three transform helpers bolted on. A web `ReadableStream` carrying the same
   * helpers is what the adapter actually consumes (it calls exactly one of
   * them), so this is the smallest thing that is honest about the interface;
   * the cast is because the two stream *declarations* differ, not the usage.
   */
  private streamOf(bytes: Uint8Array): GetObjectCommandOutput["Body"] {
    const tracked: TrackedStream = { cancelled: false };
    this.streams.push(tracked);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
      cancel() {
        tracked.cancelled = true;
      },
    });

    return Object.assign(stream, {
      transformToByteArray: async () => bytes,
      transformToString: async () => new TextDecoder().decode(bytes),
      transformToWebStream: () => stream,
    }) as unknown as GetObjectCommandOutput["Body"];
  }
}

function s3Error(name: string, httpStatusCode: number): Error {
  return Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode },
  });
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

const CREDENTIALS = {
  accountId: "acct123",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
} as const;

function storeWith(fake: FakeS3, publicBaseUrl?: string): R2BlobStore {
  return new R2BlobStore({
    ...CREDENTIALS,
    bucket: "media",
    client: fake,
    ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
  });
}

let fake: FakeS3;
let store: R2BlobStore;

beforeEach(() => {
  fake = new FakeS3();
  store = storeWith(fake);
});

/* ------------------------------------------------------------- the client - */

describe("r2ClientConfig", () => {
  /**
   * Research §2.3. From `@aws-sdk/client-s3` v3.729.0 the SDK attaches
   * `x-amz-checksum-crc32` to every PutObject by default; R2 does not implement
   * CRC32 and rejects it with `NotImplemented`. The failure arrives on a minor
   * version bump with no code change, so the setting is asserted rather than
   * trusted.
   */
  it("pins checksum behaviour back to opt-in", () => {
    const config = r2ClientConfig(CREDENTIALS);
    expect(config.requestChecksumCalculation).toBe("WHEN_REQUIRED");
    expect(config.responseChecksumValidation).toBe("WHEN_REQUIRED");
  });

  it("points at the account-scoped endpoint with region auto", () => {
    const config = r2ClientConfig(CREDENTIALS);
    expect(config.region).toBe("auto");
    expect(config.endpoint).toBe("https://acct123.r2.cloudflarestorage.com");
    expect(config.forcePathStyle).toBe(true);
  });

  /**
   * Asserting the object's keys only proves this file spelled them the way this
   * file spells them. Constructing a real client and reading the values back
   * through the SDK's own resolved config proves the SDK is the thing that
   * reads them — which is the half of "the setting is applied" that a config
   * literal cannot show. No network: an `S3Client` makes no request until a
   * command is sent.
   */
  it("is a configuration the SDK itself resolves", async () => {
    const client = new S3Client(r2ClientConfig(CREDENTIALS));
    try {
      await expect(client.config.requestChecksumCalculation()).resolves.toBe(
        "WHEN_REQUIRED",
      );
      await expect(client.config.responseChecksumValidation()).resolves.toBe(
        "WHEN_REQUIRED",
      );
      await expect(client.config.region()).resolves.toBe("auto");
      await expect(client.config.forcePathStyle).toBe(true);
    } finally {
      client.destroy();
    }
  });
});

/* ------------------------------------------------------------------- put -- */

describe("put", () => {
  it("sends the bytes with their length and type", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const metadata = await store.put("videos/v1/720p/seg-00001.m4s", bytes, {
      contentType: "video/iso.segment",
      immutable: true,
    });

    const [command] = fake.commandsOfType(PutObjectCommand);
    expect(command?.input.Bucket).toBe("media");
    expect(command?.input.Key).toBe("videos/v1/720p/seg-00001.m4s");
    expect(command?.input.ContentType).toBe("video/iso.segment");
    expect(command?.input.ContentLength).toBe(4);
    expect(command?.input.Body).toBe(bytes);

    expect(metadata.size).toBe(4);
    expect(metadata.etag).toBe('"put-etag"');
  });

  // §6: a segment is written once at its key and never rewritten, so there is
  // no revalidation that could return anything different.
  it("stamps the immutable policy onto an immutable object", async () => {
    await store.put("videos/v1/720p/seg-00001.m4s", new Uint8Array([1]), {
      contentType: "video/iso.segment",
      immutable: true,
    });
    expect(fake.commandsOfType(PutObjectCommand)[0]?.input.CacheControl).toBe(
      CACHE_CONTROL_IMMUTABLE,
    );
  });

  /**
   * The stored header and the header the media route emits come from the same
   * function, because behind a custom domain the browser reads the stored one
   * and never reaches the route at all. If they disagreed, a video would cache
   * differently depending on which driver was deployed.
   */
  it("gives an unfinalised playlist the revalidating policy", async () => {
    await store.put("videos/v1/master.m3u8", new Uint8Array([1]), {
      contentType: "application/vnd.apple.mpegurl",
    });
    expect(fake.commandsOfType(PutObjectCommand)[0]?.input.CacheControl).toBe(
      CACHE_CONTROL_REVALIDATE,
    );
  });

  it("lets a caller that knows an upload is final say so", async () => {
    await store.put("videos/v1/master.m3u8", new Uint8Array([1]), {
      contentType: "application/vnd.apple.mpegurl",
      immutable: true,
    });
    expect(fake.commandsOfType(PutObjectCommand)[0]?.input.CacheControl).toBe(
      CACHE_CONTROL_IMMUTABLE,
    );
  });

  it("streams a body when its length is known", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([7, 7, 7]));
        controller.close();
      },
    });

    await store.put("videos/v1/source.mp4", body, {
      contentType: "video/mp4",
      contentLength: 3,
      immutable: true,
    });

    const command = fake.commandsOfType(PutObjectCommand)[0];
    expect(command?.input.ContentLength).toBe(3);
    // Bridged to a Node stream: the SDK's Node build does not accept a web one.
    expect(typeof (command?.input.Body as { pipe?: unknown })?.pipe).toBe(
      "function",
    );
  });

  /**
   * A non-multipart PutObject sends Content-Length before the body, so it
   * cannot be measured from an unread stream — and buffering a ~190 MB
   * progressive fallback (§1.2) to find out is how the function dies. Failing
   * here names the caller instead.
   */
  it("refuses a stream whose length nobody stated", async () => {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => controller.close(),
    });
    await expect(
      store.put("videos/v1/source.mp4", body, { contentType: "video/mp4" }),
    ).rejects.toThrow(TypeError);
  });
});

/* ------------------------------------------------------------------ head -- */

describe("head", () => {
  it("maps the response onto the port's metadata", async () => {
    fake.objects.set("videos/v1/thumb-hq.jpg", {
      bytes: new Uint8Array(1200),
      contentType: "image/jpeg",
      etag: '"abc"',
      lastModified: new Date("2026-08-16T10:00:00.000Z"),
    });

    await expect(store.head("videos/v1/thumb-hq.jpg")).resolves.toEqual({
      key: "videos/v1/thumb-hq.jpg",
      size: 1200,
      contentType: "image/jpeg",
      etag: '"abc"',
      lastModified: new Date("2026-08-16T10:00:00.000Z"),
    });
  });

  it("turns a 404 into the port's error", async () => {
    await expect(store.head("videos/nope/init.mp4")).rejects.toBeInstanceOf(
      BlobNotFoundError,
    );
  });

  it("lets an unexpected failure through rather than reporting absence", async () => {
    fake.failWith = s3Error("InternalError", 500);
    await expect(store.head("videos/v1/init.mp4")).rejects.toThrow(
      "InternalError",
    );
  });
});

/* ------------------------------------------------------------------- get -- */

describe("get", () => {
  beforeEach(() => {
    fake.objects.set("videos/v1/source.mp4", {
      bytes: new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 256)),
      contentType: "video/mp4",
      etag: '"v1"',
      lastModified: new Date("2026-08-16T10:00:00.000Z"),
    });
  });

  it("reads a whole object", async () => {
    const result = await store.get("videos/v1/source.mp4");
    expect(result.range).toBeUndefined();
    expect(result.metadata.size).toBe(1000);
    expect((await readAll(result.body)).byteLength).toBe(1000);
  });

  /**
   * Research §4.2: Safari opens a source by asking for as little as the first
   * two bytes and discards the source outright if the answer is not a correct
   * partial read. This is that request, at the adapter layer.
   */
  it("answers a two-byte probe with a partial read", async () => {
    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 0, end: 1 },
    });

    expect(
      fake.commandsOfType(GetObjectCommand)[0]?.input.Range,
    ).toBe("bytes=0-1");
    expect(result.range).toEqual({ start: 0, end: 1, total: 1000 });
    expect((await readAll(result.body)).byteLength).toBe(2);
  });

  it("sends an open-ended range with no end position", async () => {
    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 900 },
    });
    expect(fake.commandsOfType(GetObjectCommand)[0]?.input.Range).toBe(
      "bytes=900-",
    );
    expect(result.range).toEqual({ start: 900, end: 999, total: 1000 });
  });

  /**
   * `metadata.size` is the whole object, `range` describes what came back. A
   * partial read that reported `size` as the slice length would make the route
   * emit `Content-Range: bytes 0-1/2` and a player would conclude the video is
   * two bytes long.
   */
  it("reports the object's size, not the slice's, on a partial read", async () => {
    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 10, end: 19 },
    });
    expect(result.metadata.size).toBe(1000);
    expect(result.range?.total).toBe(1000);
  });

  it("turns a 416 into the port's error carrying the real size", async () => {
    const error = await store
      .get("videos/v1/source.mp4", { range: { start: 5000 } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BlobRangeNotSatisfiableError);
    // The size has to come from somewhere: the SDK models no field for it on a
    // 416, so the adapter asks. A 416 without a size is a client that retries
    // the same impossible request forever.
    expect((error as BlobRangeNotSatisfiableError).size).toBe(1000);
    expect(fake.commandsOfType(HeadObjectCommand)).toHaveLength(1);
  });

  it("turns a missing key into the port's error", async () => {
    await expect(store.get("videos/gone/source.mp4")).rejects.toBeInstanceOf(
      BlobNotFoundError,
    );
  });

  /**
   * `If-Range` is not a field the S3 API models — `GetObjectCommandInput` has
   * no place to put it — so the adapter asks for the range optimistically and
   * checks the validator on the way back. A matching validator must cost
   * exactly one request; anything else is a pre-flight HeadObject on every
   * ranged read, which for a Safari playback session is one per ~4 MB window.
   */
  it("costs one request when If-Range matches", async () => {
    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 0, end: 99 },
      ifRange: '"v1"',
    });

    expect(fake.commandsOfType(GetObjectCommand)).toHaveLength(1);
    expect(result.range).toEqual({ start: 0, end: 99, total: 1000 });
  });

  /**
   * RFC 9110 §13.1.5: when the validator has moved, the range is meaningless
   * and the whole representation is the required answer — not a 412, and
   * certainly not a 206 spliced from a different encoding.
   */
  it("re-reads the whole object when If-Range no longer matches", async () => {
    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 0, end: 99 },
      ifRange: '"stale"',
    });

    const gets = fake.commandsOfType(GetObjectCommand);
    expect(gets).toHaveLength(2);
    expect(gets[0]?.input.Range).toBe("bytes=0-99");
    expect(gets[1]?.input.Range).toBeUndefined();
    expect(result.range).toBeUndefined();
    expect((await readAll(result.body)).byteLength).toBe(1000);
  });

  // An abandoned response body holds its socket out of the pool until it times
  // out, so the discarded first read has to be cancelled, not dropped.
  it("cancels the body it abandoned on an If-Range miss", async () => {
    await store.get("videos/v1/source.mp4", {
      range: { start: 0, end: 99 },
      ifRange: '"stale"',
    });
    expect(fake.streams[0]?.cancelled).toBe(true);
    expect(fake.streams[1]?.cancelled).toBe(false);
  });

  it("ignores If-Range when no range was asked for", async () => {
    await store.get("videos/v1/source.mp4", { ifRange: '"stale"' });
    expect(fake.commandsOfType(GetObjectCommand)).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- delete -- */

describe("delete", () => {
  it("sends a delete for the key", async () => {
    await store.delete("videos/v1/720p/seg-00001.m4s");
    expect(fake.commandsOfType(DeleteObjectCommand)[0]?.input).toMatchObject({
      Bucket: "media",
      Key: "videos/v1/720p/seg-00001.m4s",
    });
  });

  it("is idempotent when the key was never there", async () => {
    fake.failWith = s3Error("NoSuchKey", 404);
    await expect(store.delete("videos/v1/gone.m4s")).resolves.toBeUndefined();
  });

  it("does not swallow a real failure", async () => {
    fake.failWith = s3Error("AccessDenied", 403);
    await expect(store.delete("videos/v1/x.m4s")).rejects.toThrow(
      "AccessDenied",
    );
  });
});

/* ------------------------------------------------------------------ list -- */

function page(
  keys: readonly string[],
  next?: string,
): ListObjectsV2CommandOutput {
  return {
    $metadata: {},
    Contents: keys.map((Key) => ({
      Key,
      Size: 100,
      ETag: `"${Key}"`,
      LastModified: new Date("2026-08-16T10:00:00.000Z"),
    })),
    IsTruncated: next !== undefined,
    ...(next === undefined ? {} : { NextContinuationToken: next }),
  };
}

function keysNamed(prefix: string, count: number, from = 0): string[] {
  return Array.from(
    { length: count },
    (_, i) => `${prefix}seg-${String(from + i).padStart(5, "0")}.m4s`,
  );
}

describe("list", () => {
  /**
   * The bug the port's comment warns about, reproduced.
   *
   * `ListObjectsV2` returns at most 1000 keys per call however many `MaxKeys`
   * asks for, and signals the rest with a continuation token rather than an
   * error. An adapter that sent one command and returned `Contents` would pass
   * every small test and silently lose everything past the thousandth key — and
   * its caller is "delete this video", so the symptom is a deleted video that
   * keeps billing for storage nobody can see.
   */
  it("follows the continuation token past a single page", async () => {
    const prefix = "videos/v1/720p/";
    fake.listPages = [
      page(keysNamed(prefix, 1000, 0), "token-1"),
      page(keysNamed(prefix, 1000, 1000), "token-2"),
      page(keysNamed(prefix, 500, 2000)),
    ];

    const result = await store.list(prefix, { limit: 3000 });

    expect(result.objects).toHaveLength(2500);
    expect(result.cursor).toBeUndefined();
    expect(fake.commandsOfType(ListObjectsV2Command)).toHaveLength(3);
  });

  it("passes the continuation token back on each subsequent call", async () => {
    const prefix = "videos/v1/720p/";
    fake.listPages = [
      page(keysNamed(prefix, 1000, 0), "token-1"),
      page(keysNamed(prefix, 10, 1000)),
    ];

    await store.list(prefix, { limit: 3000 });

    const calls = fake.commandsOfType(ListObjectsV2Command);
    expect(calls[0]?.input.ContinuationToken).toBeUndefined();
    expect(calls[1]?.input.ContinuationToken).toBe("token-1");
    expect(calls.every((c) => c.input.Prefix === prefix)).toBe(true);
  });

  it("never asks for more than a call can return", async () => {
    fake.listPages = [page(keysNamed("videos/v1/", 1000), "t"), page([])];
    await store.list("videos/v1/", { limit: 5000 });
    expect(
      fake.commandsOfType(ListObjectsV2Command).every(
        (c) => (c.input.MaxKeys ?? 0) <= 1000,
      ),
    ).toBe(true);
  });

  it("asks only for what it still needs", async () => {
    fake.listPages = [page(keysNamed("videos/v1/", 600), "t"), page([])];
    await store.list("videos/v1/", { limit: 700 });
    const calls = fake.commandsOfType(ListObjectsV2Command);
    expect(calls[0]?.input.MaxKeys).toBe(700);
    expect(calls[1]?.input.MaxKeys).toBe(100);
  });

  it("returns a cursor when it stopped at the caller's limit", async () => {
    fake.listPages = [page(keysNamed("videos/v1/", 10), "more")];
    const result = await store.list("videos/v1/", { limit: 10 });
    expect(result.objects).toHaveLength(10);
    expect(result.cursor).toBe("more");
  });

  it("omits the cursor when the listing is exhausted", async () => {
    fake.listPages = [page(keysNamed("videos/v1/", 10))];
    const result = await store.list("videos/v1/", { limit: 10 });
    expect(result.cursor).toBeUndefined();
  });

  /**
   * A truncated page with no contents is legal — every key in it can be
   * filtered out server-side — and a loop that treats "no results" as "done"
   * stops early on exactly the listing that needed it most.
   */
  it("keeps following a truncated page that returned nothing", async () => {
    fake.listPages = [
      page([], "token-1"),
      page(keysNamed("videos/v1/", 3, 0)),
    ];
    const result = await store.list("videos/v1/");
    expect(result.objects).toHaveLength(3);
  });

  it("infers a content type the listing does not carry", async () => {
    fake.listPages = [page(["videos/v1/master.m3u8"])];
    const result = await store.list("videos/v1/");
    expect(result.objects[0]?.contentType).toBe(
      "application/vnd.apple.mpegurl",
    );
  });

  it("does nothing at all for a zero limit", async () => {
    const result = await store.list("videos/v1/", { limit: 0 });
    expect(result.objects).toHaveLength(0);
    expect(fake.commandsOfType(ListObjectsV2Command)).toHaveLength(0);
  });

  // A backend that answered "truncated" with a token it had already given would
  // otherwise spin forever inside one request.
  it("stops rather than looping on a token that never advances", async () => {
    fake.listPages = [page(["a"], "stuck"), page(["b"], "stuck")];
    const result = await store.list("videos/v1/", { limit: 5000 });
    expect(result.objects.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------- signing --- */

describe("sigv4SigningKey", () => {
  /**
   * AWS's own published derivation examples, not values this file produced.
   *
   * A signing key derived wrongly yields a signature that is structurally
   * perfect and rejected by the server, which looks exactly like a wrong
   * secret. Checking the chain against an external answer is the only thing
   * that distinguishes "my HMACs are right" from "my HMACs agree with
   * themselves".
   */
  it("matches AWS's published vector for 20120215/us-east-1/iam", () => {
    expect(
      sigv4SigningKey(
        "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        "20120215",
        "us-east-1",
        "iam",
      ).toString("hex"),
    ).toBe("f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
  });

  it("matches AWS's published vector for 20150830/us-east-1/iam", () => {
    expect(
      sigv4SigningKey(
        "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        "20150830",
        "us-east-1",
        "iam",
      ).toString("hex"),
    ).toBe("c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9");
  });
});

describe("encodeRfc3986", () => {
  it("leaves an ordinary key untouched", () => {
    expect(encodeRfc3986("seg-00001.m4s")).toBe("seg-00001.m4s");
  });

  // encodeURIComponent leaves these alone and SigV4's canonical form does not,
  // so a key containing one would be signed one way and requested another.
  it("encodes the characters encodeURIComponent does not", () => {
    expect(encodeRfc3986("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
  });

  it("encodes a space and a slash", () => {
    expect(encodeRfc3986("my file/x")).toBe("my%20file%2Fx");
  });
});

describe("presignR2Url", () => {
  const NOW = new Date("2026-08-16T12:34:56.000Z");

  function sign(overrides: Partial<Parameters<typeof presignR2Url>[0]> = {}) {
    return presignR2Url({
      method: "PUT",
      credentials: CREDENTIALS,
      bucket: "media",
      key: "videos/v1/720p/seg-00001.m4s",
      expiresIn: 900,
      contentType: "video/iso.segment",
      now: NOW,
      ...overrides,
    });
  }

  it("signs against the account endpoint in path style", () => {
    const url = new URL(sign());
    expect(url.origin).toBe(r2Endpoint("acct123"));
    expect(url.pathname).toBe("/media/videos/v1/720p/seg-00001.m4s");
  });

  it("carries every parameter a SigV4 query signature needs", () => {
    const params = new URL(sign()).searchParams;
    expect(params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(params.get("X-Amz-Date")).toBe("20260816T123456Z");
    expect(params.get("X-Amz-Expires")).toBe("900");
    expect(params.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  // §2.3: the region has to be the literal `auto` or the signature does not
  // validate, and it appears in the credential scope as well as the client.
  it("scopes the credential to auto/s3", () => {
    const credential = new URL(sign()).searchParams.get("X-Amz-Credential");
    expect(credential).toBe(
      "AKIAIOSFODNN7EXAMPLE/20260816/auto/s3/aws4_request",
    );
  });

  /**
   * §2.3: the content type is inside the signature, so the browser's upload has
   * to send that exact header. Signing it is what makes the presigned URL a
   * grant to write *one kind of thing at one key*, rather than a blank write.
   */
  it("signs the content type for a PUT", () => {
    expect(new URL(sign()).searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host",
    );
  });

  it("produces a different signature for a different content type", () => {
    expect(sign({ contentType: "video/mp4" })).not.toBe(sign());
  });

  it("signs only the host when no content type was stated", () => {
    const url = new URL(sign({ method: "GET", contentType: undefined }));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("produces a different signature for a different method", () => {
    expect(sign({ method: "GET" })).not.toBe(sign());
  });

  it("is reproducible for identical inputs", () => {
    expect(sign()).toBe(sign());
  });

  // §2.3: 1 second to 7 days, the same ceiling S3 enforces.
  it("clamps expiry to the backend's range", () => {
    expect(
      new URL(sign({ expiresIn: 999_999_999 })).searchParams.get(
        "X-Amz-Expires",
      ),
    ).toBe("604800");
    expect(
      new URL(sign({ expiresIn: 0 })).searchParams.get("X-Amz-Expires"),
    ).toBe("1");
  });

  it("percent-encodes a key without destroying its separators", () => {
    const url = sign({ key: "videos/v1/my clip (1).mp4" });
    expect(url).toContain("/media/videos/v1/my%20clip%20%281%29.mp4?");
  });
});

describe("signedUrl", () => {
  it("prefers the public domain for reads when there is one", async () => {
    const cached = storeWith(fake, "https://media.example.com/");
    await expect(cached.signedUrl("videos/v1/720p/seg-00001.m4s")).resolves.toBe(
      "https://media.example.com/videos/v1/720p/seg-00001.m4s",
    );
  });

  it("presigns a read when there is no public domain", async () => {
    const url = await store.signedUrl("videos/v1/720p/seg-00001.m4s");
    expect(url).toContain("X-Amz-Signature=");
  });

  // A public domain is a read path; an upload is never one of those.
  it("presigns a write even when a public domain exists", async () => {
    const cached = storeWith(fake, "https://media.example.com");
    const url = await cached.signedUrl("videos/v1/720p/seg-00001.m4s", {
      method: "PUT",
      contentType: "video/iso.segment",
    });
    expect(url).toContain("r2.cloudflarestorage.com");
    expect(url).toContain("X-Amz-Signature=");
  });

  /**
   * Guessing a content type here would produce a 403 `SignatureDoesNotMatch`
   * that the browser cannot even read — §2.3 notes R2's 403s arrive without
   * CORS headers, so the client's JS sees only that the fetch failed. Refusing
   * at the call site puts the error where someone can act on it.
   */
  it("refuses a write URL with no content type to sign", async () => {
    await expect(
      store.signedUrl("videos/v1/720p/seg-00001.m4s", { method: "PUT" }),
    ).rejects.toThrow(TypeError);
  });
});

/* ---------------------------------------------------------------- factory - */

describe("blobStore() with BLOB_DRIVER=r2", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.BLOB_DRIVER = "r2";
    process.env.R2_ACCOUNT_ID = "acct123";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET = "media";
    resetConfigForTests();
    resetBlobStoreForTests();
  });

  afterEach(() => {
    process.env = { ...saved };
    resetConfigForTests();
    resetBlobStoreForTests();
  });

  it("builds the R2 adapter", async () => {
    expect(config().blobDriver).toBe("r2");
    await expect(blobStore()).resolves.toBeInstanceOf(R2BlobStore);
  });

  it("hands back the same instance rather than a client per call", async () => {
    expect(await blobStore()).toBe(await blobStore());
  });

  it("refuses to resolve when a required R2 variable is missing", () => {
    delete process.env.R2_BUCKET;
    resetConfigForTests();
    expect(() => config()).toThrow(/R2_BUCKET/);
  });
});
