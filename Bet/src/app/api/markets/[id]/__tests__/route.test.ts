// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { getContainer, resetContainerForTests } from "@/lib/container";
import { GET } from "@/app/api/markets/[id]/route";

beforeEach(() => {
  resetContainerForTests();
});

async function sessionCookieFor(handle: string): Promise<string> {
  const { store, auth } = await getContainer();
  const user = await store.users.findByHandle(handle);
  const token = await auth.createSession(user!.id);
  return `bet_session=${token}`;
}

function getReq(marketId: string, cookie?: string): Request {
  return new Request(`http://localhost/api/markets/${marketId}`, {
    headers: cookie ? { cookie } : {},
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function sl10kId(): Promise<string> {
  const { store } = await getContainer();
  const group = await store.groups.findBySlug("sunday-league");
  const markets = await store.markets.listByGroup(group!.id);
  return markets.find((m) => m.question.includes("10k"))!.id;
}

describe("GET /api/markets/[id]", () => {
  it("returns 404 (never 403) for an anonymous request against a private market", async () => {
    const marketId = await sl10kId();
    const res = await GET(getReq(marketId) as never, ctxFor(marketId));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("returns 404 for a signed-in stranger who isn't a member of the market's group", async () => {
    const marketId = await sl10kId();
    // noodle is only in the-roommates, not sunday-league.
    const cookie = await sessionCookieFor("noodle");
    const res = await GET(getReq(marketId, cookie) as never, ctxFor(marketId));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a made-up market id", async () => {
    const cookie = await sessionCookieFor("dev");
    const res = await GET(getReq("mkt-does-not-exist", cookie) as never, ctxFor("mkt-does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("returns market + prices + my positions + holders for a group member", async () => {
    const marketId = await sl10kId();
    const cookie = await sessionCookieFor("dev"); // dev traded No on sl-10k in the seed
    const res = await GET(getReq(marketId, cookie) as never, ctxFor(marketId));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.market.id).toBe(marketId);
    expect(typeof body.data.prices).toBe("object");
    const priceSum = Object.values(body.data.prices as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(priceSum).toBeCloseTo(1, 6);

    expect(Array.isArray(body.data.myPositions)).toBe(true);
    expect(body.data.myPositions.length).toBeGreaterThan(0);

    expect(Array.isArray(body.data.holders)).toBe(true);
    expect(body.data.holders.length).toBeGreaterThan(0);
    // sl-10k has `stakesVisible: true`, so every holder's stake is revealed.
    for (const holder of body.data.holders) {
      expect(holder.stake).not.toBeUndefined();
    }
  });

  it("hides another holder's exact stake when stakesVisible is off", async () => {
    const { store } = await getContainer();
    const group = await store.groups.findBySlug("the-roommates");
    const markets = await store.markets.listByGroup(group!.id);
    const padThai = markets.find((m) => m.question.toLowerCase().includes("pad thai"))!;
    expect(padThai.stakesVisible).toBe(false);

    // jordan is a the-roommates member but never traded rm-padthai (dev did
    // — using dev here would leak dev's own always-visible stake).
    const cookie = await sessionCookieFor("jordan");
    const res = await GET(getReq(padThai.id, cookie) as never, ctxFor(padThai.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.holders.length).toBeGreaterThan(0);
    for (const holder of body.data.holders) {
      expect(holder.stake).toBeUndefined();
      expect(typeof holder.shares).toBe("number");
    }
  });

  it("an accepted market invite confers participation, even with no group membership or position", async () => {
    const marketId = await sl10kId();
    const { store, clock, idGen } = await getContainer();
    // birdie is a real seeded user but NOT in sunday-league and never
    // traded sl-10k — without an accepted invite this would 404.
    const birdie = await store.users.findByHandle("birdie");
    await store.invites.insert({
      id: brand(idGen.next("inv")),
      kind: "direct",
      targetType: "market",
      targetId: brand(marketId),
      inviterId: (await store.users.findByHandle("maya"))!.id,
      inviteeId: birdie!.id,
      status: "accepted",
      expiresAt: new Date(clock.now().getTime() + 7 * 86_400_000),
      createdAt: clock.now(),
    });

    const cookie = await sessionCookieFor("birdie");
    const res = await GET(getReq(marketId, cookie) as never, ctxFor(marketId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.market.id).toBe(marketId);
  });

  /**
   * Final-review finding A. `can(…,"read",{type:"market"},…)` admits a
   * *pending* invitee on purpose — you have to see a bet to decide whether
   * to join it. The route used to treat that as licence to hand back the
   * whole holders list, including every member's exact stake, because it
   * gated stakes on `market.stakesVisible || own row` instead of on
   * `authz.ts`'s position policy (which requires `isFellowParticipant`).
   * sl-10k has `stakesVisible: true`, so the old code revealed everything.
   */
  async function inviteBirdieToSl10k(status: "sent" | "accepted"): Promise<string> {
    const marketId = await sl10kId();
    const { store, clock, idGen } = await getContainer();
    const birdie = await store.users.findByHandle("birdie");
    const maya = await store.users.findByHandle("maya");
    await store.invites.insert({
      id: brand(idGen.next("inv")),
      kind: "direct",
      targetType: "market",
      targetId: brand(marketId),
      inviterId: maya!.id,
      inviteeId: birdie!.id,
      status,
      expiresAt: new Date(clock.now().getTime() + 7 * 86_400_000),
      createdAt: clock.now(),
    });
    return marketId;
  }

  it("gives a pending invitee the market but no holders and no stakes, even when stakesVisible is on", async () => {
    const marketId = await inviteBirdieToSl10k("sent");
    const { store } = await getContainer();
    const market = await store.markets.findById(brand(marketId));
    expect(market!.stakesVisible).toBe(true);

    const cookie = await sessionCookieFor("birdie");
    const res = await GET(getReq(marketId, cookie) as never, ctxFor(marketId));
    expect(res.status).toBe(200);

    const body = await res.json();
    // They can see the bet itself — that's the point of the invite.
    expect(body.data.market.id).toBe(marketId);
    expect(typeof body.data.prices).toBe("object");
    // …but not the private group's roster, nor anybody's stake.
    expect(body.data.holders).toEqual([]);
    expect(body.data.myPositions).toEqual([]);
  });

  it("gives a genuine participant the holders list with exact stakes on the same market", async () => {
    // Same user, same market, one field different: the invite is accepted,
    // which is what makes them a participant.
    const marketId = await inviteBirdieToSl10k("accepted");
    const cookie = await sessionCookieFor("birdie");
    const res = await GET(getReq(marketId, cookie) as never, ctxFor(marketId));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.holders.length).toBeGreaterThan(0);
    for (const holder of body.data.holders) {
      expect(typeof holder.stake).toBe("number");
    }
  });
});
