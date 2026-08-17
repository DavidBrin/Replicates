// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import {
  CommentNotFoundError,
  CommentsDisabledError,
  VideoNotFoundError,
  addComment,
  countComments,
  deleteComment,
  editComment,
  getComment,
  listComments,
  listReplies,
  pinComment,
  setHearted,
  stampCommentFixtureFacts,
  unpinComment,
} from "../comments";
import { reactToComment } from "../reactions";
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
  await raw.execute("delete from reactions");
  await raw.execute("delete from comments");
  await raw.execute("delete from videos");
  await raw.execute("delete from channels");
  await raw.execute("delete from users");
  db.reset();
});

async function aVideo(): Promise<{ videoId: string; channelId: string }> {
  const { channelId } = await seedCreator(raw);
  return { videoId: await seedVideo(raw, channelId), channelId };
}

async function videoCommentCount(videoId: string): Promise<number> {
  const rows = await raw.query(
    `select comment_count from videos where id = $1`,
    [videoId],
  );
  return Number(rows[0]?.comment_count);
}

describe("posting", () => {
  it("stores the comment with its author's channel identity", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw, { displayName: "Ada Lovelace" });
    await seedChannel(raw, author, {
      handle: "ada",
      name: "Ada's Analytical Engine",
      avatarKey: "ada/avatar.jpg",
    });

    const comment = await addComment(db, {
      videoId,
      authorId: author,
      body: "First",
    });

    // A comment on YouTube is written by a channel, not by an account.
    expect(comment.authorName).toBe("Ada's Analytical Engine");
    expect(comment.authorAvatarKey).toBe("ada/avatar.jpg");
    expect(comment.parentId).toBeNull();
    expect(comment.replyCount).toBe(0);
    expect(comment.viewerReaction).toBeNull();
  });

  it("falls back to the account's name for an author with no channel", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw, { displayName: "Anonymous Viewer" });

    const comment = await addComment(db, { videoId, authorId: author, body: "Hi" });

    expect(comment.authorName).toBe("Anonymous Viewer");
    expect(comment.authorAvatarKey).toBeNull();
  });

  it("refuses a video that does not exist or has comments turned off", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);

    await expect(
      addComment(db, { videoId: "missing", authorId: author, body: "x" }),
    ).rejects.toBeInstanceOf(VideoNotFoundError);

    await raw.execute(
      `update videos set comments_enabled = false where id = $1`,
      [videoId],
    );
    await expect(
      addComment(db, { videoId, authorId: author, body: "x" }),
    ).rejects.toBeInstanceOf(CommentsDisabledError);
    expect(await countComments(db, videoId)).toBe(0);
  });

  it("edits in place and records that it was edited", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const comment = await addComment(db, { videoId, authorId: author, body: "Frist" });

    const edited = await editComment(db, comment.id, "First", author);

    expect(edited?.body).toBe("First");
    expect(edited?.editedAt).toBeInstanceOf(Date);
    expect(await editComment(db, "missing", "x")).toBeNull();
  });
});

describe("the thread is one level deep", () => {
  async function thread(): Promise<{
    videoId: string;
    top: string;
    reply: string;
    replier: string;
  }> {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const replier = await seedUser(raw, { displayName: "Grace" });
    await seedChannel(raw, replier, { handle: "grace", name: "Grace" });

    const top = await addComment(db, { videoId, authorId: author, body: "Top" });
    const reply = await addComment(db, {
      videoId,
      authorId: replier,
      body: "A reply",
      parentId: top.id,
    });

    return { videoId, top: top.id, reply: reply.id, replier };
  }

  it("files a reply under the comment it answers", async () => {
    const { top, reply } = await thread();
    expect((await getComment(db, reply))?.parentId).toBe(top);
  });

  it("files a reply to a reply under the grandparent", async () => {
    const { videoId, top, reply } = await thread();
    const third = await seedUser(raw);

    const grandchild = await addComment(db, {
      videoId,
      authorId: third,
      body: "Agreed",
      parentId: reply,
    });

    // Not `reply` — the second level does not exist.
    expect(grandchild.parentId).toBe(top);
    expect(await listReplies(db, reply)).toEqual([]);
    expect((await listReplies(db, top)).map((c) => c.id)).toEqual([
      reply,
      grandchild.id,
    ]);
  });

  it("mentions the person being answered when it re-parents", async () => {
    const { videoId, reply } = await thread();
    const third = await seedUser(raw);

    const grandchild = await addComment(db, {
      videoId,
      authorId: third,
      body: "Agreed",
      parentId: reply,
    });

    expect(grandchild.body).toBe("@grace Agreed");
  });

  it("does not mention twice when the author already wrote the handle", async () => {
    const { videoId, reply } = await thread();
    const third = await seedUser(raw);

    const grandchild = await addComment(db, {
      videoId,
      authorId: third,
      body: "@grace agreed",
      parentId: reply,
    });

    expect(grandchild.body).toBe("@grace agreed");
  });

  it("does not mention anyone on a reply to a top-level comment", async () => {
    const { videoId, top } = await thread();
    const third = await seedUser(raw);

    const direct = await addComment(db, {
      videoId,
      authorId: third,
      body: "Plain reply",
      parentId: top,
    });

    expect(direct.body).toBe("Plain reply");
  });

  it("refuses a parent from a different video", async () => {
    const { top } = await thread();
    const other = await aVideo();
    const author = await seedUser(raw);

    await expect(
      addComment(db, {
        videoId: other.videoId,
        authorId: author,
        body: "x",
        parentId: top,
      }),
    ).rejects.toBeInstanceOf(CommentNotFoundError);
  });
});

describe("the counts stay true", () => {
  it("counts threads on the video and replies on the parent", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);

    const top = await addComment(db, { videoId, authorId: author, body: "Top" });
    await addComment(db, { videoId, authorId: author, body: "Second" });
    await addComment(db, {
      videoId,
      authorId: author,
      body: "Reply",
      parentId: top.id,
    });

    // Two threads, not three comments: the header counts what the list shows.
    expect(await videoCommentCount(videoId)).toBe(2);
    expect((await getComment(db, top.id))?.replyCount).toBe(1);
  });

  it("agrees with a fresh count of the rows", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const top = await addComment(db, { videoId, authorId: author, body: "Top" });
    await addComment(db, { videoId, authorId: author, body: "Two" });
    await addComment(db, {
      videoId,
      authorId: author,
      body: "Reply",
      parentId: top.id,
    });

    expect(await videoCommentCount(videoId)).toBe(
      await countComments(db, videoId),
    );
  });

  it("moves the right counter back on delete", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const top = await addComment(db, { videoId, authorId: author, body: "Top" });
    const reply = await addComment(db, {
      videoId,
      authorId: author,
      body: "Reply",
      parentId: top.id,
    });

    expect(await deleteComment(db, reply.id)).toBe(true);
    expect((await getComment(db, top.id))?.replyCount).toBe(0);
    expect(await videoCommentCount(videoId)).toBe(1);

    expect(await deleteComment(db, top.id)).toBe(true);
    expect(await videoCommentCount(videoId)).toBe(0);
  });

  it("takes a thread's replies with it and still moves the count by one", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const top = await addComment(db, { videoId, authorId: author, body: "Top" });
    for (let i = 0; i < 3; i += 1) {
      await addComment(db, {
        videoId,
        authorId: author,
        body: `Reply ${i}`,
        parentId: top.id,
      });
    }

    await deleteComment(db, top.id);

    expect(await videoCommentCount(videoId)).toBe(0);
    expect(await listReplies(db, top.id)).toEqual([]);
  });

  it("reports nothing to delete rather than throwing", async () => {
    expect(await deleteComment(db, "missing")).toBe(false);
  });

  it("rolls the counter back when the comment fails to post", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    await addComment(db, { videoId, authorId: author, body: "Top" });

    await expect(
      addComment(db, {
        videoId,
        authorId: author,
        body: "x",
        parentId: "not-a-comment",
      }),
    ).rejects.toBeInstanceOf(CommentNotFoundError);

    expect(await videoCommentCount(videoId)).toBe(1);
  });
});

describe("ordering", () => {
  async function threadWithLikes(): Promise<{
    videoId: string;
    oldPopular: string;
    newQuiet: string;
    pinned: string;
  }> {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);

    const oldPopular = await addComment(db, {
      videoId,
      authorId: author,
      body: "Old and popular",
    });
    const newQuiet = await addComment(db, {
      videoId,
      authorId: author,
      body: "New and quiet",
    });
    const pinned = await addComment(db, {
      videoId,
      authorId: author,
      body: "Pinned",
    });

    await raw.execute(
      `update comments set like_count = 500, created_at = now() - interval '10 days'
        where id = $1`,
      [oldPopular.id],
    );
    await raw.execute(
      `update comments set created_at = now() where id = $1`,
      [newQuiet.id],
    );
    await raw.execute(
      `update comments set created_at = now() - interval '20 days' where id = $1`,
      [pinned.id],
    );

    return {
      videoId,
      oldPopular: oldPopular.id,
      newQuiet: newQuiet.id,
      pinned: pinned.id,
    };
  }

  it("sorts by likes for `top`", async () => {
    const { videoId, oldPopular, newQuiet, pinned } = await threadWithLikes();
    expect(
      (await listComments(db, videoId, { sort: "top" })).map((c) => c.id),
    ).toEqual([oldPopular, newQuiet, pinned]);
  });

  it("sorts by time for `newest`", async () => {
    const { videoId, oldPopular, newQuiet, pinned } = await threadWithLikes();
    expect(
      (await listComments(db, videoId, { sort: "newest" })).map((c) => c.id),
    ).toEqual([newQuiet, oldPopular, pinned]);
  });

  it("puts the pinned comment first in both orders", async () => {
    const { videoId, pinned } = await threadWithLikes();
    await pinComment(db, pinned);

    for (const sort of ["top", "newest"] as const) {
      const listed = await listComments(db, videoId, { sort });
      expect(listed[0]?.id).toBe(pinned);
      expect(listed[0]?.isPinned).toBe(true);
    }
  });

  it("pins at most one comment per video", async () => {
    const { videoId, pinned, newQuiet } = await threadWithLikes();

    await pinComment(db, pinned);
    await pinComment(db, newQuiet);

    const listed = await listComments(db, videoId);
    expect(listed.filter((c) => c.isPinned).map((c) => c.id)).toEqual([newQuiet]);
  });

  it("unpins", async () => {
    const { videoId, pinned } = await threadWithLikes();
    await pinComment(db, pinned);

    expect(await unpinComment(db, pinned)).toBe(true);
    expect(await unpinComment(db, pinned)).toBe(false);
    expect((await listComments(db, videoId)).every((c) => !c.isPinned)).toBe(true);
  });

  it("shows replies oldest first, because a conversation runs forwards", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const top = await addComment(db, { videoId, authorId: author, body: "Top" });

    const first = await addComment(db, {
      videoId,
      authorId: author,
      body: "One",
      parentId: top.id,
    });
    const second = await addComment(db, {
      videoId,
      authorId: author,
      body: "Two",
      parentId: top.id,
    });
    await raw.execute(
      `update comments set created_at = now() - interval '1 hour' where id = $1`,
      [first.id],
    );

    expect((await listReplies(db, top.id)).map((c) => c.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("hearts a comment", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const comment = await addComment(db, { videoId, authorId: author, body: "x" });

    expect(await setHearted(db, comment.id, true)).toBe(true);
    expect((await getComment(db, comment.id))?.hearted).toBe(true);
  });
});

describe("the comment panel is not an N+1", () => {
  it("fetches twenty comments, their authors and the viewer's reactions in one statement", async () => {
    const { videoId } = await aVideo();
    const viewer = await seedUser(raw);

    for (let i = 0; i < 20; i += 1) {
      const author = await seedUser(raw);
      await seedChannel(raw, author, { name: `Channel ${i}` });
      const comment = await addComment(db, {
        videoId,
        authorId: author,
        body: `Comment ${i}`,
      });
      await reactToComment(db, viewer, comment.id, 1);
    }

    db.reset();
    const listed = await listComments(db, videoId, { viewerId: viewer, limit: 20 });

    expect(db.count).toBe(1);
    expect(listed).toHaveLength(20);
    expect(listed.every((c) => c.authorName.startsWith("Channel"))).toBe(true);
    expect(listed.every((c) => c.viewerReaction === 1)).toBe(true);
  });

  it("costs the same one statement for a signed-out viewer", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    await addComment(db, { videoId, authorId: author, body: "x" });

    db.reset();
    const listed = await listComments(db, videoId);

    expect(db.count).toBe(1);
    expect(listed[0]?.viewerReaction).toBeNull();
  });

  it("pages without repeating or skipping a row", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const comment = await addComment(db, {
        videoId,
        authorId: author,
        body: `c${i}`,
      });
      ids.push(comment.id);
      // Distinct times, because PGlite's `now()` stops at the millisecond and
      // five comments posted in a loop would otherwise share one.
      await raw.execute(
        `update comments set created_at = $2 where id = $1`,
        [comment.id, new Date(Date.UTC(2026, 0, i + 1)).toISOString()],
      );
    }
    const newestFirst = [...ids].reverse();

    expect(
      (await listComments(db, videoId, { sort: "newest", limit: 2 })).map(
        (c) => c.id,
      ),
    ).toEqual(newestFirst.slice(0, 2));
    expect(
      (
        await listComments(db, videoId, {
          sort: "newest",
          limit: 2,
          offset: 2,
        })
      ).map((c) => c.id),
    ).toEqual(newestFirst.slice(2, 4));
  });
});

describe("the fixture setter", () => {
  it("writes the two facts it names, and only those", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const comment = await addComment(db, {
      videoId,
      authorId: author,
      body: "Posted last spring",
    });

    const createdAt = new Date(Date.UTC(2026, 3, 2, 14, 5));
    expect(
      await stampCommentFixtureFacts(db, comment.id, {
        createdAt,
        likeCount: 4_812,
      }),
    ).toBe(true);

    const after = await getComment(db, comment.id);
    expect(after?.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(after?.likeCount).toBe(4_812);
    // Untouched. `body` belongs to `editComment`, which also stamps
    // `edited_at`; `reply_count` is maintained beside the rows it counts.
    expect(after?.body).toBe("Posted last spring");
    expect(after?.editedAt).toBeNull();
    expect(after?.replyCount).toBe(0);
  });

  it("gives a seeded thread a conversation's shape instead of one millisecond", async () => {
    // `addComment` stamps `now()`, so a thread written in a loop shares one
    // timestamp — and PGlite's `now()` stops at the millisecond, so the
    // `newest` sort then falls through to the id tiebreak and orders a
    // conversation at random.
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const ids: string[] = [];
    for (let day = 1; day <= 3; day += 1) {
      const comment = await addComment(db, {
        videoId,
        authorId: author,
        body: `Day ${day}`,
      });
      await stampCommentFixtureFacts(db, comment.id, {
        createdAt: new Date(Date.UTC(2026, 5, day)),
      });
      ids.push(comment.id);
    }

    expect(
      (await listComments(db, videoId, { sort: "newest" })).map((c) => c.id),
    ).toEqual([...ids].reverse());
  });

  it("reports an empty patch and an unknown comment as having written nothing", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const comment = await addComment(db, { videoId, authorId: author, body: "x" });

    expect(await stampCommentFixtureFacts(db, comment.id, {})).toBe(false);
    expect(await stampCommentFixtureFacts(db, "cm_nope", { likeCount: 1 })).toBe(
      false,
    );
  });

  it("refuses a like count that is not a count", async () => {
    const { videoId } = await aVideo();
    const author = await seedUser(raw);
    const comment = await addComment(db, { videoId, authorId: author, body: "x" });

    await expect(
      stampCommentFixtureFacts(db, comment.id, { likeCount: 2.5 }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
