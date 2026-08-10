// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { getContainer } from "@/lib/container";
import { GET, POST } from "@/app/api/notifications/route";

async function sessionCookieFor(userId: string): Promise<string> {
  const { auth } = await getContainer();
  const token = await auth.createSession(brand(userId));
  return `bet_session=${token}`;
}

function listReq(query?: string, cookie?: string): Request {
  const url = `http://localhost/api/notifications${query ? `?${query}` : ""}`;
  return new Request(url, { headers: cookie ? { cookie } : {} });
}

function postReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("GET /api/notifications", () => {
  it("returns forbidden (403) with no session", async () => {
    const res = await GET(listReq() as never);
    expect(res.status).toBe(403);
  });

  it("returns dev's own seeded notifications, never anyone else's", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await GET(listReq(undefined, cookie) as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.data.notifications)).toBe(true);
    expect(body.data.notifications.length).toBeGreaterThan(0);
    for (const n of body.data.notifications) {
      expect(n.userId).toBe(dev!.id);
    }
    // Seeded: chaosgremlin + yeetmaster both sent dev a friend request.
    const types = body.data.notifications.map((n: { type: string }) => n.type);
    expect(types.every((t: string) => t === "friend_request_received")).toBe(true);
    expect(body.data.unreadCount).toBe(body.data.notifications.length);
  });

  it("filters to unread-only and caps limit", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await GET(listReq("unreadOnly=true&limit=1", cookie) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.notifications.length).toBe(1);
    expect(body.data.notifications[0].readAt).toBeUndefined();
  });

  it("caps limit at 50 even when a larger value is requested", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await GET(listReq("limit=999", cookie) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.notifications.length).toBeLessThanOrEqual(50);
  });

  it("returns validation (400) for a garbage unreadOnly value", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await GET(listReq("unreadOnly=maybe", cookie) as never);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/notifications", () => {
  it("returns forbidden (403) with no session", async () => {
    const res = await POST(postReq({ action: "markAllRead" }) as never);
    expect(res.status).toBe(403);
  });

  it("returns not_found (404) marking another user's notification read", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const noodle = await store.users.findByHandle("noodle");
    const devCookie = await sessionCookieFor(dev!.id);
    const noodleCookie = await sessionCookieFor(noodle!.id);

    const [devNotification] = await store.notifications.listByUser(dev!.id);
    expect(devNotification).toBeDefined();

    // Sanity: dev CAN read their own list (already proven above); the
    // actual assertion here is that noodle cannot mark IT read.
    void devCookie;
    const res = await POST(
      postReq({ action: "markRead", id: devNotification!.id }, noodleCookie) as never,
    );
    expect(res.status).toBe(404);
  });

  it("returns not_found (404) for a bogus id", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(
      postReq({ action: "markRead", id: "ntf_totally_made_up" }, cookie) as never,
    );
    expect(res.status).toBe(404);
  });

  it("returns validation (400) for an unknown action", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(postReq({ action: "yeet" }, cookie) as never);
    expect(res.status).toBe(400);
  });

  it("marks a single notification read", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const before = (await store.notifications.listByUser(dev!.id, { unreadOnly: true }))[0]!;

    const res = await POST(
      postReq({ action: "markRead", id: before.id }, cookie) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.notification.id).toBe(before.id);
    expect(body.data.notification.readAt).toBeDefined();

    const stillUnread = await store.notifications.listByUser(dev!.id, { unreadOnly: true });
    expect(stillUnread.some((n) => n.id === before.id)).toBe(false);
  });

  it("marks all of dev's remaining notifications read", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const unreadBefore = await store.notifications.listByUser(dev!.id, { unreadOnly: true });
    expect(unreadBefore.length).toBeGreaterThan(0);

    const res = await POST(postReq({ action: "markAllRead" }, cookie) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.markedAll).toBe(true);

    const unreadAfter = await store.notifications.listByUser(dev!.id, { unreadOnly: true });
    expect(unreadAfter.length).toBe(0);

    const getRes = await GET(listReq(undefined, cookie) as never);
    const getBody = await getRes.json();
    expect(getBody.data.unreadCount).toBe(0);
  });
});
