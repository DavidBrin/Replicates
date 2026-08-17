// @vitest-environment node
import { describe, expect, it } from "vitest";

import { setupTestDatabase } from "@/adapters/repositories/__tests__/harness";
import { homeFeed, watchNextSidebar } from "@/adapters/repositories/recommendations";
import { listComments } from "@/adapters/repositories/comments";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import { createSearchIndex } from "@/adapters/search";
import { verifyPassword } from "@/lib/auth/password";

import { E2E_PASSWORD, seedDemoData } from "../seed-e2e";

/**
 * The e2e fixture, tested.
 *
 * A fixture nobody runs is worse than no fixture: the specs written against it
 * fail with "expected 1 element, found 0" and send whoever reads that into the
 * query layer. This file is what makes the corpus a thing that is known to
 * apply rather than a thing that looks like it should.
 *
 * The assertions are deliberately about the *shapes the suite depends on*, not
 * about the literal contents. A spec needs the home feed to be non-empty, the
 * watch page to have a related video that is a recommendation rather than a
 * popularity backfill, a comment thread with a reply in it, and a channel page
 * whose video count matches its grid. Those are the four things that would
 * each waste an afternoon if they were quietly absent.
 */

const t = setupTestDatabase();

describe("the e2e demo corpus", () => {
  it("applies, and is idempotent", async () => {
    await seedDemoData(t.db);
    const first = await t.db.query<{ n: number }>(
      "select count(*)::int as n from videos",
    );

    // The guard exists because `DB_DATA_DIR` can be a real directory, where
    // `next start` runs this on every boot.
    await seedDemoData(t.db);
    const second = await t.db.query<{ n: number }>(
      "select count(*)::int as n from videos",
    );

    expect(first[0]?.n).toBeGreaterThan(0);
    expect(second[0]?.n).toBe(first[0]?.n);
  });

  it("gives the home feed something to show", async () => {
    await seedDemoData(t.db);
    const feed = await homeFeed(
      { userId: null, sessionKey: "spec-session" },
      t.db,
    );
    expect(feed.length).toBeGreaterThan(0);
  });

  /**
   * The one that is easy to get wrong, and the reason the fixture writes three
   * sessions rather than one.
   *
   * `MIN_COVISIT_WEIGHT` is 3, so a pair seen twice has a row in
   * `covisitation` and nothing in `related_videos`. A fixture one session short
   * produces a sidebar that is entirely popularity backfill — which looks
   * populated, so a recommender spec written against it would pass while
   * testing nothing about the recommender.
   */
  it("produces a real co-visitation neighbour, not just backfill", async () => {
    await seedDemoData(t.db);
    const related = await t.db.query<{ seed_id: string; candidate_id: string }>(
      "select seed_id, candidate_id from related_videos order by seed_id, candidate_id",
    );
    expect(related.length).toBeGreaterThan(0);

    const sidebar = await watchNextSidebar(
      "vid_e2e_0001",
      { userId: null, sessionKey: "spec-session" },
      t.db,
    );
    expect(sidebar.map((card) => card.id)).toContain("vid_e2e_0002");
  });

  it("has a comment thread with a reply under it", async () => {
    await seedDemoData(t.db);
    const threads = await listComments(t.db, "vid_e2e_0001", { limit: 20 });
    expect(threads.length).toBeGreaterThan(0);
    expect(threads[0]?.replyCount).toBe(1);
  });

  /**
   * The channel page shows a count above a grid, and the two have to agree —
   * the failure this guards is the one `channels.ts` describes: a visitor
   * reading "3 videos" above a grid of 2 concludes the grid is broken.
   */
  it("counts a channel's videos the way the grid lists them", async () => {
    await seedDemoData(t.db);
    const channels = createChannelsRepository(t.db);
    const channel = await channels.findByHandle("fieldnotes");
    expect(channel).not.toBeNull();

    const listed = await t.db.query<{ n: number }>(
      `select count(*)::int as n from videos
        where channel_id = $1
          and visibility = 'public'
          and upload_status = 'ready'
          and published_at is not null`,
      [channel!.id],
    );
    expect(channel!.videoCount).toBe(listed[0]?.n);
  });

  /**
   * The omission the e2e suite found on its first real run.
   *
   * The fixture wrote videos and no search documents, so `/results` returned
   * nothing and the failure presented as a broken query rather than as a
   * missing row. Asserted here as well as in the browser, because this is
   * where it is cheap to notice.
   */
  it("indexes its videos for search", async () => {
    await seedDemoData(t.db);
    const index = createSearchIndex(t.db);
    const results = await index.query({ text: "river", limit: 10, offset: 0 });
    expect(results.hits.map((hit) => hit.id)).toContain("vid_e2e_0001");
  });

  /**
   * The stored hash has to be a real one.
   *
   * This file first carried an invented string shaped like a scrypt encoding.
   * It would have made every sign-in fail with "wrong password" against a
   * fixture whose comment claimed the opposite — so a spec exercising a
   * signed-in flow would have failed in the login form, several layers away
   * from the cause. Verified through the same function the application uses.
   */
  it("stores a password its own verifier accepts", async () => {
    await seedDemoData(t.db);
    const rows = await t.db.query<{ password_hash: string }>(
      "select password_hash from users where id = 'usr_e2e_ada'",
    );
    const stored = rows[0]?.password_hash ?? "";

    await expect(verifyPassword(E2E_PASSWORD, stored)).resolves.toBe(true);
    await expect(verifyPassword("not-the-password", stored)).resolves.toBe(false);
  });

  it("gives every video a rendition ladder to play from", async () => {
    await seedDemoData(t.db);
    const orphans = await t.db.query<{ id: string }>(
      `select v.id from videos v
        where not exists (
          select 1 from video_renditions r where r.video_id = v.id
        )`,
    );
    expect(orphans).toEqual([]);
  });
});
