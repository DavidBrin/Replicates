// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { getContainer } from "@/lib/container";
import { POST } from "@/app/api/invites/route";

async function sessionCookieFor(userId: string): Promise<string> {
  const { auth } = await getContainer();
  const token = await auth.createSession(brand(userId));
  return `bet_session=${token}`;
}

function createReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/invites", () => {
  it("returns forbidden (403) with no session", async () => {
    const res = await POST(
      createReq({ targetType: "group", targetId: "grp_x", kind: "link" }) as never,
    );
    expect(res.status).toBe(403);
  });

  it("returns validation (400) when neither inviteeId nor kind:link is given", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);
    const group = await store.groups.findBySlug("the-roommates");

    const res = await POST(
      createReq({ targetType: "group", targetId: group!.id, kind: "direct" }, cookie) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns validation (400) when BOTH inviteeId and kind:link are given", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);
    const group = await store.groups.findBySlug("the-roommates");
    const liv = await store.users.findByHandle("liv");

    const res = await POST(
      createReq(
        { targetType: "group", targetId: group!.id, kind: "link", inviteeId: liv!.id },
        cookie,
      ) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns not_found (404) when the caller isn't a member of the target group", async () => {
    const { store } = await getContainer();
    const birdie = await store.users.findByHandle("birdie"); // not in the-roommates
    const cookie = await sessionCookieFor(birdie!.id);
    const group = await store.groups.findBySlug("the-roommates");

    const res = await POST(
      createReq({ targetType: "group", targetId: group!.id, kind: "link" }, cookie) as never,
    );
    expect(res.status).toBe(404);
  });

  it("returns not_found (404) when the caller has no access to the target market", async () => {
    const { store } = await getContainer();
    const birdie = await store.users.findByHandle("birdie");
    const cookie = await sessionCookieFor(birdie!.id);
    const dev = await store.users.findByHandle("dev");
    const roommates = await store.groups.findBySlug("the-roommates");
    const markets = await store.markets.listByGroup(roommates!.id);
    const rmDishes = markets.find((m) => m.creatorId === dev!.id)!;
    const liv = await store.users.findByHandle("liv");

    const res = await POST(
      createReq(
        { targetType: "market", targetId: rmDishes.id, inviteeId: liv!.id },
        cookie,
      ) as never,
    );
    expect(res.status).toBe(404);
  });

  it("returns validation (400) when the invitee isn't a friend of the caller (market)", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);
    const roommates = await store.groups.findBySlug("the-roommates");
    const markets = await store.markets.listByGroup(roommates!.id);
    const rmDishes = markets.find((m) => m.creatorId === dev!.id)!;
    const yeetmaster = await store.users.findByHandle("yeetmaster"); // not a friend of dev

    const res = await POST(
      createReq(
        { targetType: "market", targetId: rmDishes.id, inviteeId: yeetmaster!.id },
        cookie,
      ) as never,
    );
    expect(res.status).toBe(400);
  });

  it("happy path: direct market invite to a friend notifies them", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);
    const roommates = await store.groups.findBySlug("the-roommates");
    const markets = await store.markets.listByGroup(roommates!.id);
    const rmDishes = markets.find((m) => m.creatorId === dev!.id)!;
    const liv = await store.users.findByHandle("liv");

    const res = await POST(
      createReq({ targetType: "market", targetId: rmDishes.id, inviteeId: liv!.id }, cookie) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.invite.kind).toBe("direct");
    expect(body.data.invite.inviteeId).toBe(liv!.id);
    expect(body.data.invite.tokenHash).toBeUndefined();

    const notifications = await store.notifications.listByUser(liv!.id);
    expect(notifications.some((n) => n.type === "bet_invite_received")).toBe(true);
  });

  it("happy path: link invite mints a raw token, stores only its hash, and includes a 7-day expiry", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);
    const group = await store.groups.findBySlug("the-roommates");

    const res = await POST(
      createReq({ targetType: "group", targetId: group!.id, kind: "link" }, cookie) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.data.token).toBe("string");
    expect(body.data.token.length).toBeGreaterThan(20);
    expect(body.data.invite.kind).toBe("link");
    expect(body.data.invite.tokenHash).toBeDefined();
    expect(body.data.invite.tokenHash).not.toBe(body.data.token);

    const stored = await store.invites.findById(body.data.invite.id);
    const expiresInDays =
      (new Date(stored!.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(expiresInDays).toBeGreaterThan(6.9);
    expect(expiresInDays).toBeLessThanOrEqual(7);
  });
});
