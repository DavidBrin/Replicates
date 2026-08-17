import { z } from "zod";

import { database } from "@/adapters/db";
import {
  LikedPlaylistIsDerivedError,
  PlaylistNotFoundError,
  SystemPlaylistIsFixedError,
  addVideo,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  removeVideo,
  updatePlaylist,
} from "@/adapters/repositories/playlists";
import { authorizeVideoAccess } from "@/adapters/repositories/media-access";
import { currentViewerId } from "@/lib/auth/guard";

/**
 * Everything the playlist surfaces write.
 *
 * ## One route, five actions
 *
 * Create, rename, delete, add-video, remove-video. They share an owner check, a
 * viewer lookup and an error mapping, and splitting them across five files
 * would mean maintaining five copies of the check that actually matters —
 * *the caller owns this playlist* — which is the check that is expensive to get
 * wrong. The discriminator is in the body, exactly as the reactions route puts
 * its target there.
 *
 * ## The owner check is this file's job, not the repository's
 *
 * `playlists.addVideo` verifies the playlist exists and refuses the liked list;
 * it does **not** ask who is calling, because it is also called from inside
 * transactions that have already decided. So an HTTP caller must be checked
 * here, and it is checked by reading the playlist and comparing `ownerId` —
 * before any write, and for every action that touches a playlist by id.
 *
 * A playlist that is not yours reads back **404, not 403**: a 403 confirms the
 * id exists, and a private playlist's existence is itself private. This is the
 * same reasoning `lib/auth/guard.ts` gives for collapsing every session failure
 * into one answer.
 *
 * ## The three domain errors, and why each maps where it does
 *
 * * `LikedPlaylistIsDerivedError` → **409**. The request is well formed and the
 *   caller is allowed; the resource simply cannot be edited this way, because a
 *   video is in the liked list *because* it was liked. The UI already renders
 *   that as a disabled row (`components/playlist`), so a 409 here is the
 *   backstop for a caller that skipped the UI — not the normal path.
 * * `SystemPlaylistIsFixedError` → **409**, for the same reason: Watch later
 *   exists per owner by schema and cannot be renamed or deleted.
 * * `PlaylistNotFoundError` → **404**, which is where a wrong id ends up
 *   anyway.
 */

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    title: z.string().min(1).max(150),
    visibility: z.enum(["public", "unlisted", "private"]).optional(),
    description: z.string().max(5_000).optional(),
  }),
  z.object({
    action: z.literal("rename"),
    playlistId: z.string().min(1),
    title: z.string().min(1).max(150),
  }),
  z.object({
    action: z.literal("delete"),
    playlistId: z.string().min(1),
  }),
  z.object({
    action: z.literal("add"),
    playlistId: z.string().min(1),
    videoId: z.string().min(1),
  }),
  z.object({
    action: z.literal("remove"),
    playlistId: z.string().min(1),
    videoId: z.string().min(1),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  const viewerId = await currentViewerId(request);
  if (viewerId === null) {
    return Response.json({ error: "Sign in to save videos." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error:
          "Expected one of: create, rename, delete, add, remove — with its own fields.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const command = parsed.data;
  const db = await database();

  if (command.action === "create") {
    const created = await createPlaylist(db, {
      ownerId: viewerId,
      title: command.title,
      description: command.description ?? "",
      visibility: command.visibility ?? "private",
    });
    return Response.json(created, { status: 201 });
  }

  // Read once, before anything writes. `getPlaylist` is the only place this
  // route learns both that the playlist exists and who owns it, and both
  // answers collapse into the same 404 — see the header.
  const playlist = await getPlaylist(db, command.playlistId);
  if (playlist === null || playlist.ownerId !== viewerId) {
    return Response.json({ error: "No such playlist." }, { status: 404 });
  }

  try {
    switch (command.action) {
      case "rename": {
        const updated = await updatePlaylist(db, command.playlistId, {
          title: command.title,
        });
        return Response.json(updated);
      }
      case "delete": {
        const removed = await deletePlaylist(db, command.playlistId);
        return Response.json({ deleted: removed });
      }
      case "add": {
        /**
         * Owning the playlist is not permission to reference any video.
         *
         * The check above establishes that this caller owns the *container*.
         * The thing being put into it is a second resource with its own
         * visibility, and nothing here consulted it — so a private video could
         * be added to a stranger's playlist by guessing its id, and the
         * response distinguished "added" from "no such video", which makes the
         * endpoint an existence oracle for ids that are otherwise unguessable.
         *
         * Refused as a 404 on the *playlist*'s wording deliberately: a message
         * naming the video would confirm the route got as far as looking one
         * up, which is the same disclosure in a politer form.
         */
        if ((await authorizeVideoAccess(command.videoId, viewerId)) === null) {
          return Response.json({ error: "No such video." }, { status: 404 });
        }
        const added = await addVideo(db, command.playlistId, command.videoId);
        // `false` means the video was already there — `appendItem` is
        // `on conflict do nothing`, and pressing a toggle that is already on is
        // not an error. The response says which happened rather than pretending
        // a write occurred.
        return Response.json({ added });
      }
      case "remove": {
        const dropped = await removeVideo(db, command.playlistId, command.videoId);
        return Response.json({ removed: dropped });
      }
    }
  } catch (cause) {
    if (cause instanceof LikedPlaylistIsDerivedError) {
      return Response.json(
        {
          error:
            "The liked playlist follows your likes. Like or unlike the video instead.",
        },
        { status: 409 },
      );
    }
    if (cause instanceof SystemPlaylistIsFixedError) {
      return Response.json(
        { error: "This playlist is built in and cannot be renamed or deleted." },
        { status: 409 },
      );
    }
    if (cause instanceof PlaylistNotFoundError) {
      // Reachable despite the read above: the playlist can be deleted by
      // another request between the check and the write.
      return Response.json({ error: "No such playlist." }, { status: 404 });
    }
    throw cause;
  }
}
