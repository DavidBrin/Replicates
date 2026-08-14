// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import {
  createFixture,
  createTestDatabase,
  createUser,
  type Fixture,
} from "@/adapters/repositories/__tests__/harness";

/**
 * The route handlers' authorization, against a real database.
 *
 * ## Why this suite lives in `components/issue-detail/__tests__`
 *
 * Because that is the slice that owns these four handlers, and a permission
 * check is not a component detail that happens to be tested elsewhere — it is
 * the load-bearing half of the feature. Every mutation the pane offers is
 * re-checked here at the point it actually lands, so a client that renders a
 * button it should not have still gets a refusal.
 *
 * ## What is real and what is stubbed
 *
 * The **database is real** (PGlite, `schema.sql` applied), so the policy runs
 * against genuine membership rows rather than against a mock's idea of them.
 * Only the session lookup is stubbed: resolving a cookie is the auth slice's
 * concern and is tested there, and stubbing it is what lets one test say
 * "as the guest" in a line.
 *
 * The two cases named in the brief are asserted directly:
 *
 * - **editing a comment you did not write** — a team member, who may edit the
 *   issue itself, may not edit someone else's comment on it (matrix row 45,
 *   footnote 15: `team:member` is `isAuthor`, not `ALLOW`);
 * - **an issue in a team you are not in** — a workspace member is refused on a
 *   *private* team's issue, and refused as a 404 rather than a 403, because a
 *   403 would confirm the issue exists.
 */

let db: SqlDatabase;
let fixture: Fixture;
let outsiderId: string;
let privateIssueId: string;
let publicIssueId: string;
let ownerCommentId: string;

/** Who the next request is from. Swapped per test. */
let currentUserId: string | null = null;

vi.mock("@/adapters/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/adapters/db")>();
  return { ...actual, getDb: () => db };
});

vi.mock("@/lib/auth/current-user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/current-user")>();
  return {
    ...actual,
    // The real `actorFor` is kept: it is the function that turns membership
    // rows into an `Actor`, and stubbing it would test nothing.
    userFromRequest: async () =>
      currentUserId === null
        ? null
        : {
            user: {
              id: currentUserId,
              email: "x@test.local",
              name: "X",
              displayName: "x",
              avatarUrl: null,
              avatarColor: "#5e6ad2",
            },
          },
  };
});

const { POST: postComment } = await import("@/app/api/comments/route");
const { PATCH: patchComment, DELETE: deleteComment } = await import(
  "@/app/api/comments/[id]/route"
);
const { POST: postReaction } = await import("@/app/api/reactions/route");
const { POST: postRelation } = await import(
  "@/app/api/issues/[id]/relations/route"
);

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  db = await createTestDatabase();
  fixture = await createFixture(db);

  // A workspace member who is in no team at all, to separate "workspace
  // membership" from "team membership" in the assertions below.
  outsiderId = await createUser(db, "outsider@test.local", "Outsider");
  await fixture.repos.workspaces.addMember(fixture.workspaceId, outsiderId, "member");

  const privateTeam = await fixture.repos.teams.create(
    { workspaceId: fixture.workspaceId, name: "Secrets", key: "SEC", private: true },
    fixture.ownerId,
  );

  const publicIssue = await fixture.repos.issues.create(
    { teamId: fixture.teamId, title: "Public work", creatorId: fixture.ownerId },
    fixture.ownerId,
  );
  publicIssueId = publicIssue.id;

  const privateIssue = await fixture.repos.issues.create(
    { teamId: privateTeam.id, title: "Private work", creatorId: fixture.ownerId },
    fixture.ownerId,
  );
  privateIssueId = privateIssue.id;

  const comment = await fixture.repos.comments.create({
    issueId: publicIssueId,
    userId: fixture.ownerId,
    body: "The owner's comment",
  });
  ownerCommentId = comment.id;
});

afterAll(async () => {
  await db.close?.();
});

describe("POST /api/comments", () => {
  it("refuses an anonymous request", async () => {
    currentUserId = null;
    const response = await postComment(
      post("http://x/api/comments", { issueId: publicIssueId, body: "hi" }),
    );
    expect(response.status).toBe(401);
  });

  it("lets a team member comment on their team's issue", async () => {
    currentUserId = fixture.memberId;
    const response = await postComment(
      post("http://x/api/comments", { issueId: publicIssueId, body: "on it" }),
    );
    expect(response.status).toBe(201);
  });

  it("refuses a guest, who sees only what they were added to", async () => {
    currentUserId = fixture.guestId;
    const response = await postComment(
      post("http://x/api/comments", { issueId: publicIssueId, body: "hello?" }),
    );
    // 404 rather than 403: a guest must not be able to discover the issue.
    expect(response.status).toBe(404);
  });

  it("refuses a workspace member on an issue in a team they are not in", async () => {
    currentUserId = outsiderId;
    const response = await postComment(
      post("http://x/api/comments", { issueId: privateIssueId, body: "hello?" }),
    );
    expect(response.status).toBe(404);
  });

  it("notifies and subscribes an @mentioned member", async () => {
    currentUserId = fixture.ownerId;
    const response = await postComment(
      post("http://x/api/comments", {
        issueId: publicIssueId,
        body: "@member please look",
      }),
    );
    expect(response.status).toBe(201);

    const notifications = await fixture.repos.notifications.listForUser(
      fixture.memberId,
    );
    expect(
      notifications.some((entry) => entry.type === "comment_mentioned"),
    ).toBe(true);

    const subscribers = await fixture.repos.issues.listSubscribers(publicIssueId);
    expect(subscribers.map((user) => user.id)).toContain(fixture.memberId);
  });

  it("does not notify for a handle inside a code span", async () => {
    // The mention set comes from the parsed markdown, so a code sample does not
    // page anybody. Asserted by counting: a second notification would mean the
    // handle was matched by a regex over the raw body.
    const before = (await fixture.repos.notifications.listForUser(fixture.guestId))
      .length;
    currentUserId = fixture.ownerId;
    await postComment(
      post("http://x/api/comments", {
        issueId: publicIssueId,
        body: "the format is `@guest`",
      }),
    );
    const after = (await fixture.repos.notifications.listForUser(fixture.guestId))
      .length;
    expect(after).toBe(before);
  });
});

describe("PATCH/DELETE /api/comments/[id]", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("refuses to edit a comment written by someone else", async () => {
    // The member may edit the *issue* — they are in its team — and still may
    // not edit this comment. Row 45's `team:member` cell is `isAuthor`, and the
    // author it means is the comment's, not the issue's.
    currentUserId = fixture.memberId;
    const response = await patchComment(
      new Request(`http://x/api/comments/${ownerCommentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "rewritten" }),
      }),
      params(ownerCommentId),
    );
    expect(response.status).toBe(403);

    const unchanged = await fixture.repos.comments.byId(ownerCommentId);
    expect(unchanged?.body).toBe("The owner's comment");
  });

  it("refuses to delete a comment written by someone else", async () => {
    currentUserId = fixture.memberId;
    const response = await deleteComment(
      new Request(`http://x/api/comments/${ownerCommentId}`, { method: "DELETE" }),
      params(ownerCommentId),
    );
    expect(response.status).toBe(403);
    expect(await fixture.repos.comments.byId(ownerCommentId)).not.toBeNull();
  });

  it("lets the author edit their own, and stamps it edited", async () => {
    currentUserId = fixture.ownerId;
    const response = await patchComment(
      new Request(`http://x/api/comments/${ownerCommentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "The owner's revised comment" }),
      }),
      params(ownerCommentId),
    );
    expect(response.status).toBe(200);

    const updated = await fixture.repos.comments.byId(ownerCommentId);
    expect(updated?.body).toBe("The owner's revised comment");
    expect(updated?.editedAt).not.toBeNull();
  });

  it("answers 404 for a comment that does not exist", async () => {
    currentUserId = fixture.ownerId;
    const response = await patchComment(
      new Request("http://x/api/comments/cmt_missing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "x" }),
      }),
      params("cmt_missing"),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/reactions", () => {
  it("lets someone who can see the issue react to it", async () => {
    currentUserId = fixture.memberId;
    const response = await postReaction(
      post("http://x/api/reactions", { issueId: publicIssueId, emoji: "👍" }),
    );
    expect(response.status).toBe(201);
  });

  it("is idempotent on a repeat", async () => {
    currentUserId = fixture.memberId;
    const first = await postReaction(
      post("http://x/api/reactions", { issueId: publicIssueId, emoji: "🎉" }),
    );
    const second = await postReaction(
      post("http://x/api/reactions", { issueId: publicIssueId, emoji: "🎉" }),
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject(await first.json());
  });

  it("refuses a reaction on an issue the actor cannot see", async () => {
    currentUserId = outsiderId;
    const response = await postReaction(
      post("http://x/api/reactions", { issueId: privateIssueId, emoji: "👍" }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a body that names both a comment and an issue", async () => {
    currentUserId = fixture.memberId;
    const response = await postReaction(
      post("http://x/api/reactions", {
        issueId: publicIssueId,
        commentId: ownerCommentId,
        emoji: "👍",
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("POST /api/issues/[id]/relations", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("stores one row and derives the inverse on read", async () => {
    currentUserId = fixture.ownerId;
    const other = await fixture.repos.issues.create(
      { teamId: fixture.teamId, title: "The blocker", creatorId: fixture.ownerId },
      fixture.ownerId,
    );

    const response = await postRelation(
      post(`http://x/api/issues/${publicIssueId}/relations`, {
        relatedIssueId: other.id,
        type: "blocked_by",
      }),
      params(publicIssueId),
    );
    expect(response.status).toBe(201);

    const here = await fixture.repos.issues.listRelations(publicIssueId);
    const there = await fixture.repos.issues.listRelations(other.id);
    expect(here.map((relation) => relation.type)).toContain("blocked_by");
    // One row, read from both ends: the other issue shows the inverse without
    // a second row that could disagree.
    expect(there.map((relation) => relation.type)).toContain("blocks");
    expect(here[0]?.id).toBe(there[0]?.id);
  });

  it("refuses when the actor cannot reach the issue in the URL", async () => {
    currentUserId = outsiderId;
    const response = await postRelation(
      post(`http://x/api/issues/${privateIssueId}/relations`, {
        relatedIssueId: publicIssueId,
        type: "related",
      }),
      params(privateIssueId),
    );
    expect(response.status).toBe(404);
  });

  it("refuses when the actor cannot reach the issue at the far end", async () => {
    // A relation is an edit to both issues — it becomes visible on the other
    // one — so checking only the URL's issue would leak the private issue's
    // identifier and title onto a page the actor can read.
    //
    // The actor is the *team member*, chosen precisely because they pass the
    // first gate: they may edit the public issue. Only the far-end check can
    // refuse this request, so a handler that skipped it would return 201.
    currentUserId = fixture.memberId;
    const response = await postRelation(
      post(`http://x/api/issues/${publicIssueId}/relations`, {
        relatedIssueId: privateIssueId,
        type: "related",
      }),
      params(publicIssueId),
    );
    expect(response.status).toBe(404);

    const relations = await fixture.repos.issues.listRelations(publicIssueId);
    expect(
      relations.some((relation) => relation.relatedIssueId === privateIssueId),
    ).toBe(false);
  });

  it("rejects an unknown relation type", async () => {
    currentUserId = fixture.ownerId;
    const response = await postRelation(
      post(`http://x/api/issues/${publicIssueId}/relations`, {
        relatedIssueId: privateIssueId,
        type: "obliterates",
      }),
      params(publicIssueId),
    );
    expect(response.status).toBe(400);
  });
});
