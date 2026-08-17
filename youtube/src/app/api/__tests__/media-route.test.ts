// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/media/[...key]/route";
import { PUT } from "@/app/api/upload/blob/[...key]/route";
import { POST } from "@/app/api/upload/target/route";
import { blobStore, resetBlobStoreForTests } from "@/adapters/blob";
import { closeDatabaseForTests, database } from "@/adapters/db";
import {
  createTestChannel,
  createTestUser,
} from "@/adapters/repositories/__tests__/harness";
import { resetMediaAccessCacheForTests } from "@/adapters/repositories/media-access";
import { createVideo } from "@/adapters/repositories/videos";
import { resetConfigForTests } from "@/config/env";
import { SESSION_COOKIE, createSession } from "@/lib/auth";
import { PrivateMediaNotEnforceableError } from "@/lib/auth/guard";

/**
 * The three delivery routes, against a real filesystem store.
 *
 * They are tested together because they are one flow: ask for a target, write
 * to it, read it back with ranges. Splitting them would leave the seam that
 * matters — that a proxy upload produces an object the media route can range
 * over — untested by either half.
 *
 * Nothing here is mocked. The store is the real filesystem adapter under a
 * temporary directory, so a range assertion is an assertion about
 * `createReadStream`'s offsets rather than about a fake's arithmetic. Since the
 * routes gained a visibility and ownership gate there is a real PGlite behind
 * them too, reached through the process-wide `database()` the handlers
 * themselves use — pointed at `:memory:`, so the suite writes nothing to the
 * repository and two files cannot see each other's rows.
 *
 * The fixtures are seeded once and never mutated, so unlike the repository
 * suites there is no truncation between tests: every assertion here is about a
 * request, not about a row.
 */

const CONTENT = "0123456789".repeat(100); // 1000 bytes, positionally checkable.

let root: string;
const savedEnv = { ...process.env };

/** Assigned in `beforeAll`; see the fixture block there for what each one is. */
let ownerToken: string;
let strangerToken: string;
let ownerChannelId: string;
let strangerChannelId: string;

function useFilesystemDriver(): void {
  process.env = { ...savedEnv };
  process.env.BLOB_DRIVER = "filesystem";
  process.env.BLOB_FS_ROOT = root;
  // `database()` memoises on first use, so this only has to be true before the
  // first call — but it is set on every reset anyway, because the default is
  // `.data/db` and the cost of getting it wrong is a Postgres directory
  // appearing inside the repository.
  process.env.DB_DATA_DIR = ":memory:";
  resetConfigForTests();
  resetBlobStoreForTests();
}

/**
 * The public base URL is a parameter rather than a second helper that deletes
 * it afterwards: the two R2 configurations differ in exactly that one variable
 * and building them separately would let them drift into differing in another.
 */
function useR2Driver(publicBaseUrl?: string): void {
  process.env = {
    ...savedEnv,
    BLOB_DRIVER: "r2",
    R2_ACCOUNT_ID: "acct123",
    R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
    R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    R2_BUCKET: "media",
    DB_DATA_DIR: ":memory:",
    ...(publicBaseUrl === undefined ? {} : { R2_PUBLIC_BASE_URL: publicBaseUrl }),
  };
  resetConfigForTests();
  resetBlobStoreForTests();
}

/** R2 *with a public domain in front of it* — the configuration §2.3 warns of. */
function useR2WithPublicDomain(): void {
  useR2Driver("https://media.example.com");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "media-route-"));
  useFilesystemDriver();

  /**
   * Two accounts, one channel each.
   *
   * `owner` owns `v1` and `v9` — the ids every pre-existing assertion in this
   * file uses — so those assertions are unchanged by the gate. `stranger`
   * exists so that "refused for somebody else's video" is a test about
   * ownership rather than about being signed out, which is a different rule
   * and would pass for the wrong reason.
   */
  const db = await database();
  const owner = await createTestUser(db, { email: "owner@test.local" });
  const stranger = await createTestUser(db, { email: "stranger@test.local" });
  ownerChannelId = (await createTestChannel(db, { ownerId: owner.id })).id;
  strangerChannelId = (await createTestChannel(db, { ownerId: stranger.id })).id;

  for (const [id, visibility] of [
    ["v1", "public"],
    ["v9", "public"],
    ["unlisted1", "unlisted"],
    ["private1", "private"],
  ] as const) {
    await createVideo(db, {
      id,
      channelId: ownerChannelId,
      title: id,
      visibility,
    });
  }
  await createVideo(db, {
    id: "theirs1",
    channelId: strangerChannelId,
    title: "theirs",
  });

  ownerToken = (await createSession(owner.id, { db })).token;
  strangerToken = (await createSession(stranger.id, { db })).token;

  const store = await blobStore();
  await store.put(
    "videos/v1/source.mp4",
    new TextEncoder().encode(CONTENT),
    { contentType: "video/mp4", immutable: true },
  );
  await store.put("videos/v1/empty.mp4", new Uint8Array(), {
    contentType: "video/mp4",
    immutable: true,
  });
  await store.put(
    "videos/v1/master.m3u8",
    new TextEncoder().encode("#EXTM3U"),
    { contentType: "application/vnd.apple.mpegurl" },
  );

  /**
   * The private and unlisted objects have to *exist*, or a 404 would prove
   * nothing about the gate — it would only prove that absent bytes are absent.
   */
  for (const id of ["unlisted1", "private1", "theirs1", "orphan1"]) {
    await store.put(
      `videos/${id}/source.mp4`,
      new TextEncoder().encode(CONTENT),
      { contentType: "video/mp4", immutable: true },
    );
  }
  await store.put(
    `channels/${ownerChannelId}/avatar.jpg`,
    new TextEncoder().encode("jpeg-bytes"),
    { contentType: "image/jpeg", immutable: true },
  );
});

afterEach(() => {
  useFilesystemDriver();
  // The visibility cache is process-local and outlives a test. Nothing here
  // mutates a row, so this is belt and braces — but a future test that does
  // would otherwise be answered from the previous test's rows.
  resetMediaAccessCacheForTests();
});

afterAll(async () => {
  process.env = { ...savedEnv };
  resetConfigForTests();
  resetBlobStoreForTests();
  resetMediaAccessCacheForTests();
  await closeDatabaseForTests();
  await rm(root, { recursive: true, force: true });
});

/* ----------------------------------------------------------------- helpers */

/**
 * Call the media route the way Next does: path segments already split on `/`
 * and already percent-decoded, handed over as an awaited `params` promise.
 */
function media(
  segments: readonly string[],
  headers: Record<string, string> = {},
  method = "GET",
): Promise<Response> {
  const url = `http://localhost/api/media/${segments.join("/")}`;
  return GET(new Request(url, { method, headers }), {
    params: Promise.resolve({ key: [...segments] }),
  });
}

/**
 * The `Cookie` header for a session token, or nothing at all for `null`.
 *
 * The upload helpers default to the *owner's* token rather than to signed-out,
 * so that every pre-existing assertion in this file still asserts what it was
 * written to assert: those tests are about content types, signatures and key
 * shapes, and a 401 in front of all of them would have turned them into tests
 * of the session check.
 */
function cookie(token: string | null): Record<string, string> {
  return token === null ? {} : { cookie: `${SESSION_COOKIE}=${token}` };
}

function uploadTarget(
  body: unknown,
  token: string | null = ownerToken,
): Promise<Response> {
  return POST(
    new Request("http://localhost/api/upload/target", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cookie(token) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/**
 * The body is encoded rather than passed as a string on purpose: a `Request`
 * built from a string gets `Content-Type: text/plain;charset=UTF-8` attached by
 * the fetch spec's body-extraction step, which would silently satisfy the
 * route's header fallback and make that branch untestable. A `BufferSource`
 * body extracts with no type, which is what a browser `PUT`ing a segment does.
 */
function uploadBlob(
  segments: readonly string[],
  body: string | undefined,
  headers: Record<string, string> = {},
  token: string | null = ownerToken,
): Promise<Response> {
  const url = `http://localhost/api/upload/blob/${segments.join("/")}`;
  return PUT(
    new Request(url, {
      method: "PUT",
      headers: { ...headers, ...cookie(token) },
      ...(body === undefined ? {} : { body: new TextEncoder().encode(body) }),
    }),
    { params: Promise.resolve({ key: [...segments] }) },
  );
}

const SOURCE = ["videos", "v1", "source.mp4"] as const;

/* --------------------------------------------------------------- whole GET */

describe("GET without a Range header", () => {
  it("serves the whole object", async () => {
    const response = await media(SOURCE);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
  });

  it("declares the full length and the object's type", async () => {
    const response = await media(SOURCE);
    expect(response.headers.get("content-length")).toBe("1000");
    expect(response.headers.get("content-type")).toBe("video/mp4");
  });

  /**
   * Research §4.1: `Accept-Ranges` belongs on every response, and §4.2 is why
   * it matters more than it reads — a client that never sees it should not
   * assume ranges work, and Safari acts on exactly that.
   */
  it("advertises range support on the 200 path", async () => {
    expect((await media(SOURCE)).headers.get("accept-ranges")).toBe("bytes");
  });

  it("carries a validator for If-Range and revalidation to use", async () => {
    const response = await media(SOURCE);
    expect(response.headers.get("etag")).toMatch(/^".+"$/);
    expect(response.headers.get("last-modified")).toBeTruthy();
  });

  // §6: written once at its key, never rewritten, so never revalidated either.
  it("marks media bytes immutable for a year", async () => {
    expect((await media(SOURCE)).headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  /**
   * §6's other row. This route cannot tell a finalised manifest from one still
   * being written — that state is in Postgres, behind a slice this one does not
   * own — so a playlist gets the conservative policy. Caching an in-progress
   * manifest for a year is a video that stays broken until the cache expires;
   * the cost of being wrong the other way is two origin hits out of the 53 a
   * view makes (§1.2).
   */
  it("gives a playlist a policy it can recover from", async () => {
    const response = await media(["videos", "v1", "master.m3u8"]);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=5, stale-while-revalidate=60",
    );
  });

  it("answers 404 for a key nothing was ever written to", async () => {
    expect((await media(["videos", "v1", "absent.mp4"])).status).toBe(404);
  });

  it("does not let a 404 be cached over the upload that fixes it", async () => {
    const response = await media(["videos", "v1", "absent.mp4"]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

/* ------------------------------------------------------------- ranged GET  */

describe("GET with a Range header", () => {
  it("serves a closed range as 206", async () => {
    const response = await media(SOURCE, { range: "bytes=0-499" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-499/1000");
    expect(response.headers.get("content-length")).toBe("500");
    expect(await response.text()).toBe(CONTENT.slice(0, 500));
  });

  it("serves an open-ended range to the last byte", async () => {
    const response = await media(SOURCE, { range: "bytes=500-" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 500-999/1000");
    expect(await response.text()).toBe(CONTENT.slice(500));
  });

  /**
   * The suffix form: the *last* 500 bytes. Read as "from byte 500" it would
   * still be a 206 with a plausible `Content-Range`, so nothing errors — the
   * video simply plays the wrong region.
   */
  it("serves a suffix range as the last N bytes", async () => {
    const response = await media(SOURCE, { range: "bytes=-500" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 500-999/1000");
    expect(response.headers.get("content-length")).toBe("500");
    expect(await response.text()).toBe(CONTENT.slice(-500));
  });

  it("clamps a suffix longer than the object to the whole object", async () => {
    const response = await media(SOURCE, { range: "bytes=-99999" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-999/1000");
  });

  /**
   * Research §4.2. Safari commits to a video source by asking for as little as
   * the first two bytes; anything other than a correct 206 and it drops the
   * source rather than falling back. A server that gets this one request wrong
   * produces a video that plays everywhere except Safari, silently.
   */
  it("answers Safari's opening two-byte probe correctly", async () => {
    const response = await media(SOURCE, { range: "bytes=0-1" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-1/1000");
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe("01");
  });

  // Safari fetches in ~4-5 MB windows and reissues a range for each, so every
  // request in a session takes this path, not just the first.
  it("serves a later window as its own partial response", async () => {
    const response = await media(SOURCE, { range: "bytes=400-599" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 400-599/1000");
    expect(await response.text()).toBe(CONTENT.slice(400, 600));
  });

  // An end past the end is a clamp (§14.1.1). 416 here is what breaks Safari.
  it("clamps an end past the end rather than refusing", async () => {
    const response = await media(SOURCE, { range: "bytes=900-99999" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 900-999/1000");
    expect(response.headers.get("content-length")).toBe("100");
  });

  it("refuses a start past the end with 416", async () => {
    const response = await media(SOURCE, { range: "bytes=1000-" });
    expect(response.status).toBe(416);
  });

  // §15.5.17: the 416 has to state the real size or the client retries the
  // same impossible request forever.
  it("tells a 416 client what the size actually is", async () => {
    const response = await media(SOURCE, { range: "bytes=5000-6000" });
    expect(response.headers.get("content-range")).toBe("bytes */1000");
    expect(await response.text()).toBe("");
  });

  /**
   * A zero-length object satisfies no range at all, not even `bytes=0-`: there
   * is no byte zero. The tempting clamp computes `end = -1`, which
   * `createReadStream` reads as "no end given" and answers with a 206 for a
   * file that has no bytes.
   */
  it("refuses any range against a zero-length object", async () => {
    const response = await media(["videos", "v1", "empty.mp4"], {
      range: "bytes=0-",
    });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */0");
  });

  it("still serves a zero-length object whole", async () => {
    const response = await media(["videos", "v1", "empty.mp4"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("0");
  });

  /**
   * §14.2: an unparseable `Range` is ignored and the whole representation is
   * served. Answering 400 is a common bug and it breaks the client that sent
   * the bad header along with every proxy between here and it.
   */
  it.each([
    ["nonsense", "bytes=abc"],
    ["no positions", "bytes=-"],
    ["an unknown unit", "frames=0-10"],
    ["an inverted range", "bytes=500-100"],
    ["no unit at all", "0-100"],
  ])("ignores a malformed header (%s) and serves 200", async (_l, range) => {
    const response = await media(SOURCE, { range });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("1000");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
  });

  /**
   * The multi-range decision, asserted at the wire: one `206` covering the
   * first satisfiable range, never a `multipart/byteranges` body. §14.2 permits
   * ignoring ranges outright and no media element sends more than one.
   */
  it("serves only the first range of a multi-range request", async () => {
    const response = await media(SOURCE, { range: "bytes=0-99,500-599" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-99/1000");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-type")).not.toContain("multipart");
    expect(await response.text()).toBe(CONTENT.slice(0, 100));
  });

  it("skips an unsatisfiable spec for one the object can serve", async () => {
    const response = await media(SOURCE, { range: "bytes=9000-,10-19" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 10-19/1000");
  });

  it("is 416 only when the object can satisfy nothing in the set", async () => {
    const response = await media(SOURCE, { range: "bytes=9000-,8000-8500" });
    expect(response.status).toBe(416);
  });
});

/* ---------------------------------------------------------------- If-Range */

describe("GET with If-Range", () => {
  it("honours the range when the validator still matches", async () => {
    const etag = (await media(SOURCE)).headers.get("etag");
    const response = await media(SOURCE, {
      range: "bytes=0-99",
      "if-range": etag ?? "",
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-99/1000");
  });

  /**
   * §13.1.5: when the validator has moved, the range describes bytes of a
   * representation the client no longer holds, and the whole object is the
   * required answer — not a 412, and never a 206 spliced from a different
   * encoding onto a buffer of the old one.
   */
  it("serves the whole object when the validator has moved", async () => {
    const response = await media(SOURCE, {
      range: "bytes=0-99",
      "if-range": '"from-a-previous-encoding"',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("1000");
    expect(response.headers.get("content-range")).toBeNull();
    expect(await response.text()).toBe(CONTENT);
  });
});

/* -------------------------------------------------------------------- HEAD */

describe("HEAD", () => {
  /**
   * Next's App Router implements `HEAD` by calling `GET` — verified in
   * `next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js`,
   * which does `methods.HEAD = handlers.GET` — and the HTTP layer drops the
   * body. So this calls the same handler with the same method the framework
   * would, and asserts the two things §4.2 says Safari's probing depends on
   * getting from a `HEAD`.
   */
  it("reports the same length and range support a GET would", async () => {
    const response = await media(SOURCE, {}, "HEAD");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("1000");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toBe("video/mp4");
  });
});

/* ---------------------------------------------------------------- security */

describe("key containment", () => {
  /**
   * A catch-all route hands back one element per literal `/`, already decoded —
   * so `%2e%2e` and `..` are the same thing by the time this sees them, and a
   * `%2F` is the only way a separator can appear *inside* an element. Both
   * spellings are rejected on the decoded segments, which is why there is no
   * way to reassemble a traversal after the check has passed.
   */
  it.each([
    ["a parent traversal", ["videos", "..", "..", "etc", "passwd"]],
    ["a bare dot-dot", ["..", "etc", "passwd"]],
    ["a single dot", ["videos", ".", "v1", "source.mp4"]],
    ["separators smuggled into one segment", ["videos/../../etc/passwd"]],
    ["a backslash separator", ["videos", "v1\\..\\..\\etc"]],
    ["a leading slash's empty segment", ["", "videos", "v1", "source.mp4"]],
    ["an empty segment in the middle", ["videos", "", "v1"]],
    ["a NUL truncation attempt", ["videos", "v1", "source.mp4\u0000.txt"]],
    ["nothing at all", []],
  ])("refuses %s", async (_label, segments) => {
    expect((await media(segments)).status).toBe(400);
  });

  /**
   * `videos/v1/../v1/source.mp4` resolves back inside the root, so the
   * filesystem adapter would allow it. It is refused anyway: a key with a `..`
   * in it is not a key this app ever writes, and accepting the harmless case
   * means the check has to be right about which cases are harmless.
   */
  it("refuses a traversal even when it resolves back inside the root", async () => {
    const response = await media(["videos", "v1", "..", "v1", "source.mp4"]);
    expect(response.status).toBe(400);
  });

  it("does not read a file that exists outside the store", async () => {
    const outside = join(root, "..", "media-route-bystander.txt");
    await writeFile(outside, "secret");
    try {
      const response = await media(["..", "media-route-bystander.txt"]);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("secret");
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("serves an ordinary nested key normally", async () => {
    expect((await media(SOURCE)).status).toBe(200);
  });
});

/* ------------------------------------------------------------ upload target */

describe("POST /api/upload/target", () => {
  /**
   * The filesystem adapter cannot sign anything, so the target is a route on
   * this origin. The client's code path is identical either way — `PUT` to
   * `url` with `headers` — which is the whole point of asking instead of
   * assuming.
   */
  it("hands back a proxy target when the store cannot sign", async () => {
    const response = await uploadTarget({
      key: "videos/v1/720p/seg-00001.m4s",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "proxy",
      key: "videos/v1/720p/seg-00001.m4s",
      url: "/api/upload/blob/videos/v1/720p/seg-00001.m4s",
      method: "PUT",
      headers: { "Content-Type": "video/iso.segment" },
    });
  });

  it("infers a content type from the key when none was stated", async () => {
    const body = await (
      await uploadTarget({ key: "videos/v1/captions-en.vtt" })
    ).json();
    expect(body.headers["Content-Type"]).toBe("text/vtt");
  });

  it("uses the content type the client stated", async () => {
    const body = await (
      await uploadTarget({
        key: "videos/v1/720p/seg-00001.m4s",
        contentType: "video/mp4",
      })
    ).json();
    expect(body.headers["Content-Type"]).toBe("video/mp4");
  });

  /**
   * The R2 branch, exercised with fabricated credentials and no network — a
   * presigned URL is computed, never dereferenced. Without this the direct path
   * would be the one nobody ran, which is exactly the one production uses.
   */
  it("hands back a presigned R2 target when the store can sign", async () => {
    useR2Driver();
    const body = await (
      await uploadTarget({ key: "videos/v1/720p/seg-00001.m4s" })
    ).json();

    expect(body.mode).toBe("direct");
    expect(body.expiresIn).toBe(900);
    expect(body.url).toContain(
      "https://acct123.r2.cloudflarestorage.com/media/videos/v1/720p/seg-00001.m4s",
    );
    expect(body.url).toContain("X-Amz-Signature=");
    expect(body.headers["Content-Type"]).toBe("video/iso.segment");
  });

  /**
   * §2.3: the content type is inside the signature and the upload's own header
   * must match byte-for-byte, or R2 answers a 403 the browser cannot read. The
   * response therefore has to name the header it signed, and name the same one.
   */
  it("signs the exact content type it tells the client to send", async () => {
    useR2Driver();
    const body = await (
      await uploadTarget({
        key: "videos/v1/720p/seg-00001.m4s",
        contentType: "video/mp4",
      })
    ).json();

    const signedHeaders = new URL(body.url).searchParams.get(
      "X-Amz-SignedHeaders",
    );
    expect(signedHeaders).toBe("content-type;host");
    expect(body.headers["Content-Type"]).toBe("video/mp4");
  });

  it("passes a shorter expiry through to the signature", async () => {
    useR2Driver();
    const body = await (
      await uploadTarget({ key: "videos/v1/thumb-hq.jpg", expiresIn: 60 })
    ).json();
    expect(new URL(body.url).searchParams.get("X-Amz-Expires")).toBe("60");
    expect(body.expiresIn).toBe(60);
  });

  it.each([
    ["a traversal in place of the id", { key: "videos/../../etc/passwd" }],
    /**
     * The one the namespace pattern alone would let through: the prefix and the
     * id are both perfectly well-formed, and the traversal is in the tail,
     * where `.` and `/` are legal characters of a filename.
     */
    ["a traversal below a valid id", { key: "videos/v1/../../../etc/passwd" }],
    ["a dot segment in the tail", { key: "videos/v1/./secrets" }],
    ["a namespace this app does not own", { key: "secrets/keys.json" }],
    ["a bare key with no id", { key: "videos/x.mp4" }],
    ["an absolute key", { key: "/videos/v1/source.mp4" }],
    ["no key", {}],
    ["a non-string key", { key: 7 }],
  ])("refuses %s", async (_label, body) => {
    expect((await uploadTarget(body)).status).toBe(400);
  });

  it("refuses a body that is not JSON at all", async () => {
    expect((await uploadTarget("not json")).status).toBe(400);
  });

  // A signed URL is minted per request and expires; a cached one hands a later
  // caller a grant issued to somebody else.
  it("is never cacheable", async () => {
    const response = await uploadTarget({ key: "videos/v1/thumb-hq.jpg" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

/* --------------------------------------------------------- upload receiver */

describe("PUT /api/upload/blob", () => {
  it("stores the body and reports what it wrote", async () => {
    const response = await uploadBlob(
      ["videos", "v9", "720p", "seg-00001.m4s"],
      "segment-bytes",
      { "content-type": "video/iso.segment" },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      key: "videos/v9/720p/seg-00001.m4s",
      size: 13,
      contentType: "video/iso.segment",
    });
  });

  /**
   * The seam the two routes share: an object written through the proxy path has
   * to be one the media route can range over. Testing either half alone would
   * leave this untested by both.
   */
  it("writes an object the media route can then range over", async () => {
    await uploadBlob(["videos", "v9", "source.mp4"], CONTENT, {
      "content-type": "video/mp4",
    });

    const response = await media(["videos", "v9", "source.mp4"], {
      range: "bytes=10-19",
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(await response.text()).toBe(CONTENT.slice(10, 20));
  });

  // A PUT with no body is a zero-byte object, which is what the verb means.
  it("accepts an empty body as a zero-byte object", async () => {
    const response = await uploadBlob(["videos", "v9", "empty.bin"], undefined, {
      "content-type": "application/octet-stream",
    });
    expect(response.status).toBe(201);
    expect((await response.json()).size).toBe(0);
  });

  it("falls back to the key's extension when no type was declared", async () => {
    const response = await uploadBlob(["videos", "v9", "master.m3u8"], "#EXTM3U");
    expect((await response.json()).contentType).toContain("mpegurl");
  });

  it.each([
    ["a traversal", ["videos", "..", "..", "etc", "passwd"]],
    ["separators smuggled into one segment", ["videos/../../etc/passwd"]],
    ["a namespace this app does not own", ["secrets", "keys.json"]],
  ])("refuses to write through %s", async (_label, segments) => {
    expect((await uploadBlob(segments, "owned")).status).toBe(400);
  });

  /**
   * §5.3: Vercel refuses a request body over 4.5 MB at the ingress layer,
   * before this function runs, and streaming does not exempt it. With R2
   * configured the honest answer is that this endpoint does not exist — a 404
   * is a far faster diagnosis than a 413 that only appears in production and
   * only above a size threshold.
   */
  it("does not exist when the store can be written to directly", async () => {
    useR2Driver();
    const response = await uploadBlob(
      ["videos", "v9", "720p", "seg-00002.m4s"],
      "should not be proxied",
      { "content-type": "video/iso.segment" },
    );
    expect(response.status).toBe(404);
  });
});

/* -------------------------------------------------------------- visibility */

const PRIVATE = ["videos", "private1", "source.mp4"] as const;
const UNLISTED = ["videos", "unlisted1", "source.mp4"] as const;

function signedInAs(token: string): Record<string, string> {
  return cookie(token);
}

describe("GET enforces visibility", () => {
  it("serves a public video to a signed-out caller", async () => {
    const response = await media(SOURCE);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
  });

  /**
   * The distinction that looks like an inconsistency and is not. An unlisted
   * video is a capability URL by definition — absent from feeds and search,
   * watchable by anyone holding the link — so at the blob layer it is public,
   * and gating it on a session would break the one thing unlisted is for.
   * `lib/auth/guard.ts` carries the full argument.
   */
  it("serves an unlisted video to a signed-out caller", async () => {
    const response = await media(UNLISTED);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
  });

  it("refuses a private video to a signed-out caller", async () => {
    expect((await media(PRIVATE)).status).toBe(404);
  });

  it("serves a private video to the owning channel's owner", async () => {
    const response = await media(PRIVATE, signedInAs(ownerToken));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
  });

  it("refuses a private video to a signed-in non-owner", async () => {
    expect((await media(PRIVATE, signedInAs(strangerToken))).status).toBe(404);
  });

  /**
   * The gate is in front of the range machinery, not woven into it. A `Range`
   * header must not be a way past it — and a 206 for a private video would be
   * a far quieter leak than a 200, because a player asks for ranges and a
   * human testing by hand does not.
   */
  it("refuses a private video to a ranged request too", async () => {
    const response = await media(PRIVATE, { range: "bytes=0-1" });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-range")).toBeNull();
  });

  it("refuses a private video on HEAD as well as GET", async () => {
    expect((await media(PRIVATE, {}, "HEAD")).status).toBe(404);
  });

  it("serves a channel's avatar to anyone", async () => {
    const response = await media(["channels", ownerChannelId, "avatar.jpg"]);
    expect(response.status).toBe(200);
  });

  it("refuses a video whose row does not exist", async () => {
    expect((await media(["videos", "neverwas", "source.mp4"])).status).toBe(404);
  });

  /**
   * `orphan1` has bytes in the store and no row in `videos` — a video deleted
   * after its ladder was written, which the schema's cascade cannot reach
   * because the blob store is not in it.
   *
   * This is the assertion the test above cannot make. When the object is
   * absent *as well*, a 404 proves only that absent bytes are absent, so a
   * mutation that made a missing row servable survived it — measured, by
   * deleting the row check and watching that test stay green. With bytes
   * present, the 404 can only have come from the gate.
   */
  it("refuses an orphaned object whose video row is gone", async () => {
    const response = await media(["videos", "orphan1", "source.mp4"]);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(CONTENT.slice(0, 10));
  });

  it("refuses a channel whose row does not exist", async () => {
    expect((await media(["channels", "neverwas", "avatar.jpg"])).status).toBe(
      404,
    );
  });

  /**
   * The fall-through, closed. A key in a namespace nothing here writes has no
   * owner and therefore no visibility, and "no rule applied" must mean refused
   * rather than served — otherwise every namespace added later inherits a hole
   * nobody chose.
   */
  it.each([
    ["a namespace this app does not own", ["secrets", "keys.json"]],
    ["an ad creative, which has no shape here yet", ["ads", "creative-1.mp4"]],
    ["a prefix with no tail", ["videos", "v1"]],
  ])("refuses %s", async (_label, segments) => {
    expect((await media(segments)).status).toBe(404);
  });
});

/**
 * The point of choosing 404 over 403, asserted directly.
 *
 * A 403 tells an enumerator that the id names something, which is precisely
 * what the unguessable id was protecting. So the refusal has to be
 * *indistinguishable* from the answer for a key that names nothing — not
 * merely "also a 404". Comparing the whole response is the only way to keep it
 * that way: a `Vary`, an `ETag`, a `Content-Length` computed on one path and
 * not the other would each reintroduce the oracle while both responses still
 * read 404.
 */
describe("a private video is indistinguishable from one that never existed", () => {
  async function fingerprint(
    response: Response,
  ): Promise<{ status: number; body: string; headers: string[][] }> {
    return {
      status: response.status,
      body: await response.text(),
      headers: [...response.headers].map(([name, value]) => [name, value]).sort(),
    };
  }

  it("matches the response for an id nothing was ever created under", async () => {
    const refused = await fingerprint(await media(PRIVATE));
    const absent = await fingerprint(await media(["videos", "neverwas", "source.mp4"]));
    expect(refused).toEqual(absent);
  });

  it("matches the response for a missing object under a video that exists", async () => {
    const refused = await fingerprint(await media(PRIVATE));
    const absent = await fingerprint(await media(["videos", "v1", "absent.mp4"]));
    expect(refused).toEqual(absent);
  });

  it("is still indistinguishable for a signed-in non-owner", async () => {
    const refused = await fingerprint(await media(PRIVATE, signedInAs(strangerToken)));
    const absent = await fingerprint(
      await media(["videos", "neverwas", "source.mp4"], signedInAs(strangerToken)),
    );
    expect(refused).toEqual(absent);
  });
});

/* --------------------------------------------------- upload authorisation */

describe("POST /api/upload/target authorises the caller", () => {
  it("refuses a caller with no session", async () => {
    const response = await uploadTarget(
      { key: "videos/v1/720p/seg-00001.m4s" },
      null,
    );
    expect(response.status).toBe(401);
  });

  it("refuses a session cookie that does not verify", async () => {
    const response = await uploadTarget(
      { key: "videos/v1/720p/seg-00001.m4s" },
      "not.a.jwt",
    );
    expect(response.status).toBe(401);
  });

  it("grants a target for the caller's own video", async () => {
    const response = await uploadTarget({ key: "videos/v1/720p/seg-00001.m4s" });
    expect(response.status).toBe(200);
  });

  it("grants a target for the caller's own channel", async () => {
    const response = await uploadTarget({
      key: `channels/${ownerChannelId}/avatar.jpg`,
    });
    expect(response.status).toBe(200);
  });

  it("refuses a target for another user's video", async () => {
    const response = await uploadTarget({
      key: "videos/theirs1/720p/seg-00001.m4s",
    });
    expect(response.status).toBe(404);
  });

  it("refuses a target for another user's channel", async () => {
    const response = await uploadTarget({
      key: `channels/${strangerChannelId}/avatar.jpg`,
    });
    expect(response.status).toBe(404);
  });

  /**
   * The video row precedes its segments, so an id with no row is not "an
   * upload that has not started" — it is an id nobody minted. Issuing a grant
   * for it would let any signed-in account squat any key it invented.
   */
  it("refuses a target for a video id that names no row", async () => {
    const response = await uploadTarget({
      key: "videos/neverwas/720p/seg-00001.m4s",
    });
    expect(response.status).toBe(404);
  });

  /**
   * Same 404 as a video that does not exist, not a 403 — for the reason the
   * media route gives. The bodies are compared, not just the statuses.
   */
  it("answers another user's video exactly as it answers a missing one", async () => {
    const theirs = await uploadTarget({ key: "videos/theirs1/thumb-hq.jpg" });
    const missing = await uploadTarget({ key: "videos/neverwas/thumb-hq.jpg" });
    expect(theirs.status).toBe(missing.status);
    expect(await theirs.text()).toBe(await missing.text());
  });

  /**
   * Shape before identity: a malformed key is refused on what the caller sent,
   * which discloses nothing, and it keeps a session read off a request that
   * could never have succeeded.
   */
  it("refuses a malformed key before it asks who is calling", async () => {
    const response = await uploadTarget({ key: "secrets/keys.json" }, null);
    expect(response.status).toBe(400);
  });

  it("still refuses the target when the store can sign", async () => {
    useR2Driver();
    const response = await uploadTarget(
      { key: "videos/theirs1/720p/seg-00001.m4s" },
      ownerToken,
    );
    expect(response.status).toBe(404);
  });
});

describe("PUT /api/upload/blob authorises the caller", () => {
  it("refuses a caller with no session", async () => {
    const response = await uploadBlob(
      ["videos", "v9", "720p", "seg-00009.m4s"],
      "segment-bytes",
      { "content-type": "video/iso.segment" },
      null,
    );
    expect(response.status).toBe(401);
  });

  it("refuses a write to another user's video", async () => {
    const response = await uploadBlob(
      ["videos", "theirs1", "720p", "seg-00009.m4s"],
      "segment-bytes",
      { "content-type": "video/iso.segment" },
    );
    expect(response.status).toBe(404);
  });

  it("refuses a write to another user's channel", async () => {
    const response = await uploadBlob(
      ["channels", strangerChannelId, "avatar.jpg"],
      "jpeg-bytes",
      { "content-type": "image/jpeg" },
    );
    expect(response.status).toBe(404);
  });

  it("refuses a write to a video id that names no row", async () => {
    const response = await uploadBlob(
      ["videos", "neverwas", "source.mp4"],
      "squatted",
    );
    expect(response.status).toBe(404);
  });

  /**
   * The one that would have been the real damage: an unauthorised `PUT` does
   * not merely fail to be recorded, it must not have written anything. Read
   * the object back to prove the bytes never landed.
   */
  it("does not write the bytes of a refused upload", async () => {
    await uploadBlob(
      ["videos", "theirs1", "source.mp4"],
      "overwritten-by-a-stranger",
      { "content-type": "video/mp4" },
    );
    const response = await media(
      ["videos", "theirs1", "source.mp4"],
      signedInAs(strangerToken),
    );
    expect(await response.text()).toBe(CONTENT);
  });

  it("still accepts a write to the caller's own video", async () => {
    const response = await uploadBlob(
      ["videos", "v9", "720p", "seg-00010.m4s"],
      "segment-bytes",
      { "content-type": "video/iso.segment" },
    );
    expect(response.status).toBe(201);
  });
});

/* --------------------------------------------- the R2 public-URL consequence */

/**
 * Once R2 has a public base URL the bytes are served from a domain this
 * process is not in the path of, so the check above is decorative for a
 * private video. The route refuses to answer rather than return a permission
 * that means nothing — see `assertPrivateMediaIsEnforceable` for why a throw
 * and not a quiet 404.
 */
describe("private media under a public R2 domain", () => {
  it("refuses to pretend it can enforce anything", async () => {
    useR2WithPublicDomain();
    await expect(media(PRIVATE, signedInAs(ownerToken))).rejects.toThrow(
      PrivateMediaNotEnforceableError,
    );
  });

  it("names the setting to change", async () => {
    useR2WithPublicDomain();
    await expect(media(PRIVATE)).rejects.toThrow(/R2_PUBLIC_BASE_URL/);
  });
});
