// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import {
  addAutomaticCaptionTrack,
  addUploadedCaptionTrack,
  deleteCaptionTrack,
  getCaptionTrack,
  listCaptionTracks,
  setDefaultCaptionTrack,
} from "../captions";
import { VideoNotFoundError } from "../comments";
import { DuplicateError } from "../shared";
import { newVideoId } from "../videos";

import { countingExecutor, createTestChannel, setupTestDatabase } from "./harness";

const t = setupTestDatabase();

/**
 * A minimal video to hang tracks off. The video repository's own suite covers
 * what `createVideo` puts in the row; a caption test that went through it would
 * be asserting that publishing works.
 */
async function seedVideo(db: SqlDatabase): Promise<string> {
  const channel = await createTestChannel(db);
  const id = newVideoId();
  await db.execute(
    `insert into videos (id, channel_id, title) values ($1, $2, 'A video')`,
    [id, channel.id],
  );
  return id;
}

const track = (videoId: string, language: string, label: string) => ({
  videoId,
  language,
  label,
  blobKey: `videos/${videoId}/captions-${language}.vtt`,
});

describe("adding a caption track", () => {
  it("stores what the CC menu renders and what the player fetches", async () => {
    const videoId = await seedVideo(t.db);

    const added = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "en-GB", "English (United Kingdom)"),
    );

    expect(added).toMatchObject({
      videoId,
      language: "en-GB",
      label: "English (United Kingdom)",
      source: "uploaded",
      blobKey: `videos/${videoId}/captions-en-GB.vtt`,
    });
    expect(added.createdAt).toBeInstanceOf(Date);
    expect(await getCaptionTrack(t.db, added.id)).toEqual(added);
  });

  it("makes the first track the default, so the CC button is never inert", async () => {
    const videoId = await seedVideo(t.db);
    const first = await addAutomaticCaptionTrack(
      t.db,
      track(videoId, "en", "English (auto-generated)"),
    );
    expect(first.isDefault).toBe(true);
  });

  it("lets an uploaded track displace an automatic default", async () => {
    const videoId = await seedVideo(t.db);
    const automatic = await addAutomaticCaptionTrack(
      t.db,
      track(videoId, "en", "English (auto-generated)"),
    );
    const uploaded = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "en", "English"),
    );

    expect(uploaded.isDefault).toBe(true);
    expect((await getCaptionTrack(t.db, automatic.id))?.isDefault).toBe(false);
    expect(await defaultCount(videoId)).toBe(1);
  });

  it("does not let a fifth language change what plays by default", async () => {
    const videoId = await seedVideo(t.db);
    const english = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "en", "English"),
    );
    const french = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "fr", "Français"),
    );
    const auto = await addAutomaticCaptionTrack(
      t.db,
      track(videoId, "de", "Deutsch (auto-generated)"),
    );

    expect(english.isDefault).toBe(true);
    expect(french.isDefault).toBe(false);
    expect(auto.isDefault).toBe(false);
    expect(await defaultCount(videoId)).toBe(1);
  });

  it("clears the previous default when the caller forces a new one", async () => {
    const videoId = await seedVideo(t.db);
    const english = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "en", "English"),
    );
    const french = await addUploadedCaptionTrack(t.db, {
      ...track(videoId, "fr", "Français"),
      isDefault: true,
    });

    expect(french.isDefault).toBe(true);
    expect((await getCaptionTrack(t.db, english.id))?.isDefault).toBe(false);
    expect(await defaultCount(videoId)).toBe(1);
  });

  it("refuses a second track in the same language from the same source", async () => {
    const videoId = await seedVideo(t.db);
    await addUploadedCaptionTrack(t.db, track(videoId, "en", "English"));

    await expect(
      addUploadedCaptionTrack(t.db, track(videoId, "en", "English (again)")),
    ).rejects.toBeInstanceOf(DuplicateError);

    // …but an automatic English track beside an uploaded one is exactly what
    // the unique index's third column exists to permit.
    const auto = await addAutomaticCaptionTrack(
      t.db,
      track(videoId, "en", "English (auto-generated)"),
    );
    expect(auto.source).toBe("automatic");
  });

  it("names the missing video rather than the foreign key", async () => {
    await expect(
      addUploadedCaptionTrack(t.db, track("nosuchvideo", "en", "English")),
    ).rejects.toBeInstanceOf(VideoNotFoundError);
  });
});

describe("listing a video's tracks", () => {
  it("puts the default first, then uploaded before automatic", async () => {
    const videoId = await seedVideo(t.db);
    await addAutomaticCaptionTrack(
      t.db,
      track(videoId, "en", "English (auto-generated)"),
    );
    await addUploadedCaptionTrack(t.db, track(videoId, "fr", "Français"));
    const english = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "en", "English"),
    );
    await setDefaultCaptionTrack(t.db, english.id);

    const tracks = await listCaptionTracks(t.db, videoId);
    expect(tracks.map((row) => row.label)).toEqual([
      "English",
      "Français",
      "English (auto-generated)",
    ]);
    // The first row is the track to start with, which is why nothing here needs
    // a second query for the default.
    expect(tracks[0]?.isDefault).toBe(true);
  });

  it("reads a whole menu in one statement", async () => {
    const videoId = await seedVideo(t.db);
    for (const language of ["en", "fr", "de", "es"]) {
      await addUploadedCaptionTrack(t.db, track(videoId, language, language));
    }

    const counting = countingExecutor(t.db);
    expect(await listCaptionTracks(counting, videoId)).toHaveLength(4);
    expect(counting.statements).toHaveLength(1);
  });

  it("has nothing to say about a video with no captions", async () => {
    const videoId = await seedVideo(t.db);
    expect(await listCaptionTracks(t.db, videoId)).toEqual([]);
    expect(await getCaptionTrack(t.db, "cap_nope")).toBeNull();
  });
});

describe("choosing the default", () => {
  it("moves it, leaving exactly one", async () => {
    const videoId = await seedVideo(t.db);
    const english = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "en", "English"),
    );
    const french = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "fr", "Français"),
    );

    expect(await setDefaultCaptionTrack(t.db, french.id)).toBe(true);
    expect((await getCaptionTrack(t.db, french.id))?.isDefault).toBe(true);
    expect((await getCaptionTrack(t.db, english.id))?.isDefault).toBe(false);
    expect(await defaultCount(videoId)).toBe(1);
  });

  it("leaves the video's default alone when the id is not a track", async () => {
    const videoId = await seedVideo(t.db);
    const english = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "en", "English"),
    );

    expect(await setDefaultCaptionTrack(t.db, "cap_nope")).toBe(false);
    // The failure mode this guards: a `where video_id = $2` form would match the
    // current default and set it to false, leaving tracks and no default.
    expect((await getCaptionTrack(t.db, english.id))?.isDefault).toBe(true);
  });

  it("does not reach across videos", async () => {
    const first = await seedVideo(t.db);
    const second = await seedVideo(t.db);
    const mine = await addUploadedCaptionTrack(t.db, track(first, "en", "English"));
    const theirs = await addUploadedCaptionTrack(
      t.db,
      track(second, "en", "English"),
    );

    await setDefaultCaptionTrack(t.db, theirs.id);
    expect((await getCaptionTrack(t.db, mine.id))?.isDefault).toBe(true);
  });
});

describe("deleting a track", () => {
  it("hands the default on rather than leaving the video without one", async () => {
    const videoId = await seedVideo(t.db);
    const english = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "en", "English"),
    );
    await addAutomaticCaptionTrack(
      t.db,
      track(videoId, "de", "Deutsch (auto-generated)"),
    );
    const french = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "fr", "Français"),
    );

    expect(await deleteCaptionTrack(t.db, english.id)).toBe(true);

    const remaining = await listCaptionTracks(t.db, videoId);
    expect(remaining).toHaveLength(2);
    // Promoted by the same preference the menu is ordered by: uploaded first.
    expect(remaining[0]?.id).toBe(french.id);
    expect(remaining[0]?.isDefault).toBe(true);
    expect(await defaultCount(videoId)).toBe(1);
  });

  it("does not disturb the default when the deleted track was not it", async () => {
    const videoId = await seedVideo(t.db);
    const english = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "en", "English"),
    );
    const french = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "fr", "Français"),
    );

    await deleteCaptionTrack(t.db, french.id);
    expect((await getCaptionTrack(t.db, english.id))?.isDefault).toBe(true);
    expect(await defaultCount(videoId)).toBe(1);
  });

  it("leaves nothing behind when the last track goes", async () => {
    const videoId = await seedVideo(t.db);
    const only = await addUploadedCaptionTrack(
      t.db,
      track(videoId, "en", "English"),
    );

    expect(await deleteCaptionTrack(t.db, only.id)).toBe(true);
    expect(await listCaptionTracks(t.db, videoId)).toEqual([]);
    expect(await deleteCaptionTrack(t.db, only.id)).toBe(false);
  });
});

/** How many of a video's tracks claim to be the default. Should never exceed 1. */
async function defaultCount(videoId: string): Promise<number> {
  const rows = await t.db.query<{ n: number | string }>(
    `select count(*) as n from captions where video_id = $1 and is_default`,
    [videoId],
  );
  return Number(rows[0]?.n ?? 0);
}
