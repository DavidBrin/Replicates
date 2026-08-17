import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Comment } from "@/domain/types";

import { Comments, sortThreads, type CommentThread } from "../comments";

/**
 * The comment thread.
 *
 * `research/08-youtube-ui-measured.md` §3.5, §8.3 and
 * `research/extracted/watch-layout-1920.json` `commentSamples` are the source
 * for the shape and the copy; the threading model is
 * `src/adapters/repositories/comments.ts`'s, which this UI renders rather than
 * re-decides.
 */

const NOW = new Date("2026-08-16T12:00:00Z");

function comment(overrides: Partial<Comment> & { id: string }): Comment {
  return {
    videoId: "v1",
    parentId: null,
    authorId: `u-${overrides.id}`,
    authorName: "Someone",
    authorAvatarKey: null,
    body: "A comment",
    likeCount: 0,
    replyCount: 0,
    isPinned: false,
    hearted: false,
    viewerReaction: null,
    createdAt: new Date("2026-08-01T12:00:00Z"),
    editedAt: null,
    ...overrides,
  };
}

const PINNED = comment({
  id: "c-pinned",
  authorName: "Captain Discovery",
  body: "Do you often eat instant noodles?",
  likeCount: 47,
  replyCount: 2,
  isPinned: true,
  createdAt: new Date("2025-10-08T12:00:00Z"),
});

const POPULAR = comment({
  id: "c-popular",
  authorName: "Peeziejizzle",
  body: 'I knew I couldn\'t trust this video when he said "just flour and water"',
  likeCount: 107,
  createdAt: new Date("2025-10-09T12:00:00Z"),
});

const RECENT = comment({
  id: "c-recent",
  authorName: "FireSwan16t",
  body: "I have fond memories of going to my friend's house after school",
  likeCount: 2,
  createdAt: new Date("2026-08-15T13:00:00Z"),
});

const THREADS: readonly CommentThread[] = [
  {
    comment: PINNED,
    replies: [
      comment({ id: "r-1", parentId: "c-pinned", authorName: "A", body: "Every week" }),
      comment({ id: "r-2", parentId: "c-pinned", authorName: "B", body: "@A same" }),
    ],
  },
  { comment: POPULAR, replies: [] },
  { comment: RECENT, replies: [] },
];

function renderComments(overrides: Partial<Parameters<typeof Comments>[0]> = {}) {
  const onPost = vi.fn(async (input: { body: string; parentId: string | null }) =>
    comment({
      id: `new-${input.parentId ?? "top"}`,
      parentId: input.parentId,
      body: input.body,
      authorName: "You",
      createdAt: NOW,
    }),
  );
  const onReact = vi.fn(async () => ({ likeCount: 48, viewerReaction: 1 as const }));

  render(
    <Comments
      videoId="v1"
      commentCount={233}
      commentsEnabled
      threads={THREADS}
      viewer={{ id: "u-me", name: "You" }}
      now={NOW}
      onPost={onPost}
      onReact={onReact}
      {...overrides}
    />,
  );
  return { onPost, onReact };
}

describe("sortThreads — the two orders the UI offers", () => {
  it("puts pinned first in both, matching listComments' own SQL", () => {
    // `cm.is_pinned desc, …` in both branches of the repository's `order by`.
    // A pinned comment that sorted to page four would not be pinned to
    // anything.
    for (const sort of ["top", "newest"] as const) {
      expect(sortThreads(THREADS, sort)[0]?.comment.id).toBe("c-pinned");
    }
  });

  it("orders by likes under `top`", () => {
    expect(sortThreads(THREADS, "top").map((t) => t.comment.id)).toEqual([
      "c-pinned",
      "c-popular",
      "c-recent",
    ]);
  });

  it("orders by time under `newest`", () => {
    expect(sortThreads(THREADS, "newest").map((t) => t.comment.id)).toEqual([
      "c-pinned",
      "c-recent",
      "c-popular",
    ]);
  });

  it("does not mutate the input", () => {
    const before = THREADS.map((t) => t.comment.id);
    sortThreads(THREADS, "newest");
    expect(THREADS.map((t) => t.comment.id)).toEqual(before);
  });
});

describe("Comments — the header (§8.1, §8.3)", () => {
  it("writes the count exactly and comma-grouped, with a capital C", () => {
    // §8.1: `233 Comments`. Not abbreviated — the number beside a heading is a
    // count of things you can scroll to.
    renderComments({ commentCount: 1233 });
    expect(screen.getByRole("heading", { name: "1,233 Comments" })).toBeInTheDocument();
  });

  it("labels the sort trigger `Sort by`, not the current order", () => {
    // §8.3, verbatim. The current order is the checked row inside the menu.
    renderComments();
    expect(screen.getByRole("button", { name: /Sort by/ })).toBeInTheDocument();
  });

  it("re-sorts in place when the order changes", async () => {
    const user = userEvent.setup();
    renderComments();

    const order = (): string[] =>
      [...document.querySelectorAll("[data-comment-thread]")].map(
        (node) => node.getAttribute("data-comment-thread") ?? "",
      );
    expect(order()).toEqual(["c-pinned", "c-popular", "c-recent"]);

    await user.click(screen.getByRole("button", { name: /Sort by/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Newest first" }));
    expect(order()).toEqual(["c-pinned", "c-recent", "c-popular"]);
  });
});

describe("Comments — the row (§3.5, commentSamples)", () => {
  it("carries the pinned badge naming the pinner", () => {
    renderComments();
    expect(screen.getByText("Pinned by Captain Discovery")).toBeInTheDocument();
  });

  it("shows the like count only when there is one", () => {
    renderComments();
    const pinned = document.querySelector('[data-comment="c-pinned"]') as HTMLElement;
    expect(within(pinned).getByText("47")).toBeInTheDocument();

    const zero = document.querySelector('[data-comment="c-recent"]') as HTMLElement;
    expect(within(zero).getByText("2")).toBeInTheDocument();
  });

  it("offers Reply on every row", () => {
    renderComments();
    // §8.3: the toolbar's word is `Reply`, singular and capitalised.
    expect(screen.getAllByRole("button", { name: "Reply" }).length).toBe(THREADS.length);
  });

  it("marks a hearted comment", () => {
    render(
      <Comments
        videoId="v1"
        commentCount={1}
        commentsEnabled
        threads={[{ comment: comment({ id: "c-h", hearted: true }), replies: [] }]}
        viewer={null}
        now={NOW}
      />,
    );
    expect(screen.getByRole("img", { name: "Loved by the creator" })).toBeInTheDocument();
  });

  it("writes the age in full words, like the card and unlike the sidebar", () => {
    // §8.2: comments use `N unit ago` in full, not the sidebar's `2y ago`.
    renderComments();
    expect(screen.getByText("23 hours ago")).toBeInTheDocument();
  });
});

describe("Comments — replies are one level deep", () => {
  it("counts replies with the measured singular and plural", () => {
    // §8.3 measures `16 replies`; `commentSamples` also carries `1 reply`.
    render(
      <Comments
        videoId="v1"
        commentCount={2}
        commentsEnabled
        threads={[
          { comment: comment({ id: "a", replyCount: 1 }), replies: [comment({ id: "a1" })] },
          { comment: comment({ id: "b", replyCount: 16 }), replies: [] },
        ]}
        viewer={null}
        now={NOW}
      />,
    );
    expect(screen.getByRole("button", { name: "1 reply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "16 replies" })).toBeInTheDocument();
  });

  it("hides replies until the expander is pressed", async () => {
    const user = userEvent.setup();
    renderComments();
    expect(screen.queryByText("Every week")).toBeNull();

    await user.click(screen.getByRole("button", { name: "2 replies" }));
    expect(screen.getByText("Every week")).toBeInTheDocument();
    expect(screen.getByText("@A same")).toBeInTheDocument();
  });

  it("indents the reply block by the measured 48px", async () => {
    const user = userEvent.setup();
    renderComments();
    const expander = screen.getByRole("button", { name: "2 replies" });
    // §3.5: "**Reply indent** | **48px** (reply block starts at x=64)".
    expect((expander.parentElement as HTMLElement).style.marginLeft).toBe("48px");
    await user.click(expander);
    expect(document.querySelectorAll("[data-comment-reply]")).toHaveLength(2);
  });

  it("files a reply to a reply under the same top-level comment", async () => {
    const user = userEvent.setup();
    const { onPost } = renderComments();
    await user.click(screen.getByRole("button", { name: "2 replies" }));

    const reply = document.querySelector('[data-comment-reply="r-1"]') as HTMLElement;
    await user.click(within(reply).getByRole("button", { name: "Reply" }));
    const composer = screen.getByLabelText("Add a reply...");
    await user.type(composer, "answering the reply");
    // Scoped to the composer's own form: the page now has a `Reply` button on
    // every row *and* one that submits, and they are the same word by design.
    const form = composer.closest("form") as HTMLElement;
    await user.click(within(form).getByRole("button", { name: "Reply" }));

    // `resolveParent`'s rule — `parent.parent_id ?? parent.id` — surfaced in
    // the UI: answering a reply posts against the thread, not against the reply.
    expect(onPost).toHaveBeenCalledWith({
      body: "answering the reply",
      parentId: "c-pinned",
    });
  });
});

describe("Comments — the composer", () => {
  it("uses the measured placeholder", () => {
    // §8.3, verbatim: `Add a comment...` — three periods.
    renderComments();
    expect(screen.getByLabelText("Add a comment...")).toBeInTheDocument();
  });

  it("cannot submit an empty or whitespace-only comment", async () => {
    const user = userEvent.setup();
    const { onPost } = renderComments();
    const submit = screen.getByRole("button", { name: "Comment" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Add a comment..."), "   ");
    expect(submit).toBeDisabled();
    expect(onPost).not.toHaveBeenCalled();
  });

  it("posts, prepends and clears", async () => {
    const user = userEvent.setup();
    const { onPost } = renderComments();
    await user.type(screen.getByLabelText("Add a comment..."), "first!");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    expect(onPost).toHaveBeenCalledWith({ body: "first!", parentId: null });
    expect(screen.getByText("first!")).toBeInTheDocument();
    expect(screen.getByLabelText("Add a comment...")).toHaveValue("");
  });

  it("reveals a freshly posted reply rather than leaving it hidden", async () => {
    const user = userEvent.setup();
    renderComments();
    const thread = document.querySelector('[data-comment="c-popular"]') as HTMLElement;
    await user.click(within(thread).getByRole("button", { name: "Reply" }));
    const composer = screen.getByLabelText("Add a reply...");
    await user.type(composer, "mine too");
    const form = composer.closest("form") as HTMLElement;
    await user.click(within(form).getByRole("button", { name: "Reply" }));

    // A composer that swallows what you just wrote reads as a failure.
    expect(await screen.findByText("mine too")).toBeInTheDocument();
  });

  it("asks a signed-out viewer to sign in instead of showing a dead field", () => {
    renderComments({ viewer: null });
    expect(screen.queryByLabelText("Add a comment...")).toBeNull();
    expect(screen.getByText("Sign in to comment.")).toBeInTheDocument();
  });
});

describe("Comments — reactions", () => {
  type Settled = { likeCount: number; viewerReaction: 1 | -1 | null };

  /** A reaction that has been sent and has not come back yet. */
  function deferred() {
    let settle!: (value: Settled) => void;
    const promise = new Promise<Settled>((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }

  it("lights up before the round trip and then takes the server's count", async () => {
    const user = userEvent.setup();
    const { promise, settle } = deferred();
    const onReact = vi.fn(() => promise);
    renderComments({
      onReact,
      threads: [{ comment: comment({ id: "c-x", likeCount: 47 }), replies: [] }],
    });

    const row = document.querySelector('[data-comment="c-x"]') as HTMLElement;
    const like = within(row).getByRole("button", { name: /^Like this comment/ });

    await user.click(like);
    expect(onReact).toHaveBeenCalledWith("c-x", 1);
    // Optimistic: a like that waits for a round trip before lighting up reads
    // as a dropped click.
    expect(like).toHaveAttribute("aria-pressed", "true");
    expect(within(row).getByText("48")).toBeInTheDocument();

    // The server is the truth — another viewer liked it in the meantime.
    await act(async () => {
      settle({ likeCount: 63, viewerReaction: 1 });
      await promise;
    });
    expect(within(row).getByText("63")).toBeInTheDocument();
  });

  it("takes a like back when it is pressed again", async () => {
    const user = userEvent.setup();
    const { promise, settle } = deferred();
    renderComments({
      onReact: vi.fn(() => promise),
      threads: [
        { comment: comment({ id: "c-x", likeCount: 5, viewerReaction: 1 }), replies: [] },
      ],
    });

    const row = document.querySelector('[data-comment="c-x"]') as HTMLElement;
    const like = within(row).getByRole("button", { name: /^Like this comment/ });

    await user.click(like);
    // `applyTransition`'s rule, mirrored: pressing what you already hold clears
    // it, and the count comes down with it.
    expect(like).toHaveAttribute("aria-pressed", "false");
    expect(within(row).getByText("4")).toBeInTheDocument();

    await act(async () => {
      settle({ likeCount: 4, viewerReaction: null });
      await promise;
    });
    expect(like).toHaveAttribute("aria-pressed", "false");
  });

  it("rolls the optimistic change back when the write fails", async () => {
    const user = userEvent.setup();
    const { promise, settle } = deferred();
    renderComments({
      onReact: vi.fn(async () => {
        await promise;
        throw new Error("offline");
      }),
      threads: [{ comment: comment({ id: "c-x", likeCount: 5 }), replies: [] }],
    });

    const row = document.querySelector('[data-comment="c-x"]') as HTMLElement;
    const like = within(row).getByRole("button", { name: /^Like this comment/ });

    await user.click(like);
    expect(like).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      settle({ likeCount: 0, viewerReaction: null });
      await promise.catch(() => undefined);
    });
    // A like that stays lit after a failed write is a lie the next page load
    // contradicts.
    expect(like).toHaveAttribute("aria-pressed", "false");
    expect(within(row).getByText("5")).toBeInTheDocument();
  });

  it("reacts to a reply as well as to a top-level comment", async () => {
    const user = userEvent.setup();
    const { promise } = deferred();
    const onReact = vi.fn(() => promise);
    renderComments({ onReact });

    await user.click(screen.getByRole("button", { name: "2 replies" }));
    const reply = document.querySelector('[data-comment="r-1"]') as HTMLElement;
    await user.click(within(reply).getByRole("button", { name: /^Like this comment/ }));
    expect(onReact).toHaveBeenCalledWith("r-1", 1);
  });
});

describe("Comments — turned off", () => {
  it("says so and shows no composer", () => {
    renderComments({ commentsEnabled: false });
    expect(screen.getByText("Comments are turned off.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a comment...")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
