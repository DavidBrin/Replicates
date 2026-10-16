// @vitest-environment node

import { describe, expect, it } from "vitest";

import { BlobNotFoundError, BlobRangeNotSatisfiableError } from "@/ports/blob-store";
import { VercelBlobStore } from "@/adapters/blob/vercel-blob";

/**
 * The one test in this directory that touches the network, and it is opt-in:
 *
 *     VERCEL_BLOB_LIVE=1 BLOB_READ_WRITE_TOKEN=… pnpm exec vitest run vercel-blob.live
 *
 * It exists because every other test of this adapter answers with a fake, and
 * the questions that matter most — does the public host honour `Range`, does
 * it send an `ETag`, does a presigned `PUT` accept a plain upload with a
 * `Content-Type` — can only be asked of the real store. It writes and deletes
 * one small object under `_smoke/` and leaves nothing behind.
 */
const token = process.env.BLOB_READ_WRITE_TOKEN;
const live = process.env.VERCEL_BLOB_LIVE === "1" && typeof token === "string";

describe.skipIf(!live)("Vercel Blob, against the real store", () => {
  const key = `_smoke/${Date.now()}/source.mp4`;
  const payload = new TextEncoder().encode("0123456789abcdef");

  it("round-trips an object through put, head, ranged get, presigned put and delete", async () => {
    const store = new VercelBlobStore({ token: token ?? "" });
    const stored = await store.put(key, payload, { contentType: "video/mp4", immutable: true });
    expect(stored.size).toBe(16);
    expect(stored.etag).not.toBe("");

    const head = await store.head(key);
    expect(head.size).toBe(16);
    expect(head.etag).toBe(stored.etag);

    const whole = await store.get(key);
    expect(await new Response(whole.body).text()).toBe("0123456789abcdef");
    expect(whole.metadata.etag).not.toBe("");

    const part = await store.get(key, { range: { start: 2, end: 5 } });
    expect(part.range).toEqual({ start: 2, end: 5, total: 16 });
    expect(await new Response(part.body).text()).toBe("2345");

    await expect(store.get(key, { range: { start: 100 } })).rejects.toBeInstanceOf(
      BlobRangeNotSatisfiableError,
    );

    const direct = await store.signedUrl(key);
    expect(direct).toBe(store.urlFor(key));
    const viaCdn = await fetch(direct!);
    expect(viaCdn.status).toBe(200);
    expect(await viaCdn.text()).toBe("0123456789abcdef");

    const upload = await store.signedUrl(key, { method: "PUT", contentType: "video/mp4" });
    expect(upload).toMatch(/^https:\/\//);
    const put = await fetch(upload!, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
      body: "replaced",
    });
    expect(put.status, await put.text()).toBeLessThan(300);
    expect((await store.head(key)).size).toBe(8);

    const listed = await store.list(`_smoke/`);
    expect(listed.objects.some((o) => o.key === key)).toBe(true);

    await store.delete(key);
    await expect(store.head(key)).rejects.toBeInstanceOf(BlobNotFoundError);
  }, 60_000);
});
