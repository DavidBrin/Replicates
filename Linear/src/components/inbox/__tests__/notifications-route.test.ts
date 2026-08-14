// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PgliteDatabase, SCHEMA_SQL, setDbForTests } from "@/adapters/db";
import {
  GET as listNotifications,
  POST as markAllRead,
} from "@/app/api/notifications/route";
import {
  DELETE as deleteNotification,
  PATCH as patchNotification,
} from "@/app/api/notifications/[id]/route";
import type { InboxNotification } from "@/components/inbox/types";
import { createSession, sessionCookieName } from "@/lib/auth/session";

/**
 * The Inbox routes against a real PGlite.
 *
 * `notifications.user_id` already keeps one person's inbox out of another's, so
 * the interesting claim is the second one: **a notification is a pointer to an
 * issue, and team membership changes underneath it.** Someone removed from
 * Engineering still has last week's "assigned you ENG-12" in their row set, and
 * rendering its title would leak a team they are no longer in through a screen
 * nobody thinks of as an issue view.
 *
 * The fixture builds exactly that situation: a guest with a notification about
 * an issue in a team they are not a member of.
 */

const WORKSPACE = "wsp_inbox";
const ENG = "tem_inbox_eng";
const DES = "tem_inbox_des";
const OWNER = "usr_inbox_owner";
const GUEST = "usr_inbox_guest";

let db: PgliteDatabase;
let dispose: () => Promise<void>;

beforeAll(async () => {
  db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();
  dispose = setDbForTests(db);

  await db.execute(
    "insert into workspaces (id, name, url_key) values ($1, 'Inbox', 'inbox')",
    [WORKSPACE],
  );
  for (const [id, email, name] of [
    [OWNER, "owner@inbox.test", "Owner"],
    [GUEST, "guest@inbox.test", "Guest"],
  ] as const) {
    await db.execute(
      `insert into users (id, email, password_hash, name, display_name)
       values ($1, $2, 'x', $3, lower($3))`,
      [id, email, name],
    );
  }
  await db.execute(
    `insert into workspace_members (workspace_id, user_id, role)
     values ($1, $2, 'owner'), ($1, $3, 'guest')`,
    [WORKSPACE, OWNER, GUEST],
  );
  await db.execute(
    `insert into teams (id, workspace_id, name, key, private) values
       ($1, $3, 'Engineering', 'ENG', false),
       ($2, $3, 'Design', 'DES', true)`,
    [ENG, DES, WORKSPACE],
  );
  await db.execute(
    "insert into team_members (team_id, user_id, role) values ($1, $2, 'member')",
    [DES, GUEST],
  );
  for (const [teamId, suffix] of [
    [ENG, "eng"],
    [DES, "des"],
  ] as const) {
    await db.execute(
      `insert into workflow_states (id, team_id, name, type, color, position)
       values ($1, $2, 'Todo', 'unstarted', '#8a8f98', 1)`,
      [`sta_${suffix}`, teamId],
    );
  }
  await db.execute(
    `insert into issues (id, team_id, number, title, state_id, creator_id, sort_order)
     values
       ('iss_eng', $1, 12, 'Engineering only', 'sta_eng', $3, 'a0'),
       ('iss_des', $2, 3,  'Design work',      'sta_des', $3, 'a0')`,
    [ENG, DES, OWNER],
  );
}, 60_000);

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  await db.execute("delete from notifications");
  // Two notifications for the guest: one about an issue they can see, one about
  // an issue in a team they are not in. Only the first may ever reach them.
  await db.execute(
    `insert into notifications (id, user_id, type, issue_id, actor_id, created_at)
     values
       ('ntf_ok',   $1, 'issue_assigned', 'iss_des', $2, now() - interval '1 hour'),
       ('ntf_leak', $1, 'issue_assigned', 'iss_eng', $2, now() - interval '2 hours')`,
    [GUEST, OWNER],
  );
});

async function cookie(userId: string): Promise<string> {
  const session = await createSession(userId, { db });
  return `${sessionCookieName()}=${session.token}`;
}

async function list(userId: string, params = ""): Promise<InboxNotification[]> {
  const response = await listNotifications(
    new Request(`http://localhost/api/notifications?workspace=inbox${params}`, {
      headers: { cookie: await cookie(userId) },
    }),
  );
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { notifications: InboxNotification[] };
  return payload.notifications;
}

function jsonRequest(body: unknown, session: string, method: string): Request {
  return new Request("http://localhost/api/notifications/x", {
    method,
    headers: { "content-type": "application/json", cookie: session },
    body: JSON.stringify(body),
  });
}

/* =============================================================== scoping = */

describe("GET /api/notifications", () => {
  it("drops a notification whose issue the actor may no longer see", async () => {
    // Dropped, not redacted: "a notification about something you cannot see"
    // confirms the issue exists and that something happened to it.
    const rows = await list(GUEST);
    expect(rows.map((row) => row.id)).toEqual(["ntf_ok"]);
    expect(JSON.stringify(rows)).not.toContain("Engineering only");
  });

  it("carries the context a row needs to be readable", async () => {
    const [row] = await list(GUEST);
    expect(row?.actor.name).toBe("Owner");
    expect(row?.issue?.identifier).toBe("DES-3");
    expect(row?.issue?.href).toBe("/inbox/issue/DES-3");
  });

  it("filters to unread on request", async () => {
    await db.execute("update notifications set read_at = now() where id = 'ntf_ok'");
    expect(await list(GUEST, "&filter=unread")).toEqual([]);
  });

  it("hides a snoozed row until its timestamp passes", async () => {
    await db.execute(
      "update notifications set snoozed_until_at = now() + interval '1 day' where id = 'ntf_ok'",
    );
    expect(await list(GUEST)).toEqual([]);

    await db.execute(
      "update notifications set snoozed_until_at = now() - interval '1 minute' where id = 'ntf_ok'",
    );
    expect((await list(GUEST)).map((row) => row.id)).toEqual(["ntf_ok"]);
  });

  it("refuses an anonymous request", async () => {
    const response = await listNotifications(
      new Request("http://localhost/api/notifications?workspace=inbox"),
    );
    expect(response.status).toBe(401);
  });
});

/* ============================================================= mutations = */

describe("PATCH /api/notifications/{id}", () => {
  it("marks one read and reports the new unread count", async () => {
    const response = await patchNotification(
      jsonRequest({ workspace: "inbox", read: true }, await cookie(GUEST), "PATCH"),
      { params: Promise.resolve({ id: "ntf_ok" }) },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      notification: InboxNotification | null;
      unread: number;
    };
    expect(payload.notification?.readAt).not.toBeNull();
    // The count comes from the repository, not from the filtered list: the
    // invisible `ntf_leak` is still an unread row of this user's.
    expect(payload.unread).toBe(1);
  });

  it("refuses to touch a notification whose issue the actor cannot see", async () => {
    // The row *is* addressed to this user. Being able to mark it read would
    // still confirm the Engineering issue exists.
    const response = await patchNotification(
      jsonRequest({ workspace: "inbox", read: true }, await cookie(GUEST), "PATCH"),
      { params: Promise.resolve({ id: "ntf_leak" }) },
    );
    expect(response.status).toBe(404);
  });

  it("refuses another user's notification outright", async () => {
    const response = await patchNotification(
      jsonRequest({ workspace: "inbox", read: true }, await cookie(OWNER), "PATCH"),
      { params: Promise.resolve({ id: "ntf_ok" }) },
    );
    expect(response.status).toBe(404);
  });

  it("rejects a PATCH that changes nothing", async () => {
    // A 200 here would hide a client bug behind a green request.
    const response = await patchNotification(
      jsonRequest({ workspace: "inbox" }, await cookie(GUEST), "PATCH"),
      { params: Promise.resolve({ id: "ntf_ok" }) },
    );
    expect(response.status).toBe(400);
  });

  it("snoozes and unsnoozes by timestamp", async () => {
    const until = new Date(Date.now() + 86_400_000).toISOString();
    await patchNotification(
      jsonRequest(
        { workspace: "inbox", snoozeUntil: until },
        await cookie(GUEST),
        "PATCH",
      ),
      { params: Promise.resolve({ id: "ntf_ok" }) },
    );
    expect(await list(GUEST)).toEqual([]);

    await patchNotification(
      jsonRequest(
        { workspace: "inbox", snoozeUntil: null },
        await cookie(GUEST),
        "PATCH",
      ),
      { params: Promise.resolve({ id: "ntf_ok" }) },
    );
    expect((await list(GUEST)).map((row) => row.id)).toEqual(["ntf_ok"]);
  });
});

describe("POST /api/notifications", () => {
  it("marks everything read in one request", async () => {
    const response = await markAllRead(
      new Request("http://localhost/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: await cookie(GUEST) },
        body: JSON.stringify({ workspace: "inbox", action: "markAllRead" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await list(GUEST, "&filter=unread")).toEqual([]);
  });
});

describe("DELETE /api/notifications/{id}", () => {
  it("removes one the actor can see", async () => {
    const response = await deleteNotification(
      jsonRequest({ workspace: "inbox" }, await cookie(GUEST), "DELETE"),
      { params: Promise.resolve({ id: "ntf_ok" }) },
    );
    expect(response.status).toBe(200);
    expect(await list(GUEST)).toEqual([]);
  });

  it("refuses one the actor cannot see", async () => {
    const response = await deleteNotification(
      jsonRequest({ workspace: "inbox" }, await cookie(GUEST), "DELETE"),
      { params: Promise.resolve({ id: "ntf_leak" }) },
    );
    expect(response.status).toBe(404);

    const remaining = await db.query("select id from notifications where id = 'ntf_leak'");
    expect(remaining).toHaveLength(1);
  });
});
