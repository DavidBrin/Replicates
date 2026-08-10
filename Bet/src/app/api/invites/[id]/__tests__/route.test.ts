// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brand, type Invite } from "@/domain/entities";
import { getContainer } from "@/lib/container";
import { hashInviteToken, mintInviteToken } from "@/app/api/_shared/social";
import { GET, POST } from "@/app/api/invites/[id]/route";

async function sessionCookieFor(userId: string): Promise<string> {
  const { auth } = await getContainer();
  const token = await auth.createSession(brand(userId));
  return `bet_session=${token}`;
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function getReq(): Request {
  return new Request("http://localhost/api/invites/x");
}

function postReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/invites/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/** Inserts an `Invite` row directly (bypassing `POST /api/invites`) so
 * each test controls exactly the invite shape it needs. */
async function insertInvite(overrides: Partial<Invite> & Pick<Invite, "kind" | "targetType" | "targetId" | "inviterId">) {
  const { store, clock, idGen } = await getContainer();
  const now = clock.now();
  const invite: Invite = {
    id: brand(idGen.next("inv")),
    status: "sent",
    createdAt: now,
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
  return store.invites.insert(invite);
}

describe("GET /api/invites/[id] (public link-token preview)", () => {
  it("returns not_found (404) for an unknown token", async () => {
    const res = await GET(getReq() as never, ctxFor("not-a-real-token"));
    expect(res.status).toBe(404);
  });

  it("returns not_found (404) when the segment is a direct invite's id, not a link token", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const liv = await store.users.findByHandle("liv");
    const group = await store.groups.findBySlug("the-roommates");
    const invite = await insertInvite({
      kind: "direct",
      targetType: "group",
      targetId: group!.id,
      inviterId: dev!.id,
      inviteeId: liv!.id,
    });

    const res = await GET(getReq() as never, ctxFor(invite.id));
    expect(res.status).toBe(404);
  });

  it("returns not_found (404) for an expired link token", async () => {
    const { store, clock } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const group = await store.groups.findBySlug("the-roommates");
    const { token, tokenHash } = mintInviteToken();
    await insertInvite({
      kind: "link",
      targetType: "group",
      targetId: group!.id,
      inviterId: dev!.id,
      tokenHash,
      expiresAt: new Date(clock.now().getTime() - 1000),
    });

    const res = await GET(new Request(`http://localhost/api/invites/${token}`) as never, ctxFor(token));
    expect(res.status).toBe(404);
  });

  it("returns not_found (404) for a revoked link token", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const group = await store.groups.findBySlug("the-roommates");
    const { token, tokenHash } = mintInviteToken();
    await insertInvite({
      kind: "link",
      targetType: "group",
      targetId: group!.id,
      inviterId: dev!.id,
      tokenHash,
      status: "revoked",
    });

    const res = await GET(getReq() as never, ctxFor(token));
    expect(res.status).toBe(404);
  });

  it("happy path: previews a live group link invite with the bare minimum fields", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const group = await store.groups.findBySlug("the-roommates");
    const { token, tokenHash } = mintInviteToken();
    await insertInvite({
      kind: "link",
      targetType: "group",
      targetId: group!.id,
      inviterId: dev!.id,
      tokenHash,
    });

    const res = await GET(getReq() as never, ctxFor(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.targetType).toBe("group");
    expect(body.data.targetName).toBe(group!.name);
    expect(body.data.inviterDisplayName).toBe(dev!.displayName);
    expect(body.data.expiresAt).toBeDefined();
    expect(typeof body.data.id).toBe("string");
    // Bare minimum only — no roster, no market internals.
    expect(body.data).not.toHaveProperty("members");
    expect(body.data).not.toHaveProperty("memberIds");
    expect(body.data).not.toHaveProperty("outcomes");
  });
});

describe("POST /api/invites/[id] (accept | decline | revoke)", () => {
  it("returns forbidden (403) with no session", async () => {
    const res = await POST(postReq({ action: "accept" }) as never, ctxFor("inv_bogus"));
    expect(res.status).toBe(403);
  });

  it("returns not_found (404) for an unknown id", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(postReq({ action: "accept" }, cookie) as never, ctxFor("inv_made_up"));
    expect(res.status).toBe(404);
  });

  it("returns not_found (404) when the caller is neither inviter nor invitee (and it's not an open link)", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const liv = await store.users.findByHandle("liv");
    const priya = await store.users.findByHandle("priya");
    const group = await store.groups.findBySlug("the-roommates");
    const invite = await insertInvite({
      kind: "direct",
      targetType: "group",
      targetId: group!.id,
      inviterId: dev!.id,
      inviteeId: liv!.id,
    });
    const cookie = await sessionCookieFor(priya!.id);

    const res = await POST(postReq({ action: "accept" }, cookie) as never, ctxFor(invite.id));
    expect(res.status).toBe(404);
  });

  it("returns forbidden (403) when the inviter tries to accept their own invite", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const liv = await store.users.findByHandle("liv");
    const group = await store.groups.findBySlug("the-roommates");
    const invite = await insertInvite({
      kind: "direct",
      targetType: "group",
      targetId: group!.id,
      inviterId: dev!.id,
      inviteeId: liv!.id,
    });
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(postReq({ action: "accept" }, cookie) as never, ctxFor(invite.id));
    expect(res.status).toBe(403);
  });

  it("happy path: invitee accepts a direct GROUP invite — membership granted atomically", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const liv = await store.users.findByHandle("liv");
    const group = await store.groups.findBySlug("the-roommates");
    const invite = await insertInvite({
      kind: "direct",
      targetType: "group",
      targetId: group!.id,
      inviterId: dev!.id,
      inviteeId: liv!.id,
    });
    const cookie = await sessionCookieFor(liv!.id);

    const res = await POST(postReq({ action: "accept" }, cookie) as never, ctxFor(invite.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.invite.status).toBe("accepted");

    const updatedGroup = await store.groups.findById(group!.id);
    expect(updatedGroup!.memberIds).toContain(liv!.id);
  });

  it("returns conflict (409) accepting the same invite a second time", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const kiwi = await store.users.findByHandle("kiwi");
    const group = await store.groups.findBySlug("fantasy-2026");
    const invite = await insertInvite({
      kind: "direct",
      targetType: "group",
      targetId: group!.id,
      inviterId: dev!.id,
      inviteeId: kiwi!.id,
    });
    const cookie = await sessionCookieFor(kiwi!.id);

    const first = await POST(postReq({ action: "accept" }, cookie) as never, ctxFor(invite.id));
    expect(first.status).toBe(200);
    const second = await POST(postReq({ action: "accept" }, cookie) as never, ctxFor(invite.id));
    expect(second.status).toBe(409);
  });

  it("happy path: invitee declines a direct invite", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const sam = await store.users.findByHandle("sam");
    const roommates = await store.groups.findBySlug("the-roommates");
    const markets = await store.markets.listByGroup(roommates!.id);
    const rmDishes = markets.find((m) => m.creatorId === dev!.id)!;
    const invite = await insertInvite({
      kind: "direct",
      targetType: "market",
      targetId: rmDishes.id,
      inviterId: dev!.id,
      inviteeId: sam!.id,
    });
    const cookie = await sessionCookieFor(sam!.id);

    const res = await POST(postReq({ action: "decline" }, cookie) as never, ctxFor(invite.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.invite.status).toBe("declined");
  });

  it("happy path: inviter revokes an invite, and it stops working immediately", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const liv = await store.users.findByHandle("liv");
    const group = await store.groups.findBySlug("fantasy-2026");
    const invite = await insertInvite({
      kind: "direct",
      targetType: "group",
      targetId: group!.id,
      inviterId: dev!.id,
      inviteeId: liv!.id,
    });
    const inviterCookie = await sessionCookieFor(dev!.id);
    const inviteeCookie = await sessionCookieFor(liv!.id);

    const revokeRes = await POST(
      postReq({ action: "revoke" }, inviterCookie) as never,
      ctxFor(invite.id),
    );
    expect(revokeRes.status).toBe(200);
    const revokeBody = await revokeRes.json();
    expect(revokeBody.data.invite.status).toBe("revoked");

    const acceptAfterRevoke = await POST(
      postReq({ action: "accept" }, inviteeCookie) as never,
      ctxFor(invite.id),
    );
    expect(acceptAfterRevoke.status).toBe(409);
  });

  it("happy path: any signed-in user can accept an OPEN link invite by its id, and a market accept notifies the inviter", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const roommates = await store.groups.findBySlug("the-roommates");
    const markets = await store.markets.listByGroup(roommates!.id);
    const rmDishes = markets.find((m) => m.creatorId === dev!.id)!;
    const { tokenHash } = mintInviteToken();
    const invite = await insertInvite({
      kind: "link",
      targetType: "market",
      targetId: rmDishes.id,
      inviterId: dev!.id,
      tokenHash,
    });
    const marcus = await store.users.findByHandle("marcus");
    const cookie = await sessionCookieFor(marcus!.id);

    const res = await POST(postReq({ action: "accept" }, cookie) as never, ctxFor(invite.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.invite.status).toBe("accepted");
    expect(body.data.invite.inviteeId).toBe(marcus!.id);

    const notifications = await store.notifications.listByUser(dev!.id);
    expect(notifications.some((n) => n.type === "bet_invite_accepted")).toBe(true);
  });
});

// Sanity check that the hash helper this suite relies on is stable and
// matches what the route itself uses to look tokens up.
describe("hashInviteToken", () => {
  it("is deterministic", () => {
    const { token } = mintInviteToken();
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
  });
});
