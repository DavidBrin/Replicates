import { z } from "zod";

import { database } from "@/adapters/db";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import { createVideo, deleteVideo, getVideo } from "@/adapters/repositories/videos";
import { CACHE_CONTROL_NONE } from "@/adapters/blob";
import { currentViewerId } from "@/lib/auth/guard";

/**
 * The two ends of an upload's lifetime: mint the row, or throw it away.
 *
 * ## Why the row comes first
 *
 * `src/app/api/upload/target/route.ts` refuses to issue a write grant for a key
 * whose video row does not exist, and its header explains what that closes: the
 * permissive reading would let any signed-in account write bytes under any id
 * it invented and squat the key a real upload was about to use. So the id has
 * to be minted somewhere, by something that checks who is asking, before a
 * single byte can be stored. This is that thing, and it is the only one.
 *
 * The row is created `upload_status = 'uploading'`, which the schema is built
 * for: a video exists here long before it is playable, and may never become
 * playable at all.
 *
 * ## Why `DELETE` lives on the same route rather than at `/api/videos/{id}`
 *
 * Because it is the *undo* of the `POST` above it, not a general "delete a
 * video" endpoint, and keeping the pair in one file is what stops the two
 * halves of an upload's lifecycle from drifting apart. It refuses anything that
 * has been published: a `DELETE` here is "this upload never happened", and a
 * ready video is a different, heavier operation — its objects have to be swept
 * out of the blob store by prefix (research/05 §7.1), its claims released, its
 * playlists invalidated — that belongs with whatever owns the channel's
 * content management, not with the upload flow's cancel button.
 *
 * That refusal is also the answer to abandonment. A tab closed mid-encode
 * leaves the row `uploading` forever; Studio lists it as an incomplete upload
 * and this is the affordance behind its Delete. See the resumability note in
 * `src/components/studio/upload-dialog.tsx`.
 */
export const runtime = "nodejs";

/**
 * Bounds, not preferences.
 *
 * The title cap is YouTube's own (100 characters, enforced in the composer
 * before the request is ever made — this is the copy of the rule that a client
 * cannot skip). The dimension cap is the ladder's: `LADDER_REFERENCE_RUNGS`
 * stops at 1080p, and a source claiming 65,536 pixels a side is a corrupt probe
 * rather than a video.
 */
const TITLE_MAX = 100;
const DIMENSION_MAX = 16_384;
const DURATION_MAX_SECONDS = 12 * 60 * 60;

const CreateBody = z.object({
  channelId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(TITLE_MAX),
  pipeline: z.enum(["laddered", "progressive"]).optional(),
  durationSeconds: z.number().nonnegative().max(DURATION_MAX_SECONDS).optional(),
  width: z.number().int().nonnegative().max(DIMENSION_MAX).optional(),
  height: z.number().int().nonnegative().max(DIMENSION_MAX).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const parsed = CreateBody.safeParse(await readJson(request));
  if (!parsed.success) {
    return json(400, {
      error: "Expected { channelId, title, pipeline?, durationSeconds?, width?, height? }.",
    });
  }

  const viewer = await currentViewerId(request);
  if (!viewer) return json(401, { error: "Sign in to upload." });

  const db = await database();
  const channel = await createChannelsRepository(db).findById(parsed.data.channelId);
  // The same 404 for "no such channel" and "not yours", for the reason
  // `/api/media` gives: a 403 confirms the id names something.
  if (!channel || channel.ownerId !== viewer) {
    return json(404, { error: "No such channel." });
  }

  const video = await createVideo(db, {
    channelId: channel.id,
    title: parsed.data.title,
    // Private until the uploader says otherwise. YouTube's own default for a
    // fresh upload, and the only safe one: the row exists for minutes with no
    // playable bytes behind it, and a public row in that state is a broken
    // video in every feed that lists it.
    visibility: "private",
    ...(parsed.data.pipeline === undefined ? {} : { pipeline: parsed.data.pipeline }),
    ...(parsed.data.durationSeconds === undefined
      ? {}
      : { durationSeconds: parsed.data.durationSeconds }),
    ...(parsed.data.width === undefined ? {} : { width: parsed.data.width }),
    ...(parsed.data.height === undefined ? {} : { height: parsed.data.height }),
  });

  return json(201, {
    id: video.id,
    channelId: video.channelId,
    uploadStatus: video.uploadStatus,
    pipeline: video.pipeline,
    visibility: video.visibility,
  });
}

/**
 * Discard an upload that never finished.
 *
 * The id is a query parameter rather than a body because a `DELETE` body is
 * legal, ignored by several intermediaries, and not sent at all by `sendBeacon`
 * — and an abandoned upload is exactly the case where the caller may be a
 * page that is going away.
 */
export async function DELETE(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json(400, { error: "Expected ?id=." });

  const viewer = await currentViewerId(request);
  if (!viewer) return json(401, { error: "Sign in to manage uploads." });

  const db = await database();
  const video = await getVideo(db, id);
  if (!video) return json(404, { error: "No such video." });

  const channel = await createChannelsRepository(db).findById(video.channelId);
  if (!channel || channel.ownerId !== viewer) {
    return json(404, { error: "No such video." });
  }

  if (video.uploadStatus === "ready") {
    return json(409, {
      error:
        "This video has been published. Deleting a published video also has to " +
        "sweep its objects out of storage, which this endpoint deliberately " +
        "does not do.",
    });
  }

  await deleteVideo(db, id);
  /**
   * The blobs are **not** swept here, and that is a decision rather than an
   * omission. An abandoned upload's objects are unreferenced — no playlist
   * names them, `videos.master_playlist_key` is null, and the row they hung off
   * is gone — so they are orphans of exactly the kind research/05 §3.2
   * describes, reaped by prefix (§7.1: one `ListObjectsV2` + one
   * `DeleteObjects`). Doing it inline would put a paginated list-and-delete on
   * the cancel button's critical path, and `BlobStore.list` pagination is the
   * bug D16 already records once.
   */
  return json(200, { id, deleted: true });
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
