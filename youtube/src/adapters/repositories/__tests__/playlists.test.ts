// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import {
  LikedPlaylistIsDerivedError,
  PLAYLIST_POSITION_STEP,
  PlaylistNotFoundError,
  SystemPlaylistIsFixedError,
  addToWatchLater,
  addVideo,
  createPlaylist,
  deletePlaylist,
  ensureSystemPlaylist,
  getPlaylist,
  listPlaylistItems,
  listPlaylists,
  moveVideo,
  removeFromWatchLater,
  removeVideo,
  setLikedMembership,
  updatePlaylist,
} from "../playlists";
import type { QueryCounter } from "./library-harness";
import {
  countingDatabase,
  createTestDatabase,
  seedChannel,
  seedCreator,
  seedUser,
  seedVideo,
} from "./library-harness";

let db: SqlDatabase & QueryCounter;
let raw: SqlDatabase;

beforeAll(async () => {
  raw = await createTestDatabase();
  db = countingDatabase(raw);
});

afterAll(async () => {
  await raw.close();
});

beforeEach(async () => {
  await raw.execute("delete from playlists");
  await raw.execute("delete from videos");
  await raw.execute("delete from channels");
  await raw.execute("delete from users");
  db.reset();
});

/** The item order as stored, so a test can look at positions and not only order. */
async function items(
  playlistId: string,
): Promise<{ videoId: string; position: number }[]> {
  const rows = await raw.query(
    `select video_id, position from playlist_items
      where playlist_id = $1 order by position, added_at, video_id`,
    [playlistId],
  );
  return rows.map((r) => ({
    videoId: String(r.video_id),
    position: Number(r.position),
  }));
}

describe("creating playlists", () => {
  it("creates a private user playlist with its owner's name", async () => {
    const owner = await seedUser(raw, { displayName: "Ada" });
    const playlist = await createPlaylist(db, { ownerId: owner, title: "Deep work" });

    expect(playlist.kind).toBe("user");
    expect(playlist.visibility).toBe("private");
    expect(playlist.ownerName).toBe("Ada");
    expect(playlist.itemCount).toBe(0);
    expect(playlist.thumbnailKey).toBeNull();
  });

  it("creates each system playlist once per owner", async () => {
    const owner = await seedUser(raw);

    const first = await ensureSystemPlaylist(db, owner, "watch_later");
    const second = await ensureSystemPlaylist(db, owner, "watch_later");
    const liked = await ensureSystemPlaylist(db, owner, "liked");

    expect(second).toBe(first);
    expect(liked).not.toBe(first);
    expect((await getPlaylist(db, first))?.title).toBe("Watch later");
    expect((await getPlaylist(db, liked))?.title).toBe("Liked videos");
  });

  it("resolves a system playlist in one statement", async () => {
    const owner = await seedUser(raw);
    await ensureSystemPlaylist(db, owner, "liked");

    db.reset();
    await ensureSystemPlaylist(db, owner, "liked");
    expect(db.count).toBe(1);
  });

  it("gives two owners their own watch-later playlists", async () => {
    const one = await seedUser(raw);
    const two = await seedUser(raw);
    expect(await ensureSystemPlaylist(db, one, "watch_later")).not.toBe(
      await ensureSystemPlaylist(db, two, "watch_later"),
    );
  });
});

describe("the playlists a system playlist is not", () => {
  it("refuses to rename or delete one", async () => {
    const owner = await seedUser(raw);
    const liked = await ensureSystemPlaylist(db, owner, "liked");

    await expect(
      updatePlaylist(db, liked, { title: "My favourites" }),
    ).rejects.toBeInstanceOf(SystemPlaylistIsFixedError);
    await expect(deletePlaylist(db, liked)).rejects.toBeInstanceOf(
      SystemPlaylistIsFixedError,
    );
  });

  it("lets its visibility change, which is the owner's to set", async () => {
    const owner = await seedUser(raw);
    const later = await ensureSystemPlaylist(db, owner, "watch_later");
    const updated = await updatePlaylist(db, later, { visibility: "public" });
    expect(updated?.visibility).toBe("public");
    expect(updated?.title).toBe("Watch later");
  });

  it("deletes a user playlist", async () => {
    const owner = await seedUser(raw);
    const playlist = await createPlaylist(db, { ownerId: owner, title: "Temp" });
    expect(await deletePlaylist(db, playlist.id)).toBe(true);
    expect(await getPlaylist(db, playlist.id)).toBeNull();
    expect(await deletePlaylist(db, playlist.id)).toBe(false);
  });
});

describe("the liked playlist has one door", () => {
  it("refuses a direct add", async () => {
    const owner = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);
    const liked = await ensureSystemPlaylist(db, owner, "liked");

    await expect(addVideo(db, liked, videoId)).rejects.toBeInstanceOf(
      LikedPlaylistIsDerivedError,
    );
    expect(await items(liked)).toHaveLength(0);
  });

  it("refuses a direct remove", async () => {
    const owner = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);
    const liked = await ensureSystemPlaylist(db, owner, "liked");
    await setLikedMembership(db, owner, videoId, true);

    await expect(removeVideo(db, liked, videoId)).rejects.toBeInstanceOf(
      LikedPlaylistIsDerivedError,
    );
    expect(await items(liked)).toHaveLength(1);
  });

  it("adds and removes through the membership door", async () => {
    const owner = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    await setLikedMembership(db, owner, videoId, true);
    // Liking twice is one membership, not two.
    await setLikedMembership(db, owner, videoId, true);
    const liked = await ensureSystemPlaylist(db, owner, "liked");
    expect(await items(liked)).toHaveLength(1);

    await setLikedMembership(db, owner, videoId, false);
    expect(await items(liked)).toHaveLength(0);
  });

  it("creates the playlist on the first like", async () => {
    const owner = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    await setLikedMembership(db, owner, videoId, true);

    const playlists = await listPlaylists(db, owner);
    expect(playlists.map((p) => p.kind)).toEqual(["liked"]);
    expect(playlists[0]?.itemCount).toBe(1);
  });
});

describe("adding and listing items", () => {
  it("appends with a gap between each item", async () => {
    const owner = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const playlist = await createPlaylist(db, { ownerId: owner, title: "Queue" });

    const a = await seedVideo(raw, channelId);
    const b = await seedVideo(raw, channelId);
    await addVideo(db, playlist.id, a);
    await addVideo(db, playlist.id, b);

    expect(await items(playlist.id)).toEqual([
      { videoId: a, position: PLAYLIST_POSITION_STEP },
      { videoId: b, position: 2 * PLAYLIST_POSITION_STEP },
    ]);
  });

  it("holds a video once", async () => {
    const owner = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const playlist = await createPlaylist(db, { ownerId: owner, title: "Queue" });
    const a = await seedVideo(raw, channelId);

    expect(await addVideo(db, playlist.id, a)).toBe(true);
    expect(await addVideo(db, playlist.id, a)).toBe(false);
    expect(await items(playlist.id)).toHaveLength(1);
  });

  it("rejects a playlist that does not exist", async () => {
    const { channelId } = await seedCreator(raw);
    const a = await seedVideo(raw, channelId);
    await expect(addVideo(db, "missing", a)).rejects.toBeInstanceOf(
      PlaylistNotFoundError,
    );
  });

  it("resolves watch later without the caller naming it", async () => {
    const owner = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const a = await seedVideo(raw, channelId);

    await addToWatchLater(db, owner, a);
    const later = await ensureSystemPlaylist(db, owner, "watch_later");
    expect(await items(later)).toHaveLength(1);

    expect(await removeFromWatchLater(db, owner, a)).toBe(true);
    expect(await removeFromWatchLater(db, owner, a)).toBe(false);
  });

  it("shows the count and the first item's thumbnail on the card", async () => {
    const owner = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const playlist = await createPlaylist(db, { ownerId: owner, title: "Queue" });
    const first = await seedVideo(raw, channelId);
    await addVideo(db, playlist.id, first);
    await addVideo(db, playlist.id, await seedVideo(raw, channelId));

    db.reset();
    const listed = await listPlaylists(db, owner);

    expect(db.count).toBe(1);
    expect(listed[0]?.itemCount).toBe(2);
    expect(listed[0]?.thumbnailKey).toBe(`${first}/thumb.jpg`);
  });

  it("is empty and free for a signed-out viewer", async () => {
    db.reset();
    expect(await listPlaylists(db, null)).toEqual([]);
    expect(db.count).toBe(0);
  });

  it("fetches forty items across forty channels in one statement", async () => {
    const owner = await seedUser(raw);
    const playlist = await createPlaylist(db, { ownerId: owner, title: "Big" });

    for (let i = 0; i < 40; i += 1) {
      const creatorId = await seedUser(raw);
      const channelId = await seedChannel(raw, creatorId);
      const videoId = await seedVideo(raw, channelId);
      await addVideo(db, playlist.id, videoId);
      await raw.execute(
        `insert into watch_progress (user_id, video_id, position_seconds)
         values ($1, $2, $3)`,
        [owner, videoId, i],
      );
    }

    db.reset();
    const cards = await listPlaylistItems(db, playlist.id, { viewerId: owner });

    expect(db.count).toBe(1);
    expect(cards).toHaveLength(40);
    expect(cards.every((c) => c.channelName.length > 0)).toBe(true);
    expect(cards.every((c) => typeof c.watchedSeconds === "number")).toBe(true);
  });

  it("returns the owner's order, not the videos' publish order", async () => {
    const owner = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const playlist = await createPlaylist(db, { ownerId: owner, title: "Queue" });

    const oldest = await seedVideo(raw, channelId, {
      publishedAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const newest = await seedVideo(raw, channelId, {
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await addVideo(db, playlist.id, newest);
    await addVideo(db, playlist.id, oldest);

    expect((await listPlaylistItems(db, playlist.id)).map((c) => c.id)).toEqual([
      newest,
      oldest,
    ]);
  });
});

describe("reordering", () => {
  async function threeItems(): Promise<{
    playlistId: string;
    ids: [string, string, string];
  }> {
    const owner = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const playlist = await createPlaylist(db, { ownerId: owner, title: "Queue" });
    const a = await seedVideo(raw, channelId);
    const b = await seedVideo(raw, channelId);
    const c = await seedVideo(raw, channelId);
    for (const id of [a, b, c]) await addVideo(db, playlist.id, id);
    return { playlistId: playlist.id, ids: [a, b, c] };
  }

  it("moves an item to the top", async () => {
    const { playlistId, ids } = await threeItems();
    const [a, b, c] = ids;

    await moveVideo(db, playlistId, c, null);

    expect((await items(playlistId)).map((i) => i.videoId)).toEqual([c, a, b]);
  });

  it("moves an item into a gap without touching its neighbours", async () => {
    const { playlistId, ids } = await threeItems();
    const [a, b, c] = ids;
    const before = await items(playlistId);

    const position = await moveVideo(db, playlistId, c, a);

    expect((await items(playlistId)).map((i) => i.videoId)).toEqual([a, c, b]);
    expect(position).toBe(
      Math.floor((PLAYLIST_POSITION_STEP + 2 * PLAYLIST_POSITION_STEP) / 2),
    );
    // The neighbours kept the positions they already had: one row was written.
    const after = new Map((await items(playlistId)).map((i) => [i.videoId, i.position]));
    expect(after.get(a)).toBe(before[0]?.position);
    expect(after.get(b)).toBe(before[1]?.position);
  });

  it("moves an item to the end", async () => {
    const { playlistId, ids } = await threeItems();
    const [a, b, c] = ids;

    await moveVideo(db, playlistId, a, c);

    expect((await items(playlistId)).map((i) => i.videoId)).toEqual([b, c, a]);
  });

  it("moving an item down by one slot actually moves it", async () => {
    // The measurement has to exclude the moved row, or the midpoint it computes
    // is the position it already holds and the drag silently does nothing.
    const { playlistId, ids } = await threeItems();
    const [a, b, c] = ids;

    await moveVideo(db, playlistId, a, b);

    expect((await items(playlistId)).map((i) => i.videoId)).toEqual([b, a, c]);
  });

  it("refuses to move an item after itself", async () => {
    const { playlistId, ids } = await threeItems();
    await expect(moveVideo(db, playlistId, ids[0], ids[0])).rejects.toThrow();
  });

  it("refuses an anchor that is not in the playlist", async () => {
    const { playlistId, ids } = await threeItems();
    await expect(moveVideo(db, playlistId, ids[0], "elsewhere")).rejects.toThrow(
      /not in playlist/,
    );
  });

  /**
   * The boundary the sparse integer exists to defer. Positions 10 and 11 are
   * adjacent — there is no integer between them — so the move cannot be written
   * until the whole list has been re-spaced.
   */
  it("re-spaces when the gap between two neighbours has closed", async () => {
    const { playlistId, ids } = await threeItems();
    const [a, b, c] = ids;

    await raw.execute(
      `update playlist_items set position = case video_id
         when $2 then 10 when $3 then 11 else 12 end
       where playlist_id = $1`,
      [playlistId, a, b],
    );

    const position = await moveVideo(db, playlistId, c, a);

    const after = await items(playlistId);
    expect(after.map((i) => i.videoId)).toEqual([a, c, b]);
    // Every untouched row now sits on a multiple of the step, which is what
    // re-spacing means and what a plain `update` would not have produced.
    expect(after.find((i) => i.videoId === a)?.position).toBe(
      PLAYLIST_POSITION_STEP,
    );
    expect(after.find((i) => i.videoId === b)?.position).toBe(
      2 * PLAYLIST_POSITION_STEP,
    );
    expect(position).toBe(1_536);
  });

  it("does not re-space when a gap is still open", async () => {
    const { playlistId, ids } = await threeItems();
    const [a, b, c] = ids;

    await raw.execute(
      `update playlist_items set position = case video_id
         when $2 then 10 when $3 then 12 else 14 end
       where playlist_id = $1`,
      [playlistId, a, b],
    );

    const position = await moveVideo(db, playlistId, c, a);

    expect(position).toBe(11);
    const after = await items(playlistId);
    expect(after.find((i) => i.videoId === a)?.position).toBe(10);
    expect(after.find((i) => i.videoId === b)?.position).toBe(12);
  });

  it("survives repeated drags into the same gap", async () => {
    const owner = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const playlist = await createPlaylist(db, { ownerId: owner, title: "Queue" });
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const id = await seedVideo(raw, channelId);
      ids.push(id);
      await addVideo(db, playlist.id, id);
    }
    const [first, , third, fourth] = ids as [string, string, string, string];

    // Twenty drags into one gap is twice what 1024 can halve, so the re-space
    // has to fire at least once and the list must still hold its order.
    for (let i = 0; i < 20; i += 1) {
      await moveVideo(db, playlist.id, i % 2 === 0 ? third : fourth, first);
    }

    const positions = (await items(playlist.id)).map((i) => i.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
  });
});
