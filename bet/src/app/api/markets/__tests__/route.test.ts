// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { getContainer, resetContainerForTests } from "@/lib/container";
import { POST } from "@/app/api/markets/route";

beforeEach(() => {
  resetContainerForTests();
});

async function sessionCookieFor(handle: string): Promise<string> {
  const { store, auth } = await getContainer();
  const user = await store.users.findByHandle(handle);
  const token = await auth.createSession(user!.id);
  return `bet_session=${token}`;
}

function postReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/markets", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function sundayLeagueGroupId(): Promise<string> {
  const { store } = await getContainer();
  const group = await store.groups.findBySlug("sunday-league");
  return group!.id;
}

describe("POST /api/markets", () => {
  it("requires sign-in", async () => {
    const groupId = await sundayLeagueGroupId();
    const res = await POST(
      postReq({
        groupId,
        question: "Will it rain?",
        resolutionCriteria: "Resolves Yes if it rains, No otherwise.",
        closesAt: new Date(Date.now() + 86_400_000).toISOString(),
        outcomes: [{ label: "Yes" }, { label: "No" }],
      }) as never,
    );
    expect(res.status).toBe(403);
  });

  it("creates a market + outcomes in one transaction for a group member", async () => {
    const groupId = await sundayLeagueGroupId();
    const cookie = await sessionCookieFor("dev");
    const closesAt = new Date(Date.now() + 3 * 86_400_000).toISOString();

    const res = await POST(
      postReq(
        {
          groupId,
          question: "Will the demo pass review?",
          resolutionCriteria: "Resolves Yes if the reviewer approves on the first pass.",
          closesAt,
          outcomes: [{ label: "Yes" }, { label: "No" }],
        },
        cookie,
      ) as never,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.market.question).toBe("Will the demo pass review?");
    expect(body.data.market.outcomes).toHaveLength(2);
    expect(body.data.market.status).toBe("open");
    expect(body.data.market.pricing.kind).toBe("lmsr");

    // A system "opened for trading" message was posted into the Room.
    const { store } = await getContainer();
    const messages = await store.messages.listMessages(body.data.market.id, { limit: 10 });
    expect(messages.some((m) => m.kind === "system")).toBe(true);
  });

  it("rejects creating a market in a group you're not a member of (404, not 403)", async () => {
    const groupId = await sundayLeagueGroupId(); // yeetmaster is NOT in sunday-league
    const cookie = await sessionCookieFor("yeetmaster");
    const res = await POST(
      postReq(
        {
          groupId,
          question: "Will it rain?",
          resolutionCriteria: "Resolves Yes if it rains, No otherwise, per group consensus.",
          closesAt: new Date(Date.now() + 86_400_000).toISOString(),
          outcomes: [{ label: "Yes" }, { label: "No" }],
        },
        cookie,
      ) as never,
    );
    expect(res.status).toBe(404);
    const bodyJson = await res.json();
    expect(bodyJson.error.code).toBe("not_found");
  });

  it("rejects a closesAt in the past", async () => {
    const groupId = await sundayLeagueGroupId();
    const cookie = await sessionCookieFor("dev");
    const res = await POST(
      postReq(
        {
          groupId,
          question: "Will it rain?",
          resolutionCriteria: "Resolves Yes if it rains, No otherwise, per group consensus.",
          closesAt: new Date(Date.now() - 86_400_000).toISOString(),
          outcomes: [{ label: "Yes" }, { label: "No" }],
        },
        cookie,
      ) as never,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a bad request body (validation, G4)", async () => {
    const groupId = await sundayLeagueGroupId();
    const cookie = await sessionCookieFor("dev");
    const res = await POST(postReq({ groupId, question: "" }, cookie) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation");
  });

  it("rejects inviting a non-friend directly to the new bet", async () => {
    const groupId = await sundayLeagueGroupId();
    const cookie = await sessionCookieFor("dev");
    const { store } = await getContainer();
    // birdie is a real seeded user but not dev's friend.
    const birdie = await store.users.findByHandle("birdie");

    const res = await POST(
      postReq(
        {
          groupId,
          question: "Will it rain?",
          resolutionCriteria: "Resolves Yes if it rains, No otherwise, per group consensus.",
          closesAt: new Date(Date.now() + 86_400_000).toISOString(),
          outcomes: [{ label: "Yes" }, { label: "No" }],
          inviteeIds: [birdie!.id],
        },
        cookie,
      ) as never,
    );
    expect(res.status).toBe(400);
  });
});
