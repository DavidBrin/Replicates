import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildThreads,
  CommentThreadList,
} from "@/components/issue-detail/comment-thread";
import { groupReactions } from "@/components/issue-detail/reactions";

import { comment, DANA, MIRA, reaction } from "./fixtures";

/**
 * Comments: one level of threading, grouped reactions, and editing your own.
 *
 * The threading tests are the load-bearing ones. Linear's threads are two
 * levels — a root and its replies — and a reply to a reply joins the same
 * thread. The repository flattens that on write; {@link buildThreads} flattens
 * it again on read, and the read-side rule is what keeps a comment visible when
 * the write-side rule was not in force for it (an import, an older row, a
 * client that got it wrong). A dropped comment is the worst failure available
 * here: nobody can tell it is missing.
 */

const handlers = {
  onReply: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToggleReaction: vi.fn(),
};

function renderThreads(comments: Parameters<typeof buildThreads>[0], canComment = true) {
  return render(
    <CommentThreadList
      comments={comments}
      viewer={DANA}
      mentions={{ dana: "Dana Okafor", mira: "Mira Rossi" }}
      canComment={canComment}
      onReply={handlers.onReply}
      onEdit={handlers.onEdit}
      onDelete={handlers.onDelete}
      onToggleReaction={handlers.onToggleReaction}
    />,
  );
}

describe("buildThreads — one level, always", () => {
  it("nests a reply under its root", () => {
    const root = comment({ id: "cmt_root" });
    const reply = comment({ id: "cmt_reply", parentId: "cmt_root", user: MIRA });

    const threads = buildThreads([root, reply]);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.root.id).toBe("cmt_root");
    expect(threads[0]?.replies.map((entry) => entry.id)).toEqual(["cmt_reply"]);
  });

  it("attaches a reply-to-a-reply to the same root rather than nesting deeper", () => {
    const root = comment({ id: "cmt_root" });
    const reply = comment({ id: "cmt_reply", parentId: "cmt_root" });
    const nested = comment({ id: "cmt_nested", parentId: "cmt_reply" });

    const threads = buildThreads([root, reply, nested]);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.replies.map((entry) => entry.id)).toEqual([
      "cmt_reply",
      "cmt_nested",
    ]);
  });

  it("promotes an orphan rather than dropping it", () => {
    const orphan = comment({ id: "cmt_orphan", parentId: "cmt_missing" });
    const threads = buildThreads([orphan]);
    expect(threads.map((thread) => thread.root.id)).toEqual(["cmt_orphan"]);
  });

  it("terminates on a cycle in the data", () => {
    const a = comment({ id: "cmt_a", parentId: "cmt_b" });
    const b = comment({ id: "cmt_b", parentId: "cmt_a" });
    expect(() => buildThreads([a, b])).not.toThrow();
    expect(buildThreads([a, b]).length).toBeGreaterThan(0);
  });

  it("renders replies indented under one thread card", () => {
    renderThreads([
      comment({ id: "cmt_root" }),
      comment({ id: "cmt_reply", parentId: "cmt_root", user: MIRA }),
      comment({ id: "cmt_nested", parentId: "cmt_reply", user: MIRA }),
    ]);

    const thread = screen.getByTestId("comment-thread-cmt_root");
    expect(within(thread).getByTestId("comment-cmt_reply")).toBeInTheDocument();
    expect(within(thread).getByTestId("comment-cmt_nested")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-thread-cmt_reply")).toBeNull();
  });

  it("targets the thread root when replying to a reply", async () => {
    // The client half of the one-level rule: the id sent to the server is
    // already the root's, so the flattening on write has nothing left to do.
    const user = userEvent.setup();
    handlers.onReply.mockClear();
    renderThreads([
      comment({ id: "cmt_root" }),
      comment({ id: "cmt_reply", parentId: "cmt_root", user: MIRA }),
    ]);

    await user.click(screen.getByTestId("comment-reply-cmt_reply"));
    await user.type(
      screen.getByTestId("comment-reply-composer-cmt_root"),
      "on it",
    );
    await user.click(screen.getByTestId("comment-reply-submit-cmt_root"));

    expect(handlers.onReply).toHaveBeenCalledWith("cmt_root", "on it");
  });
});

describe("reactions — grouping and the you-reacted state", () => {
  it("groups by emoji, counts, and marks the viewer's own", () => {
    const groups = groupReactions(
      [
        reaction({ id: "rct_1", emoji: "👍", userId: MIRA.id, userName: MIRA.name }),
        reaction({ id: "rct_2", emoji: "👍", userId: DANA.id, userName: DANA.name }),
        reaction({ id: "rct_3", emoji: "🎉", userId: MIRA.id, userName: MIRA.name }),
      ],
      DANA.id,
    );

    expect(groups).toEqual([
      { emoji: "👍", count: 2, names: ["Mira Rossi", "Dana Okafor"], mine: "rct_2" },
      { emoji: "🎉", count: 1, names: ["Mira Rossi"], mine: null },
    ]);
  });

  it("keeps first-seen order, so a chip does not move when someone reacts", () => {
    const groups = groupReactions(
      [
        reaction({ id: "rct_1", emoji: "🎉" }),
        reaction({ id: "rct_2", emoji: "👍" }),
        reaction({ id: "rct_3", emoji: "👍" }),
      ],
      "usr_nobody",
    );
    expect(groups.map((group) => group.emoji)).toEqual(["🎉", "👍"]);
  });

  it("renders the count and announces the you-reacted state", () => {
    renderThreads([
      comment({
        id: "cmt_root",
        reactions: [
          reaction({ id: "rct_1", emoji: "👍", userId: MIRA.id, userName: MIRA.name }),
          reaction({ id: "rct_2", emoji: "👍", userId: DANA.id, userName: DANA.name }),
        ],
      }),
    ]);

    const chip = screen.getByTestId("reaction-👍");
    expect(chip).toHaveTextContent("2");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveAttribute("data-mine", "true");
    expect(chip).toHaveAttribute("title", "Mira Rossi, Dana Okafor");
  });

  it("passes the viewer's own reaction id when toggling off, and null when toggling on", async () => {
    const user = userEvent.setup();
    handlers.onToggleReaction.mockClear();
    renderThreads([
      comment({
        id: "cmt_root",
        reactions: [
          reaction({ id: "rct_mine", emoji: "👍", userId: DANA.id, userName: DANA.name }),
          reaction({ id: "rct_theirs", emoji: "🎉", userId: MIRA.id, userName: MIRA.name }),
        ],
      }),
    ]);

    await user.click(screen.getByTestId("reaction-👍"));
    expect(handlers.onToggleReaction).toHaveBeenCalledWith("cmt_root", "👍", "rct_mine");

    await user.click(screen.getByTestId("reaction-🎉"));
    expect(handlers.onToggleReaction).toHaveBeenCalledWith("cmt_root", "🎉", null);
  });
});

describe("comments — editing, deleting and mentions", () => {
  it("offers edit and delete on your own comment only", () => {
    renderThreads([
      comment({ id: "cmt_mine", user: DANA }),
      comment({ id: "cmt_theirs", user: MIRA }),
    ]);

    expect(screen.getByTestId("comment-edit-cmt_mine")).toBeInTheDocument();
    expect(screen.getByTestId("comment-delete-cmt_mine")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-edit-cmt_theirs")).toBeNull();
    expect(screen.queryByTestId("comment-delete-cmt_theirs")).toBeNull();
  });

  it("edits through a composer seeded with the current body", async () => {
    const user = userEvent.setup();
    handlers.onEdit.mockClear();
    renderThreads([comment({ id: "cmt_mine", body: "first draft" })]);

    await user.click(screen.getByTestId("comment-edit-cmt_mine"));
    const field = screen.getByTestId("comment-edit-composer-cmt_mine");
    expect(field).toHaveValue("first draft");

    await user.clear(field);
    await user.type(field, "second draft");
    await user.click(screen.getByTestId("comment-edit-submit-cmt_mine"));

    expect(handlers.onEdit).toHaveBeenCalledWith("cmt_mine", "second draft");
  });

  it("marks an edited comment", () => {
    renderThreads([
      comment({ id: "cmt_plain" }),
      comment({ id: "cmt_edited", editedAt: "2026-08-02T09:00:00.000Z" }),
    ]);

    expect(screen.getByTestId("comment-edited-cmt_edited")).toHaveTextContent("(edited)");
    expect(screen.queryByTestId("comment-edited-cmt_plain")).toBeNull();
  });

  it("deletes on click", async () => {
    const user = userEvent.setup();
    handlers.onDelete.mockClear();
    renderThreads([comment({ id: "cmt_mine" })]);

    await user.click(screen.getByTestId("comment-delete-cmt_mine"));
    expect(handlers.onDelete).toHaveBeenCalledWith("cmt_mine");
  });

  it("renders an @mention in a comment as a chip", () => {
    renderThreads([comment({ id: "cmt_root", body: "@mira can you look?" })]);
    expect(screen.getByTestId("mention-mira")).toHaveTextContent("@Mira Rossi");
  });

  it("does not execute markup in a comment body", () => {
    const { container } = renderThreads([
      comment({ id: "cmt_root", body: '<img src=x onerror="alert(1)">' }),
    ]);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByTestId("comment-body-cmt_root").textContent).toContain(
      "<img src=x onerror=",
    );
  });

  it("hides the reply affordance when the viewer may not comment", () => {
    renderThreads([comment({ id: "cmt_root" })], false);
    expect(screen.queryByTestId("comment-reply-cmt_root")).toBeNull();
  });
});
