// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setDbForTests, type SqlDatabase } from "@/adapters/db";
import {
  createFixture,
  createTestDatabase,
  type Fixture,
} from "@/adapters/repositories/__tests__/harness";
import { POST as postComment } from "@/app/api/comments/route";
import { createSession, sessionCookieName } from "@/lib/auth/session";

/**
 * `parentId` is a second issue reference, and it is authorized like one.
 *
 * `POST /api/comments` checks `comment.create` on the issue in `issueId`. The
 * parent is a *comment* id, and a comment belongs to an issue of its own — so
 * left unchecked, a reply filed against a readable issue can hang itself off a
 * thread in one the author cannot see. Two things follow from that, and both are
 * asserted here:
 *
 * - the write is **structural**: the stored `parent_id` is the thread root, so
 *   deleting the unreadable issue cascades through `comments.parent_id` into
 *   this one — the comment's lifetime becomes a function of a row its author was
 *   never authorized against;
 * - the refusal is a **404**, the same answer a fabricated comment id gets,
 *   because the two ids differ only in whether they name something the author is
 *   entitled to know about.
 */

let db: SqlDatabase;
let dispose: () => Promise<void>;
let fixture: Fixture;

let publicIssueId: string;
let privateIssueId: string;
let privateCommentId: string;
let publicCommentId: string;

const PRIVATE_COMMENT = "the private thread nobody outside SEC may see";

beforeAll(async () => {
  db = await createTestDatabase();
  dispose = setDbForTests(db);
  fixture = await createFixture(db);

  const sec = await fixture.repos.teams.create(
    {
      workspaceId: fixture.workspaceId,
      name: "Secrets",
      key: "SEC",
      private: true,
    },
    fixture.ownerId,
  );

  const publicIssue = await fixture.repos.issues.create(
    { teamId: fixture.teamId, title: "Public work", creatorId: fixture.ownerId },
    fixture.ownerId,
  );
  publicIssueId = publicIssue.id;

  const privateIssue = await fixture.repos.issues.create(
    { teamId: sec.id, title: "Private work", creatorId: fixture.ownerId },
    fixture.ownerId,
  );
  privateIssueId = privateIssue.id;

  privateCommentId = (
    await fixture.repos.comments.create({
      issueId: privateIssue.id,
      userId: fixture.ownerId,
      body: PRIVATE_COMMENT,
    })
  ).id;

  publicCommentId = (
    await fixture.repos.comments.create({
      issueId: publicIssue.id,
      userId: fixture.ownerId,
      body: "the public thread",
    })
  ).id;
}, 60_000);

afterAll(async () => {
  await dispose();
});

async function comment(
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const session = await createSession(userId, { db });
  return postComment(
    new Request("http://x/api/comments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${sessionCookieName()}=${session.token}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/comments — the parent must be on this issue", () => {
  it("refuses a parent in an issue the author cannot see, as a 404", async () => {
    // The member may comment on the public issue — that gate passes — and the
    // parent is what carries the request somewhere else.
    const foreign = await comment(fixture.memberId, {
      issueId: publicIssueId,
      body: "replying into somebody else's thread",
      parentId: privateCommentId,
    });
    const fabricated = await comment(fixture.memberId, {
      issueId: publicIssueId,
      body: "replying into nothing",
      parentId: "cmt_does_not_exist",
    });

    expect(foreign.status).toBe(404);
    expect(fabricated.status).toBe(404);
    const text = await foreign.text();
    expect(text).toBe(await fabricated.text());
    expect(text).not.toContain(PRIVATE_COMMENT);
    expect(text).not.toContain(privateIssueId);
  });

  it("writes nothing, so no delete of the private issue can reach this one", async () => {
    const here = await fixture.repos.comments.listForIssue(publicIssueId);
    expect(
      here.some((entry) => entry.parentId === privateCommentId),
    ).toBe(false);
    expect(
      here.some((entry) => entry.body === "replying into somebody else's thread"),
    ).toBe(false);
  });

  it("refuses a parent on a *readable* issue that is not this one", async () => {
    // Not a privacy leak — the member can read both — but the same structural
    // mistake: the reply would land in a thread on another issue and be listed
    // under neither reliably. Answered identically so the two cannot be told
    // apart by probing.
    const other = await fixture.repos.issues.create(
      { teamId: fixture.teamId, title: "Another public issue", creatorId: fixture.ownerId },
      fixture.ownerId,
    );

    const response = await comment(fixture.memberId, {
      issueId: other.id,
      body: "wrong thread",
      parentId: publicCommentId,
    });
    expect(response.status).toBe(404);
  });

  it("still accepts a reply into a thread on the issue itself", async () => {
    const reply = await comment(fixture.memberId, {
      issueId: publicIssueId,
      body: "on it",
      parentId: publicCommentId,
    });
    expect(reply.status).toBe(201);
    expect(await reply.json()).toMatchObject({ parentId: publicCommentId });
  });

  it("still flattens a reply-to-a-reply onto the thread root", async () => {
    // The one-level-deep rule the repository enforces on write. The check added
    // here follows the same hop, so it must not refuse the shape it is meant to
    // allow.
    const first = await comment(fixture.memberId, {
      issueId: publicIssueId,
      body: "first reply",
      parentId: publicCommentId,
    });
    const firstId = ((await first.json()) as { id: string }).id;

    const second = await comment(fixture.memberId, {
      issueId: publicIssueId,
      body: "reply to the reply",
      parentId: firstId,
    });
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject({ parentId: publicCommentId });
  });

  it("still accepts a top-level comment", async () => {
    const response = await comment(fixture.memberId, {
      issueId: publicIssueId,
      body: "no parent at all",
    });
    expect(response.status).toBe(201);
  });
});
