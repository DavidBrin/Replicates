// @vitest-environment node

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BlobNotFoundError,
  BlobRangeNotSatisfiableError,
  blobKeys,
  type BlobStore,
} from "@/ports/blob-store";
import {
  FilesystemBlobStore,
  guessContentType,
} from "@/adapters/blob/filesystem";
import { config, resetConfigForTests } from "@/config/env";
import { blobStore, resetBlobStoreForTests } from "@/adapters/blob";

/**
 * A real directory, not a memory-backed double.
 *
 * The adapter's whole job is the part a fake would elide: `createReadStream`'s
 * inclusive `start`/`end`, the atomic rename, whether a resolved path is still
 * under the root. An in-memory store would agree with any of those.
 */

let root: string;
let store: FilesystemBlobStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "blob-fs-"));
  store = new FilesystemBlobStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(body).text();
}

async function seed(key: string, text: string, contentType = "video/mp4") {
  return store.put(key, bytes(text), { contentType, immutable: true });
}

/* -------------------------------------------------------------- put/get --- */

describe("put and get", () => {
  it("round-trips bytes at a key", async () => {
    await seed("videos/v1/source.mp4", "hello world");
    const result = await store.get("videos/v1/source.mp4");
    expect(await readAll(result.body)).toBe("hello world");
    expect(result.metadata.size).toBe(11);
    expect(result.metadata.contentType).toBe("video/mp4");
  });

  it("creates the directories a nested key implies", async () => {
    await seed(blobKeys.segment("v1", "720p", 1), "seg");
    const entries = await readdir(join(root, "videos", "v1", "720p"));
    expect(entries).toContain("seg-00001.m4s");
  });

  it("overwrites a key with new bytes and a new validator", async () => {
    const first = await seed("videos/v1/master.m3u8", "#EXTM3U");
    const second = await seed("videos/v1/master.m3u8", "#EXTM3U\n#EXT-X-END");
    expect(second.etag).not.toBe(first.etag);
    expect(await readAll((await store.get("videos/v1/master.m3u8")).body)).toBe(
      "#EXTM3U\n#EXT-X-END",
    );
  });

  it("accepts a stream body", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes("abc"));
        controller.enqueue(bytes("def"));
        controller.close();
      },
    });
    await store.put("videos/v1/source.mp4", body, {
      contentType: "video/mp4",
    });
    expect(await readAll((await store.get("videos/v1/source.mp4")).body)).toBe(
      "abcdef",
    );
  });

  it("leaves no partial files behind", async () => {
    await seed("videos/v1/source.mp4", "x");
    const entries = await readdir(join(root, "videos", "v1"));
    expect(entries.filter((name) => name.endsWith(".part"))).toEqual([]);
  });

  /**
   * Atomicity, tested by observing a write in progress.
   *
   * The case above was the only coverage this had, and it does not test what
   * it says: "no `.part` file remains afterwards" is equally true of an
   * implementation that opens the final path and writes straight into it. The
   * property that matters is what a *concurrent reader* sees, and the only way
   * to assert that is to have one read while a write is open.
   *
   * A player fetches a segment the instant the playlist naming it is readable,
   * so a partially-written file at the final path is a decode error several
   * layers away from the upload that caused it — and on an overwrite it is a
   * video that was working and now is not.
   *
   * The stream below hands over its first chunk and then waits, which puts the
   * adapter reliably mid-write with no timing assumptions. A direct write
   * would have already truncated the old object by this point; the rename
   * approach has not touched it.
   */
  it("never exposes a half-written object to a concurrent reader", async () => {
    await seed("videos/v1/source.mp4", "the-old-bytes");

    let release: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode("the-new-"));
        await paused;
        controller.enqueue(new TextEncoder().encode("bytes-are-longer"));
        controller.close();
      },
    });

    const writing = store.put("videos/v1/source.mp4", body, {
      contentType: "video/mp4",
    });

    // Mid-write: the reader must still get the whole previous object.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const during = await store.get("videos/v1/source.mp4");
    expect(await readAll(during.body)).toBe("the-old-bytes");

    release?.();
    await writing;

    const after = await store.get("videos/v1/source.mp4");
    expect(await readAll(after.body)).toBe("the-new-bytes-are-longer");
  });

  it("rejects a read of a key that was never written", async () => {
    await expect(store.get("videos/ghost/source.mp4")).rejects.toBeInstanceOf(
      BlobNotFoundError,
    );
  });
});

/* ---------------------------------------------------------------- ranges -- */

describe("ranged reads", () => {
  const CONTENT = "0123456789";

  beforeEach(async () => {
    await seed("videos/v1/source.mp4", CONTENT);
  });

  it("returns a closed range inclusive at both ends", async () => {
    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 2, end: 5 },
    });
    expect(await readAll(result.body)).toBe("2345");
    expect(result.range).toEqual({ start: 2, end: 5, total: 10 });
  });

  it("returns an open-ended range to the last byte", async () => {
    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 7 },
    });
    expect(await readAll(result.body)).toBe("789");
    expect(result.range).toEqual({ start: 7, end: 9, total: 10 });
  });

  // §4.2: this is Safari's opening probe, and it is the request that decides
  // whether Safari will use the source at all.
  it("returns exactly two bytes for a two-byte probe", async () => {
    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 0, end: 1 },
    });
    expect(await readAll(result.body)).toBe("01");
    expect(result.range).toEqual({ start: 0, end: 1, total: 10 });
  });

  // An end past the end is a clamp, not an error (§14.1.1).
  it("clamps an end past the end of the object", async () => {
    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 8, end: 9999 },
    });
    expect(await readAll(result.body)).toBe("89");
    expect(result.range).toEqual({ start: 8, end: 9, total: 10 });
  });

  it("refuses a start past the end", async () => {
    await expect(
      store.get("videos/v1/source.mp4", { range: { start: 10 } }),
    ).rejects.toBeInstanceOf(BlobRangeNotSatisfiableError);
  });

  it("reports the object's size on the unsatisfiable error", async () => {
    const error = await store
      .get("videos/v1/source.mp4", { range: { start: 99 } })
      .catch((e: unknown) => e);
    expect((error as BlobRangeNotSatisfiableError).size).toBe(10);
  });

  /**
   * `bytes=0-` against a zero-byte object. There is no byte zero, so 416 is the
   * only correct answer — and the tempting clamp computes `end = -1`, which
   * `createReadStream` reads as "no end" and answers with the whole file.
   */
  it("refuses every range against a zero-length object", async () => {
    await seed("videos/v1/empty.mp4", "");
    await expect(
      store.get("videos/v1/empty.mp4", { range: { start: 0 } }),
    ).rejects.toBeInstanceOf(BlobRangeNotSatisfiableError);
  });

  it("serves a zero-length object whole without a range", async () => {
    await seed("videos/v1/empty.mp4", "");
    const result = await store.get("videos/v1/empty.mp4");
    expect(await readAll(result.body)).toBe("");
    expect(result.metadata.size).toBe(0);
  });
});

describe("If-Range", () => {
  beforeEach(async () => {
    await seed("videos/v1/source.mp4", "0123456789");
  });

  it("honours the range when the validator still matches", async () => {
    const { etag } = await store.head("videos/v1/source.mp4");
    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 2, end: 4 },
      ifRange: etag,
    });
    expect(await readAll(result.body)).toBe("234");
    expect(result.range).toEqual({ start: 2, end: 4, total: 10 });
  });

  /**
   * RFC 9110 §13.1.5: a stale validator means the range describes bytes of a
   * representation the client no longer has, so the whole object is the
   * required answer. Splicing a range of the new encoding onto a buffer of the
   * old one produces a decode failure that reads as a corrupt file.
   */
  it("returns the whole object when the validator has moved", async () => {
    const result = await store.get("videos/v1/source.mp4", {
      range: { start: 2, end: 4 },
      ifRange: '"a-validator-from-a-previous-encoding"',
    });
    expect(await readAll(result.body)).toBe("0123456789");
    expect(result.range).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ head -- */

describe("head", () => {
  it("reports size, type and validator without opening the body", async () => {
    const written = await seed("videos/v1/thumb-hq.jpg", "jpegbytes", "image/jpeg");
    const metadata = await store.head("videos/v1/thumb-hq.jpg");
    expect(metadata.size).toBe(9);
    expect(metadata.contentType).toBe("image/jpeg");
    expect(metadata.etag).toBe(written.etag);
    expect(metadata.lastModified).toBeInstanceOf(Date);
  });

  it("rejects for an absent key", async () => {
    await expect(store.head("videos/v1/nothing.mp4")).rejects.toBeInstanceOf(
      BlobNotFoundError,
    );
  });

  /**
   * The sidecar carries the content type and the strong validator; the bytes
   * are the object. A crash between the two writes should not make a video
   * unplayable, so a missing sidecar degrades to an inferred type and a weak
   * size-and-mtime validator rather than failing the read.
   */
  it("survives losing the metadata sidecar", async () => {
    await seed("videos/v1/source.mp4", "0123456789");
    await rm(join(root, "videos", "v1", "source.mp4.meta.json"));

    const metadata = await store.head("videos/v1/source.mp4");
    expect(metadata.size).toBe(10);
    expect(metadata.contentType).toBe("video/mp4");
    expect(metadata.etag).toMatch(/^".+"$/);
  });
});

/* ---------------------------------------------------------------- delete -- */

describe("delete", () => {
  it("removes the object and its sidecar", async () => {
    await seed("videos/v1/source.mp4", "x");
    await store.delete("videos/v1/source.mp4");
    await expect(store.head("videos/v1/source.mp4")).rejects.toBeInstanceOf(
      BlobNotFoundError,
    );
    await expect(
      readFile(join(root, "videos", "v1", "source.mp4.meta.json")),
    ).rejects.toThrow();
  });

  it("is idempotent for a key that was never there", async () => {
    await expect(store.delete("videos/v1/never.mp4")).resolves.toBeUndefined();
  });
});

/* ------------------------------------------------------------------ list -- */

describe("list", () => {
  beforeEach(async () => {
    await seed(blobKeys.masterPlaylist("v1"), "#EXTM3U");
    for (let i = 1; i <= 3; i += 1) {
      await seed(blobKeys.segment("v1", "720p", i), `seg${i}`);
    }
    await seed(blobKeys.segment("v2", "720p", 1), "other");
  });

  it("returns only keys under the prefix", async () => {
    const result = await store.list(blobKeys.videoPrefix("v1"));
    expect(result.objects.map((o) => o.key).sort()).toEqual([
      "videos/v1/720p/seg-00001.m4s",
      "videos/v1/720p/seg-00002.m4s",
      "videos/v1/720p/seg-00003.m4s",
      "videos/v1/master.m3u8",
    ]);
  });

  it("hides the metadata sidecars it writes alongside each object", async () => {
    const result = await store.list("videos/");
    expect(result.objects.some((o) => o.key.endsWith(".meta.json"))).toBe(false);
  });

  it("returns an empty list for a prefix matching nothing", async () => {
    await expect(store.list("videos/absent/")).resolves.toEqual({
      objects: [],
    });
  });

  /**
   * The filesystem has no 1000-key ceiling; the page size is honoured anyway so
   * that a caller which forgets to follow the cursor breaks in development
   * rather than only against R2, where `ListObjectsV2` truncates silently.
   */
  it("paginates and hands back a cursor that resumes where it stopped", async () => {
    const first = await store.list("videos/v1/720p/", { limit: 2 });
    expect(first.objects).toHaveLength(2);
    expect(first.cursor).toBe("videos/v1/720p/seg-00002.m4s");

    const second = await store.list("videos/v1/720p/", {
      limit: 2,
      cursor: first.cursor,
    });
    expect(second.objects.map((o) => o.key)).toEqual([
      "videos/v1/720p/seg-00003.m4s",
    ]);
    expect(second.cursor).toBeUndefined();
  });

  it("orders keys stably so a cursor cannot skip or repeat", async () => {
    const a = await store.list("videos/v1/");
    const b = await store.list("videos/v1/");
    expect(a.objects.map((o) => o.key)).toEqual(b.objects.map((o) => o.key));
  });
});

/* -------------------------------------------------------------- security -- */

describe("key containment", () => {
  /**
   * A key is the one part of a media URL derived from user-supplied
   * identifiers, and this adapter resolves it against a directory. On a
   * developer's machine "any file the process can see" is all of them.
   *
   * The check is on the *resolved* path rather than on the key's text, which is
   * what makes `%2e%2e`, doubled separators and symlinked components all
   * collapse to the same comparison — none of them are visible to a naive
   * `includes("..")`.
   */
  it.each([
    ["a parent traversal", "../escaped.txt"],
    ["a traversal below a real prefix", "videos/../../escaped.txt"],
    ["a deep traversal", "../../../../../../etc/passwd"],
    ["redundant separators around a traversal", "videos//..//../escaped.txt"],
  ])("refuses to read through %s", async (_label, key) => {
    await expect(store.get(key)).rejects.toThrow(/escapes the store root/);
  });

  it("refuses to write through a traversal", async () => {
    await expect(
      store.put("../escaped.txt", bytes("owned"), { contentType: "text/plain" }),
    ).rejects.toThrow(/escapes the store root/);
  });

  it("refuses to delete through a traversal", async () => {
    const outside = join(root, "..", "bystander.txt");
    await writeFile(outside, "keep me");
    try {
      await expect(store.delete("../bystander.txt")).rejects.toThrow(
        /escapes the store root/,
      );
      await expect(readFile(outside, "utf8")).resolves.toBe("keep me");
    } finally {
      await rm(outside, { force: true });
    }
  });

  /**
   * A decoded `%2e%2e` is just `..`, which is the point: whatever encoding it
   * arrives in, it is the resolved path that decides. The route handler in
   * front of this rejects these before they get here — this asserts the second
   * layer independently, because a single layer is one refactor from none.
   */
  it("refuses a traversal however it was spelled on the way in", async () => {
    const decoded = decodeURIComponent("%2e%2e/escaped.txt");
    await expect(store.get(decoded)).rejects.toThrow(/escapes the store root/);
  });

  // An absolute key would otherwise make `join` discard the root entirely on
  // some path implementations.
  it("keeps a leading-slash key inside the root", async () => {
    await store.put("/videos/v1/source.mp4", bytes("x"), {
      contentType: "video/mp4",
    });
    await expect(readFile(join(root, "videos", "v1", "source.mp4"), "utf8"))
      .resolves.toBe("x");
  });
});

/* ---------------------------------------------------------------- signing - */

describe("signedUrl", () => {
  /**
   * Always null, and the port exposes that rather than hiding it. There is no
   * separate storage origin to sign against locally, so the player fetches
   * through a route handler instead — which is exactly why the upload flow has
   * to *ask* for a target instead of assuming one shape.
   */
  it("has no URL to offer, for reads or writes", async () => {
    // Through the port's type: the class narrows `signedUrl` to no parameters
    // at all, so only a `BlobStore`-typed reference can ask it for a PUT URL.
    const port: BlobStore = store;
    await expect(port.signedUrl("videos/v1/source.mp4")).resolves.toBeNull();
    await expect(
      port.signedUrl("videos/v1/source.mp4", {
        method: "PUT",
        contentType: "video/mp4",
      }),
    ).resolves.toBeNull();
  });
});

/* ----------------------------------------------------------- content types */

describe("guessContentType", () => {
  it.each([
    ["videos/v1/master.m3u8", "application/vnd.apple.mpegurl"],
    ["videos/v1/720p/seg-00001.m4s", "video/iso.segment"],
    ["videos/v1/720p/init.mp4", "video/mp4"],
    ["videos/v1/captions-en.vtt", "text/vtt"],
    ["videos/v1/thumb-hq.jpg", "image/jpeg"],
    ["channels/c1/banner.webp", "image/webp"],
  ])("types %s", (key, expected) => {
    expect(guessContentType(key)).toBe(expected);
  });

  it("falls back to an opaque type it cannot recognise", () => {
    expect(guessContentType("videos/v1/mystery.bin")).toBe(
      "application/octet-stream",
    );
    expect(guessContentType("videos/v1/no-extension")).toBe(
      "application/octet-stream",
    );
  });
});

/* ---------------------------------------------------------------- factory - */

describe("blobStore() with BLOB_DRIVER=filesystem", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.BLOB_DRIVER = "filesystem";
    process.env.BLOB_FS_ROOT = root;
    resetConfigForTests();
    resetBlobStoreForTests();
  });

  afterEach(() => {
    process.env = { ...saved };
    resetConfigForTests();
    resetBlobStoreForTests();
  });

  it("builds the filesystem adapter rooted where configuration says", async () => {
    expect(config().blobDriver).toBe("filesystem");
    const configured = await blobStore();
    expect(configured).toBeInstanceOf(FilesystemBlobStore);

    await configured.put("videos/v1/source.mp4", bytes("through the factory"), {
      contentType: "video/mp4",
    });
    await expect(
      readFile(join(root, "videos", "v1", "source.mp4"), "utf8"),
    ).resolves.toBe("through the factory");
  });

  it("hands back the same instance rather than one per call", async () => {
    expect(await blobStore()).toBe(await blobStore());
  });

  // Nothing local can presign, and the factory does not paper over it: the
  // difference is what the upload flow has to branch on.
  it("selects a driver that cannot sign a URL", async () => {
    await expect(
      (await blobStore()).signedUrl("videos/v1/source.mp4"),
    ).resolves.toBeNull();
  });
});
