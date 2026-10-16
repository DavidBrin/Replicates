// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlobNotFoundError as VercelBlobNotFoundError } from "@vercel/blob";

import {
  BlobNotFoundError,
  BlobRangeNotSatisfiableError,
} from "@/ports/blob-store";
import { config, resetConfigForTests } from "@/config/env";
import { blobStore, resetBlobStoreForTests } from "@/adapters/blob";
import { R2BlobStore } from "@/adapters/blob/r2";
import {
  VercelBlobStore,
  maxAgeFor,
  publicBaseUrlFromToken,
  type VercelBlobClient,
} from "@/adapters/blob/vercel-blob";

/**
 * No network, no token, no mocking library: the SDK slice and `fetch` are
 * both injected, so the fake below records what the adapter asked for and
 * answers with whatever the test needs — including the pages, the 416 and the
 * `If-Range` miss that a live store would not produce on demand.
 */

const TOKEN = "vercel_blob_rw_AbC123xYz_s3cr3tS3cr3t";
const BASE = "https://abc123xyz.public.blob.vercel-storage.com";

type Call = { readonly name: string; readonly args: unknown[] };

interface Fake {
  readonly client: VercelBlobClient;
  readonly calls: Call[];
  stored: Map<string, { size: number; etag: string; uploadedAt: Date; contentType: string }>;
  pages: Array<{ blobs: { pathname: string; size: number; etag: string; uploadedAt: Date }[]; cursor?: string; hasMore: boolean }>;
}

function makeFake(): Fake {
  const calls: Call[] = [];
  const stored = new Map<string, { size: number; etag: string; uploadedAt: Date; contentType: string }>();
  const fake: Fake = {
    calls,
    stored,
    pages: [],
    client: {
      put: (async (pathname: string, body: unknown, options: unknown) => {
        calls.push({ name: "put", args: [pathname, body, options] });
        const size = body instanceof Uint8Array ? body.byteLength : 7;
        stored.set(pathname, {
          size,
          etag: `"etag-${pathname}"`,
          uploadedAt: new Date("2026-10-15T12:00:00Z"),
          contentType: (options as { contentType: string }).contentType,
        });
        return { url: `${BASE}/${pathname}`, pathname } as never;
      }) as unknown as VercelBlobClient["put"],
      head: (async (url: string) => {
        calls.push({ name: "head", args: [url] });
        const pathname = url.slice(BASE.length + 1);
        const entry = stored.get(decodeURIComponent(pathname));
        if (!entry) throw new VercelBlobNotFoundError();
        return {
          size: entry.size,
          uploadedAt: entry.uploadedAt,
          pathname,
          contentType: entry.contentType,
          etag: entry.etag,
          url,
        } as never;
      }) as unknown as VercelBlobClient["head"],
      del: (async (url: string) => {
        calls.push({ name: "del", args: [url] });
      }) as unknown as VercelBlobClient["del"],
      list: (async (options: { cursor?: string }) => {
        calls.push({ name: "list", args: [options] });
        const page = fake.pages.shift();
        if (!page) return { blobs: [], hasMore: false } as never;
        return page as never;
      }) as unknown as VercelBlobClient["list"],
      issueSignedToken: (async (options: unknown) => {
        calls.push({ name: "issueSignedToken", args: [options] });
        return { clientSigningToken: "cst", delegationToken: "dt" } as never;
      }) as unknown as VercelBlobClient["issueSignedToken"],
      presignUrl: (async (signed: unknown, options: unknown) => {
        calls.push({ name: "presignUrl", args: [signed, options] });
        return { presignedUrl: "https://blob.vercel-storage.com/?signed=1" };
      }) as unknown as VercelBlobClient["presignUrl"],
    },
  };
  return fake;
}

/** A `fetch` that answers from a script of responses and records the requests. */
function makeFetch(script: Array<() => Response>) {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    const next = script.shift();
    if (!next) throw new Error("fetch called more times than scripted");
    return next();
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

/* ---------------------------------------------------------------- tests --- */

describe("publicBaseUrlFromToken", () => {
  it("lowercases the store id into the public host", () => {
    expect(publicBaseUrlFromToken(TOKEN)).toBe(BASE);
  });

  it("refuses anything that is not a read-write token", () => {
    expect(() => publicBaseUrlFromToken("vercel_blob_ro_x_y")).toThrow(/read-write token/);
    expect(() => publicBaseUrlFromToken("nonsense")).toThrow(/BLOB_PUBLIC_BASE_URL/);
  });
});

describe("maxAgeFor", () => {
  it("gives immutable content and segments a year, manifests the floor", () => {
    expect(maxAgeFor("videos/v1/720p/seg-00001.m4s", true)).toBe(31_536_000);
    expect(maxAgeFor("videos/v1/720p/seg-00001.m4s", false)).toBe(31_536_000);
    expect(maxAgeFor("videos/v1/master.m3u8", false)).toBe(60);
  });
});

describe("put", () => {
  it("stores bytes whole under the key itself, then reads the validator back", async () => {
    const fake = makeFake();
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client });

    const metadata = await store.put("videos/v1/720p/init.mp4", bytes("abcdef"), {
      contentType: "video/mp4",
      immutable: true,
    });

    const [, body, options] = fake.calls[0]!.args as [string, Buffer, Record<string, unknown>];
    expect(fake.calls[0]!.name).toBe("put");
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(options).toMatchObject({
      access: "public",
      token: TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "video/mp4",
      cacheControlMaxAge: 31_536_000,
      multipart: false,
    });
    expect(fake.calls[1]!.name).toBe("head");
    expect(metadata).toMatchObject({
      key: "videos/v1/720p/init.mp4",
      size: 6,
      contentType: "video/mp4",
      etag: '"etag-videos/v1/720p/init.mp4"',
    });
  });

  it("uploads a stream in parts and gives a manifest the sixty-second floor", async () => {
    const fake = makeFake();
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client });
    const stream = new Blob(["#EXTM3U"]).stream() as ReadableStream<Uint8Array>;

    await store.put("videos/v1/master.m3u8", stream, {
      contentType: "application/vnd.apple.mpegurl",
      contentLength: 7,
    });

    const [, , options] = fake.calls[0]!.args as [string, unknown, Record<string, unknown>];
    expect(options).toMatchObject({ multipart: true, cacheControlMaxAge: 60 });
  });
});

describe("head", () => {
  it("maps the SDK's result and asks by public URL", async () => {
    const fake = makeFake();
    fake.stored.set("videos/v1/thumb-default.jpg", {
      size: 123,
      etag: '"x"',
      uploadedAt: new Date("2026-10-15T12:00:00Z"),
      contentType: "image/jpeg",
    });
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client });

    const metadata = await store.head("videos/v1/thumb-default.jpg");

    expect(fake.calls[0]!.args[0]).toBe(`${BASE}/videos/v1/thumb-default.jpg`);
    expect(metadata).toEqual({
      key: "videos/v1/thumb-default.jpg",
      size: 123,
      contentType: "image/jpeg",
      etag: '"x"',
      lastModified: new Date("2026-10-15T12:00:00Z"),
    });
  });

  it("turns the SDK's not-found into the port's", async () => {
    const fake = makeFake();
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client });
    await expect(store.head("videos/none/thumb.jpg")).rejects.toBeInstanceOf(BlobNotFoundError);
  });
});

describe("get", () => {
  it("reads the whole object over HTTP from the public host", async () => {
    const fake = makeFake();
    const { fetchImpl, requests } = makeFetch([
      () =>
        new Response("hello world", {
          status: 200,
          headers: {
            "content-type": "video/mp4",
            "content-length": "11",
            etag: '"v1"',
            "last-modified": "Wed, 15 Oct 2026 12:00:00 GMT",
          },
        }),
    ]);
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client, fetch: fetchImpl });

    const result = await store.get("videos/v1/source.mp4");

    expect(requests[0]!.url).toBe(`${BASE}/videos/v1/source.mp4`);
    expect(requests[0]!.headers.has("range")).toBe(false);
    expect(result.range).toBeUndefined();
    expect(result.metadata).toMatchObject({ size: 11, contentType: "video/mp4", etag: '"v1"' });
    expect(await readAll(result.body)).toBe("hello world");
  });

  it("forwards a range and echoes what the CDN actually returned", async () => {
    const fake = makeFake();
    const { fetchImpl, requests } = makeFetch([
      () =>
        new Response("ello", {
          status: 206,
          headers: { "content-range": "bytes 1-4/11", "content-type": "video/mp4", etag: '"v1"' },
        }),
    ]);
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client, fetch: fetchImpl });

    const result = await store.get("videos/v1/source.mp4", { range: { start: 1, end: 4 } });

    expect(requests[0]!.headers.get("range")).toBe("bytes=1-4");
    expect(result.range).toEqual({ start: 1, end: 4, total: 11 });
    expect(result.metadata.size).toBe(11);
    expect(await readAll(result.body)).toBe("ello");
  });

  it("re-fetches the whole object when a CDN ignores a mismatched If-Range", async () => {
    const fake = makeFake();
    const { fetchImpl, requests } = makeFetch([
      () =>
        new Response("ello", {
          status: 206,
          headers: { "content-range": "bytes 1-4/11", etag: '"v2"' },
        }),
      () => new Response("hello world", { status: 200, headers: { etag: '"v2"', "content-length": "11" } }),
    ]);
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client, fetch: fetchImpl });

    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 1, end: 4 },
      ifRange: '"v1"',
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]!.headers.get("if-range")).toBe('"v1"');
    expect(requests[1]!.headers.has("range")).toBe(false);
    expect(result.range).toBeUndefined();
    expect(await readAll(result.body)).toBe("hello world");
  });

  it("maps 404 and 416 to the port's errors, taking the size from Content-Range", async () => {
    const fake = makeFake();
    const { fetchImpl } = makeFetch([
      () => new Response(null, { status: 404 }),
      () => new Response(null, { status: 416, headers: { "content-range": "bytes */11" } }),
    ]);
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client, fetch: fetchImpl });

    await expect(store.get("videos/none/source.mp4")).rejects.toBeInstanceOf(BlobNotFoundError);

    const error = await store
      .get("videos/v1/source.mp4", { range: { start: 50 } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlobRangeNotSatisfiableError);
    expect((error as BlobRangeNotSatisfiableError).size).toBe(11);
  });
});

describe("delete", () => {
  it("deletes by public URL and treats a missing blob as deleted", async () => {
    const fake = makeFake();
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client });
    await store.delete("videos/v1/preview.mp4");
    expect(fake.calls[0]!).toEqual({ name: "del", args: [`${BASE}/videos/v1/preview.mp4`] });

    const throwing = makeFake();
    throwing.client.del = (async () => {
      throw new VercelBlobNotFoundError();
    }) as unknown as VercelBlobClient["del"];
    await expect(
      new VercelBlobStore({ token: TOKEN, client: throwing.client }).delete("videos/x/y"),
    ).resolves.toBeUndefined();
  });
});

describe("list", () => {
  it("follows the cursor until the limit is filled and hands the rest back", async () => {
    const fake = makeFake();
    const when = new Date("2026-10-15T12:00:00Z");
    fake.pages = [
      {
        blobs: [
          { pathname: "videos/v1/720p/seg-00001.m4s", size: 10, etag: '"a"', uploadedAt: when },
          { pathname: "videos/v1/720p/seg-00002.m4s", size: 11, etag: '"b"', uploadedAt: when },
        ],
        cursor: "c1",
        hasMore: true,
      },
      {
        blobs: [{ pathname: "videos/v1/720p/seg-00003.m4s", size: 12, etag: '"c"', uploadedAt: when }],
        cursor: "c2",
        hasMore: true,
      },
    ];
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client });

    const result = await store.list("videos/v1/", { limit: 3 });

    expect(result.objects.map((o) => o.key)).toEqual([
      "videos/v1/720p/seg-00001.m4s",
      "videos/v1/720p/seg-00002.m4s",
      "videos/v1/720p/seg-00003.m4s",
    ]);
    expect(result.objects[0]!).toMatchObject({ contentType: "video/iso.segment", etag: '"a"', size: 10 });
    expect(result.cursor).toBe("c2");
    expect(fake.calls.map((c) => (c.args[0] as { cursor?: string; limit: number }))).toEqual([
      { prefix: "videos/v1/", cursor: undefined, limit: 3, token: TOKEN },
      { prefix: "videos/v1/", cursor: "c1", limit: 1, token: TOKEN },
    ]);
  });

  it("stops when the store says there is no more", async () => {
    const fake = makeFake();
    fake.pages = [{ blobs: [], hasMore: false }];
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client });
    expect(await store.list("videos/none/")).toEqual({ objects: [] });
  });
});

describe("signedUrl", () => {
  it("answers GET with the permanent public URL, encoded per segment", async () => {
    const fake = makeFake();
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client });
    await expect(store.signedUrl("videos/v 1/captions-uploaded-en.vtt")).resolves.toBe(
      `${BASE}/videos/v%201/captions-uploaded-en.vtt`,
    );
    expect(fake.calls).toEqual([]);
  });

  it("honours a custom public base URL", async () => {
    const fake = makeFake();
    const store = new VercelBlobStore({
      token: TOKEN,
      client: fake.client,
      publicBaseUrl: "https://media.example.com/",
    });
    await expect(store.signedUrl("videos/v1/master.m3u8")).resolves.toBe(
      "https://media.example.com/videos/v1/master.m3u8",
    );
  });

  it("presigns a PUT scoped to the key and content type", async () => {
    const fake = makeFake();
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client });

    const url = await store.signedUrl("videos/v1/720p/seg-00001.m4s", {
      method: "PUT",
      contentType: "video/iso.segment",
      expiresIn: 300,
    });

    expect(url).toBe("https://blob.vercel-storage.com/?signed=1");
    expect(fake.calls[0]!.name).toBe("issueSignedToken");
    expect(fake.calls[0]!.args[0]).toMatchObject({
      token: TOKEN,
      pathname: "videos/v1/720p/seg-00001.m4s",
      operations: ["put"],
      allowedContentTypes: ["video/iso.segment"],
    });
    expect(fake.calls[1]!.name).toBe("presignUrl");
    expect(fake.calls[1]!.args[1]).toMatchObject({
      operation: "put",
      pathname: "videos/v1/720p/seg-00001.m4s",
      access: "public",
      allowOverwrite: true,
      addRandomSuffix: false,
    });
  });

  it("refuses a PUT without a content type", async () => {
    const fake = makeFake();
    const store = new VercelBlobStore({ token: TOKEN, client: fake.client });
    await expect(store.signedUrl("videos/v1/x.mp4", { method: "PUT" })).rejects.toThrow(/contentType/);
  });
});

describe("blobStore() selection", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.BLOB_DRIVER;
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    resetConfigForTests();
    resetBlobStoreForTests();
  });

  afterEach(() => {
    process.env = { ...saved };
    resetConfigForTests();
    resetBlobStoreForTests();
  });

  it("picks Vercel Blob when only its token is present", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
    resetConfigForTests();
    expect(config().blobDriver).toBe("vercel-blob");
    await expect(blobStore()).resolves.toBeInstanceOf(VercelBlobStore);
  });

  it("lets R2 win when both are configured", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
    process.env.R2_ACCOUNT_ID = "acct123";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET = "media";
    resetConfigForTests();
    expect(config().blobDriver).toBe("r2");
    await expect(blobStore()).resolves.toBeInstanceOf(R2BlobStore);
  });

  it("refuses the driver by name without its token", () => {
    process.env.BLOB_DRIVER = "vercel-blob";
    resetConfigForTests();
    expect(() => config()).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });
});
