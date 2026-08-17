import { z } from "zod";

import { CACHE_CONTROL_NONE, blobStore } from "@/adapters/blob";
import { database } from "@/adapters/db";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import {
  claimsForVideo,
  findWork,
  scanVideo,
  type Claim,
} from "@/adapters/repositories/content-id";
import {
  getVideo,
  publishVideo,
  replaceRenditions,
  setTags,
  updateVideo,
} from "@/adapters/repositories/videos";
import { currentViewerId } from "@/lib/auth/guard";
import { BlobNotFoundError } from "@/ports/blob-store";

/**
 * The two writes that finish an upload.
 *
 * They are one route because they are one lifecycle and the second is
 * meaningless without the first, and they are two *stages* because they happen
 * minutes apart and for different reasons:
 *
 *  - **`media`** — sent by the browser the moment the last segment is stored.
 *    It records what was produced (the ladder, or the one progressive object),
 *    moves the row to `processing`, and runs the Content ID scan. The uploader
 *    is still filling in the form at this point; this is the work that has to
 *    be finished before the Checks step can say anything true.
 *  - **`publish`** — sent when the uploader presses Publish. It applies the
 *    details and the visibility and flips the row to `ready`.
 *
 * Collapsing them into one call would mean the copyright check could only ever
 * run *after* the decision to publish, which is precisely backwards: Studio's
 * Checks step exists so that the uploader sees a claim before they commit.
 *
 * ## What is trusted, and what is verified
 *
 * The client supplies the keys and the rendition metadata, because the client
 * is the only thing that knows them — it did the encoding. Two checks stand
 * between that and a video row that points at somebody else's bytes:
 *
 *  1. **Every key must sit under `videos/{id}/`.** Without it, a signed-in
 *     account could publish a video whose master playlist is another video's,
 *     and the ownership check at `/api/media` would then happily serve it,
 *     because the key it resolves belongs to a video the *caller* owns. The
 *     check is on the key's prefix, and it is the whole of the defence.
 *  2. **Every manifest must exist.** research/05 §3.2 is explicit that a
 *     direct-to-R2 upload moves validation from "before it's stored" to "after
 *     it's stored, before it's trusted", and names the mechanism: a `HeadObject`
 *     after the client reports completion. That is what the head loop below is.
 *     It checks the master playlist, and each rung's init segment and playlist
 *     — a bounded 2N+1 — and **not** every segment, which for a ten-minute
 *     six-rung ladder would be 1,800 round trips on the publish path. A segment
 *     that failed to store therefore surfaces as a stall at that point in
 *     playback rather than as a refusal here; the honest fix is the reaper §3.2
 *     describes, and it is not built.
 */
export const runtime = "nodejs";

const RenditionBody = z.object({
  name: z.string().min(1).max(32),
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  bandwidth: z.number().int().nonnegative(),
  codec: z.string().min(1).max(64),
  frameRate: z.number().positive().max(1000),
  initKey: z.string().min(1).max(1024),
  playlistKey: z.string().min(1).max(1024),
  segmentCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});

/**
 * The landmark set, as JSON carries it.
 *
 * `int32` on both sides is not incidental. `content-id.ts`'s header explains
 * the trap at length: `fingerprints.hash` is a **signed** 32-bit column, and a
 * value that arrives as a positive number above 2^31 overflows `int4` outright.
 * The repository's `toStoredHash` is the conversion; this bound is what stops a
 * malformed body reaching it.
 */
const FingerprintBody = z.object({
  hashes: z.array(z.number().int().min(-2_147_483_648).max(2_147_483_647)).max(2_000_000),
  offsetsMs: z.array(z.number().int().min(-2_147_483_648).max(2_147_483_647)).max(2_000_000),
  durationMs: z.number().int().nonnegative(),
});

const MediaBody = z.object({
  kind: z.literal("media"),
  pipeline: z.enum(["laddered", "progressive"]),
  durationSeconds: z.number().nonnegative().max(12 * 60 * 60),
  width: z.number().int().nonnegative().max(16_384),
  height: z.number().int().nonnegative().max(16_384),
  masterPlaylistKey: z.string().min(1).max(1024).optional(),
  progressiveKey: z.string().min(1).max(1024).optional(),
  renditions: z.array(RenditionBody).max(12).optional(),
  fingerprint: FingerprintBody.optional(),
});

const PublishBody = z.object({
  kind: z.literal("publish"),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000),
  visibility: z.enum(["public", "unlisted", "private"]),
  category: z.string().min(1).max(64),
  tags: z.array(z.string().trim().min(1).max(64)).max(30),
});

const RequestBody = z.discriminatedUnion("kind", [MediaBody, PublishBody]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const parsed = RequestBody.safeParse(await readJson(request));
  if (!parsed.success) {
    return json(400, {
      error: 'Expected { kind: "media", … } or { kind: "publish", … }.',
    });
  }

  const viewer = await currentViewerId(request);
  if (!viewer) return json(401, { error: "Sign in to publish." });

  const db = await database();
  const video = await getVideo(db, id);
  if (!video) return json(404, { error: "No such video." });

  const channel = await createChannelsRepository(db).findById(video.channelId);
  if (!channel || channel.ownerId !== viewer) {
    return json(404, { error: "No such video." });
  }

  return parsed.data.kind === "media"
    ? writeMedia(db, id, parsed.data)
    : publish(db, id, parsed.data);
}

type Db = Awaited<ReturnType<typeof database>>;

async function writeMedia(
  db: Db,
  id: string,
  body: z.infer<typeof MediaBody>,
): Promise<Response> {
  const prefix = `videos/${id}/`;
  const keys = [
    ...(body.masterPlaylistKey === undefined ? [] : [body.masterPlaylistKey]),
    ...(body.progressiveKey === undefined ? [] : [body.progressiveKey]),
    ...(body.renditions ?? []).flatMap((rendition) => [
      rendition.initKey,
      rendition.playlistKey,
    ]),
  ];

  for (const key of keys) {
    if (!key.startsWith(prefix) || key.includes("..")) {
      return json(400, {
        error: `${key} is not a key belonging to this video.`,
      });
    }
  }

  if (body.pipeline === "laddered") {
    if (!body.masterPlaylistKey || (body.renditions ?? []).length === 0) {
      return json(400, {
        error: "A laddered video needs a master playlist and at least one rendition.",
      });
    }
  } else if (!body.progressiveKey) {
    return json(400, { error: "A progressive video needs its source key." });
  }

  const store = await blobStore();
  for (const key of keys) {
    try {
      await store.head(key);
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        return json(409, {
          error: `${key} was named but never stored. Nothing has been published.`,
        });
      }
      throw error;
    }
  }

  if (body.renditions) await replaceRenditions(db, id, body.renditions);

  await updateVideo(db, id, {
    // `processing` rather than `ready`: the bytes are all there, but the row
    // does not become playable until the uploader presses Publish. Studio's
    // table renders the difference and so does every feed, which filters on
    // `upload_status = 'ready'`.
    uploadStatus: "processing",
    pipeline: body.pipeline,
    durationSeconds: body.durationSeconds,
    width: body.width,
    height: body.height,
    masterPlaylistKey: body.masterPlaylistKey ?? null,
    progressiveKey: body.progressiveKey ?? null,
  });

  /**
   * The scan, and why a failure here is not a failure.
   *
   * D12: matching runs in the pass that is already decoding the audio, so it
   * costs the server nothing but the histogram query. `scanVideo` raises claims
   * and touches no visibility — "a match creates a claim, not a takedown" — so
   * there is nothing here that can make a video disappear.
   *
   * The fingerprint is optional because computing it needs an audio decoder in
   * the uploader's browser, and the browsers that lack one are not the same set
   * as the browsers that lack a video encoder. `scanned: false` is reported as
   * "the check did not run", never as "nothing matched": those are different
   * facts and only one of them is reassuring.
   */
  let scanned = false;
  if (body.fingerprint && body.fingerprint.hashes.length > 0) {
    await scanVideo(db, id, {
      hashes: Int32Array.from(body.fingerprint.hashes),
      offsetsMs: Int32Array.from(body.fingerprint.offsetsMs),
      durationMs: body.fingerprint.durationMs,
    });
    scanned = true;
  }

  return json(200, {
    uploadStatus: "processing",
    scanned,
    claims: await claimViews(db, id),
  });
}

async function publish(
  db: Db,
  id: string,
  body: z.infer<typeof PublishBody>,
): Promise<Response> {
  const video = await getVideo(db, id);
  if (!video) return json(404, { error: "No such video." });
  if (video.uploadStatus === "uploading") {
    return json(409, {
      error:
        "This upload has not finished storing its media yet, so there is " +
        "nothing to publish.",
    });
  }

  await setTags(db, id, body.tags);
  await updateVideo(db, id, {
    title: body.title,
    description: body.description,
    visibility: body.visibility,
    category: body.category,
  });
  // `publishVideo` derives `is_short` in the same statement, from the row's own
  // width, height and duration — never from anything this request carried.
  const published = await publishVideo(db, id);

  return json(200, {
    uploadStatus: published?.uploadStatus ?? "processing",
    scanned: true,
    claims: await claimViews(db, id),
  });
}

/**
 * Claims, joined to the works they cite.
 *
 * A claim carries a `reference_id` and the policy that was applied *to it*; the
 * title and the rights-holder live on the work. `findWork` is called once per
 * *distinct* reference rather than once per claim, because a video that reuses
 * one track in three places produces three claims against one work.
 */
async function claimViews(db: Db, videoId: string) {
  const claims = await claimsForVideo(db, videoId);
  const references = new Map<string, { title: string; rightsHolder: string }>();

  for (const referenceId of new Set(claims.map((claim) => claim.referenceId))) {
    const work = await findWork(db, referenceId);
    references.set(referenceId, {
      title: work?.title ?? "A withdrawn reference",
      rightsHolder: work?.rightsHolder ?? "Unknown",
    });
  }

  return claims.map((claim: Claim) => ({
    id: claim.id,
    policy: claim.policy,
    status: claim.status,
    matchStartMs: claim.matchStartMs,
    matchEndMs: claim.matchEndMs,
    referenceOffsetMs: claim.referenceOffsetMs,
    score: claim.score,
    referenceTitle: references.get(claim.referenceId)?.title ?? "Unknown",
    rightsHolder: references.get(claim.referenceId)?.rightsHolder ?? "Unknown",
  }));
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
    headers: { "Content-Type": "application/json", "Cache-Control": CACHE_CONTROL_NONE },
  });
}
