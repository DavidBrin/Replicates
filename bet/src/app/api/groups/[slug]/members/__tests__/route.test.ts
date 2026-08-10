// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { getContainer } from "@/lib/container";
import { POST } from "@/app/api/groups/[slug]/members/route";

async function sessionCookieFor(userId: string): Promise<string> {
  const { auth } = await getContainer();
  const token = await auth.createSession(brand(userId));
  return `bet_session=${token}`;
}

function inviteReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/groups/the-roommates/members", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function ctxFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("POST /api/groups/[slug]/members", () => {
  it("returns forbidden (403) with no session", async () => {
    const res = await POST(inviteReq({ handle: "liv" }) as never, ctxFor("the-roommates"));
    expect(res.status).toBe(403);
  });

  it("returns not_found (404) when the caller isn't a member of the group", async () => {
    const { store } = await getContainer();
    const birdie = await store.users.findByHandle("birdie"); // not in the-roommates
    const cookie = await sessionCookieFor(birdie!.id);

    const res = await POST(inviteReq({ handle: "liv" }, cookie) as never, ctxFor("the-roommates"));
    expect(res.status).toBe(404);
  });

  it("returns validation (400) when the target isn't a friend of the caller", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    // yeetmaster is not a seeded friend of dev.
    const res = await POST(
      inviteReq({ handle: "yeetmaster" }, cookie) as never,
      ctxFor("the-roommates"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation");
  });

  it("returns conflict (409) when the target is already a member", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    // jordan is already in the-roommates AND is a friend of dev.
    const res = await POST(inviteReq({ handle: "jordan" }, cookie) as never, ctxFor("the-roommates"));
    expect(res.status).toBe(409);
  });

  it("happy path: invites a friend who isn't yet a member — creates an INVITE, not a direct add", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    // liv is a friend of dev, not a member of the-roommates.
    const res = await POST(inviteReq({ handle: "liv" }, cookie) as never, ctxFor("the-roommates"));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.invite.kind).toBe("direct");
    expect(body.data.invite.targetType).toBe("group");
    expect(body.data.invite.status).toBe("sent");

    const group = await store.groups.findBySlug("the-roommates");
    const liv = await store.users.findByHandle("liv");
    // Not a direct add — liv is NOT yet a member, just invited.
    expect(group!.memberIds).not.toContain(liv!.id);
  });

  it("returns conflict (409) inviting the same friend twice", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(inviteReq({ handle: "liv" }, cookie) as never, ctxFor("the-roommates"));
    expect(res.status).toBe(409);
  });
});
