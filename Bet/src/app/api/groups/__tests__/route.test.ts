// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { getContainer } from "@/lib/container";
import { GET, POST } from "@/app/api/groups/route";

async function sessionCookieFor(userId: string): Promise<string> {
  const { auth } = await getContainer();
  const token = await auth.createSession(brand(userId));
  return `bet_session=${token}`;
}

function listReq(cookie?: string): Request {
  return new Request("http://localhost/api/groups", { headers: cookie ? { cookie } : {} });
}

function createReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("GET /api/groups", () => {
  it("returns forbidden (403) with no session", async () => {
    const res = await GET(listReq() as never);
    expect(res.status).toBe(403);
  });

  it("returns only the caller's own groups", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await GET(listReq(cookie) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    const slugs = body.data.groups.map((g: { slug: string }) => g.slug).sort();
    expect(slugs).toEqual(["fantasy-2026", "sunday-league", "the-roommates"]);
  });
});

describe("POST /api/groups", () => {
  it("returns forbidden (403) with no session", async () => {
    const res = await POST(createReq({ name: "Test", emoji: "🎲" }) as never);
    expect(res.status).toBe(403);
  });

  it("returns validation (400) for a missing name", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(createReq({ emoji: "🎲" }, cookie) as never);
    expect(res.status).toBe(400);
  });

  it("creates a group, slugifies the name, and makes the creator owner + first member", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const res = await POST(createReq({ name: "Book Club!!", emoji: "📚" }, cookie) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.group.slug).toBe("book-club");
    expect(body.data.group.ownerId).toBe(dev!.id);
    expect(body.data.group.memberIds).toEqual([dev!.id]);
  });

  it("uniquifies a colliding slug by appending -2, -3, …", async () => {
    const { store } = await getContainer();
    const dev = await store.users.findByHandle("dev");
    const cookie = await sessionCookieFor(dev!.id);

    const first = await POST(createReq({ name: "Trivia Night", emoji: "🧠" }, cookie) as never);
    const firstBody = await first.json();
    expect(firstBody.data.group.slug).toBe("trivia-night");

    const second = await POST(createReq({ name: "Trivia Night", emoji: "🧠" }, cookie) as never);
    const secondBody = await second.json();
    expect(secondBody.data.group.slug).toBe("trivia-night-2");

    const third = await POST(createReq({ name: "Trivia Night", emoji: "🧠" }, cookie) as never);
    const thirdBody = await third.json();
    expect(thirdBody.data.group.slug).toBe("trivia-night-3");
  });
});
