/**
 * Shared `DataStore` contract suite. Call `runDataStoreContract(name,
 * makeStore)` once per adapter — currently just the in-memory one, but any
 * future adapter (e.g. a real DB) plugs into the exact same suite.
 *
 * Not itself a `*.test.ts` file (vitest's `include` glob won't pick it up),
 * by design — `memory.test.ts` is the thing that actually invokes it.
 */

import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import type {
  FriendRequest,
  Friendship,
  Group,
  Invite,
  Market,
  Message,
  Notification,
  Outcome,
  Position,
  PricePoint,
  Trade,
  User,
} from "@/domain/entities";
import { credits } from "@/domain/money";
import type { DataStore } from "@/ports/data-store";

// ---------------------------------------------------------------------------
// Fixture builders — cheap, overridable, deliberately minimal-but-valid.
// ---------------------------------------------------------------------------

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: brand(uid("user")),
    handle: uid("handle"),
    displayName: "Test User",
    avatarColor: "#4f46e5",
    avatarInitials: "TU",
    balance: credits(1000),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: brand(uid("group")),
    slug: uid("slug"),
    name: "Test Group",
    emoji: "🎲",
    memberIds: [],
    ownerId: brand(uid("user")),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeOutcome(marketId: Market["id"], overrides: Partial<Outcome> = {}): Outcome {
  return {
    id: brand(uid("outcome")),
    marketId,
    label: "Yes",
    color: "#22c55e",
    ...overrides,
  };
}

function makeMarket(overrides: Partial<Market> = {}): Market {
  const resolvedId: Market["id"] = overrides.id ?? brand(uid("market"));
  const outcomes =
    overrides.outcomes ?? [
      makeOutcome(resolvedId, { label: "Yes", color: "#22c55e" }),
      makeOutcome(resolvedId, { label: "No", color: "#ef4444" }),
    ];
  return {
    id: resolvedId,
    groupId: null,
    creatorId: brand(uid("user")),
    question: "Will it happen?",
    resolutionCriteria: "Resolves YES if it happens by the close date.",
    closesAt: new Date("2026-12-31T00:00:00Z"),
    status: "open",
    visibility: "private",
    pricing: { kind: "lmsr", b: 100, feeBps: 0, q: {} },
    minStake: credits(100),
    maxStake: credits(10000),
    stakesVisible: true,
    outcomes,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: brand(uid("position")),
    marketId: brand(uid("market")),
    outcomeId: brand(uid("outcome")),
    userId: brand(uid("user")),
    shares: 10,
    costBasis: credits(500),
    ...overrides,
  };
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: brand(uid("trade")),
    marketId: brand(uid("market")),
    outcomeId: brand(uid("outcome")),
    userId: brand(uid("user")),
    side: "buy",
    shares: 10,
    cost: credits(500),
    avgPrice: 0.5,
    fee: credits(0),
    at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: brand(uid("message")),
    roomId: brand(uid("room")),
    authorId: brand(uid("user")),
    kind: "text",
    body: "hello",
    at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeFriendRequest(overrides: Partial<FriendRequest> = {}): FriendRequest {
  return {
    id: brand(uid("freq")),
    fromId: brand(uid("user")),
    toId: brand(uid("user")),
    status: "pending",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: brand(uid("invite")),
    kind: "direct",
    targetType: "group",
    targetId: brand(uid("group")),
    inviterId: brand(uid("user")),
    status: "created",
    expiresAt: new Date("2026-02-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: brand(uid("notif")),
    userId: brand(uid("user")),
    type: "friend_request_received",
    payload: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePricePoint(overrides: Partial<PricePoint> = {}): PricePoint {
  return {
    marketId: brand(uid("market")),
    at: new Date("2026-01-01T00:00:00Z"),
    prices: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

export function runDataStoreContract(name: string, makeStore: () => DataStore): void {
  describe(`DataStore contract: ${name}`, () => {
    // -- absent reads -------------------------------------------------------

    it("absent reads return undefined, never throw", async () => {
      const store = makeStore();
      await expect(store.users.findById(brand("missing"))).resolves.toBeUndefined();
      await expect(store.users.findByHandle("nobody")).resolves.toBeUndefined();
      await expect(store.groups.findById(brand("missing"))).resolves.toBeUndefined();
      await expect(store.groups.findBySlug("missing")).resolves.toBeUndefined();
      await expect(store.markets.findById(brand("missing"))).resolves.toBeUndefined();
      await expect(store.positions.findById(brand("missing"))).resolves.toBeUndefined();
      await expect(
        store.positions.find(brand("m"), brand("o"), brand("u")),
      ).resolves.toBeUndefined();
      await expect(store.trades.findById(brand("missing"))).resolves.toBeUndefined();
      await expect(store.invites.findById(brand("missing"))).resolves.toBeUndefined();
      await expect(store.invites.findByTokenHash("missing")).resolves.toBeUndefined();
      await expect(store.notifications.findById(brand("missing"))).resolves.toBeUndefined();
      await expect(store.friends.findRequestById(brand("missing"))).resolves.toBeUndefined();
      await expect(
        store.friends.findPendingRequest(brand("a"), brand("b")),
      ).resolves.toBeUndefined();
      await expect(store.friends.areFriends(brand("a"), brand("b"))).resolves.toBe(false);
      await expect(
        store.messages.findByClientId(brand("room"), brand("user"), "cid"),
      ).resolves.toBeUndefined();
    });

    // -- basic CRUD round-trips ----------------------------------------------

    it("insert then findById round-trips a user", async () => {
      const store = makeStore();
      const user = makeUser({ handle: "davidb" });
      const inserted = await store.users.insert(user);
      expect(inserted).toEqual(user);

      const fetched = await store.users.findById(user.id);
      expect(fetched).toEqual(user);

      const byHandle = await store.users.findByHandle("DAVIDB");
      expect(byHandle).toEqual(user);
    });

    it("update patches only the given fields", async () => {
      const store = makeStore();
      const user = await store.users.insert(makeUser({ balance: credits(1000) }));
      const updated = await store.users.update(user.id, { balance: credits(1500) });
      expect(updated.balance).toBe(1500);
      expect(updated.handle).toBe(user.handle);
    });

    it("searchByHandlePrefix is case-insensitive and capped", async () => {
      const store = makeStore();
      await store.users.insert(makeUser({ handle: "alice1" }));
      await store.users.insert(makeUser({ handle: "alice2" }));
      await store.users.insert(makeUser({ handle: "bob" }));

      const results = await store.users.searchByHandlePrefix("ALI", 10);
      expect(results.map((u) => u.handle).sort()).toEqual(["alice1", "alice2"]);

      const capped = await store.users.searchByHandlePrefix("ali", 1);
      expect(capped).toHaveLength(1);
    });

    // -- mutation-by-reference (structural cloning) --------------------------

    it("mutating a returned entity does not corrupt the store (structural cloning on read)", async () => {
      const store = makeStore();
      const inserted = await store.users.insert(makeUser({ handle: "clonecheck" }));

      const fetched = await store.users.findById(inserted.id);
      expect(fetched).toBeDefined();
      if (!fetched) throw new Error("unreachable");
      fetched.handle = "MUTATED";
      fetched.balance = credits(999_999);

      const refetched = await store.users.findById(inserted.id);
      expect(refetched?.handle).toBe("clonecheck");
      expect(refetched?.balance).toBe(1000);
    });

    it("mutating an object before insert does not affect the stored copy", async () => {
      const store = makeStore();
      const user = makeUser({ handle: "preinsert" });
      await store.users.insert(user);
      user.handle = "MUTATED-AFTER-INSERT";

      const fetched = await store.users.findById(user.id);
      expect(fetched?.handle).toBe("preinsert");
    });

    it("mutating an array/nested-object field on a returned market does not corrupt the store", async () => {
      const store = makeStore();
      const market = await store.markets.insert(makeMarket());

      const fetched = await store.markets.findById(market.id);
      if (!fetched) throw new Error("unreachable");
      fetched.outcomes.push(makeOutcome(market.id, { label: "Injected" }));
      fetched.outcomes[0].label = "MUTATED";

      const refetched = await store.markets.findById(market.id);
      expect(refetched?.outcomes).toHaveLength(2);
      expect(refetched?.outcomes[0].label).toBe("Yes");
    });

    // -- friendship: ordered pair --------------------------------------------

    it("friendships are stored as an ordered pair, regardless of insertion order", async () => {
      const store = makeStore();
      const a = brand<"UserId">("user_zzz");
      const b = brand<"UserId">("user_aaa");
      // b < a lexicographically; insert with the "wrong" order and expect
      // the adapter to normalize it.
      const friendship: Friendship = { userAId: a, userBId: b, createdAt: new Date() };
      const inserted = await store.friends.insertFriendship(friendship);
      expect(inserted.userAId).toBe(b);
      expect(inserted.userBId).toBe(a);

      expect(await store.friends.areFriends(a, b)).toBe(true);
      expect(await store.friends.areFriends(b, a)).toBe(true);

      const listedForA = await store.friends.listFriends(a);
      expect(listedForA).toHaveLength(1);
      const listedForB = await store.friends.listFriends(b);
      expect(listedForB).toHaveLength(1);
    });

    it("removeFriendship works regardless of argument order", async () => {
      const store = makeStore();
      const a = brand<"UserId">("user_1");
      const b = brand<"UserId">("user_2");
      await store.friends.insertFriendship({ userAId: a, userBId: b, createdAt: new Date() });
      expect(await store.friends.areFriends(a, b)).toBe(true);

      await store.friends.removeFriendship(b, a);
      expect(await store.friends.areFriends(a, b)).toBe(false);
    });

    // -- friend requests ------------------------------------------------------

    it("friend request lifecycle: create, find pending, update status", async () => {
      const store = makeStore();
      const from = brand<"UserId">(uid("user"));
      const to = brand<"UserId">(uid("user"));
      const request = await store.friends.createRequest(makeFriendRequest({ fromId: from, toId: to }));

      const pending = await store.friends.findPendingRequest(from, to);
      expect(pending?.id).toBe(request.id);

      const incoming = await store.friends.listIncomingRequests(to, "pending");
      expect(incoming).toHaveLength(1);
      const outgoing = await store.friends.listOutgoingRequests(from, "pending");
      expect(outgoing).toHaveLength(1);

      const accepted = await store.friends.updateRequestStatus(request.id, "accepted");
      expect(accepted.status).toBe("accepted");

      expect(await store.friends.findPendingRequest(from, to)).toBeUndefined();
      expect(await store.friends.listIncomingRequests(to, "pending")).toHaveLength(0);
    });

    // -- groups -----------------------------------------------------------------

    it("group membership: add/remove/listByMember", async () => {
      const store = makeStore();
      const owner = brand<"UserId">(uid("user"));
      const member = brand<"UserId">(uid("user"));
      const group = await store.groups.insert(makeGroup({ ownerId: owner, memberIds: [owner] }));

      await store.groups.addMember(group.id, member);
      const afterAdd = await store.groups.findById(group.id);
      expect(afterAdd?.memberIds).toEqual(expect.arrayContaining([owner, member]));

      const listed = await store.groups.listByMember(member);
      expect(listed.map((g) => g.id)).toContain(group.id);

      await store.groups.removeMember(group.id, member);
      const afterRemove = await store.groups.findById(group.id);
      expect(afterRemove?.memberIds).not.toContain(member);
    });

    // -- markets ------------------------------------------------------------

    it("markets: listByGroup, listByCreator, listPublic", async () => {
      const store = makeStore();
      const group = await store.groups.insert(makeGroup());
      const creator = brand<"UserId">(uid("user"));
      const groupMarket = await store.markets.insert(
        makeMarket({ groupId: group.id, creatorId: creator, visibility: "group" }),
      );
      const publicMarket = await store.markets.insert(
        makeMarket({ creatorId: creator, visibility: "public" }),
      );
      await store.markets.insert(makeMarket({ visibility: "private" }));

      expect((await store.markets.listByGroup(group.id)).map((m) => m.id)).toEqual([groupMarket.id]);
      expect((await store.markets.listByCreator(creator)).map((m) => m.id).sort()).toEqual(
        [groupMarket.id, publicMarket.id].sort(),
      );
      expect((await store.markets.listPublic()).map((m) => m.id)).toEqual([publicMarket.id]);
    });

    // -- positions / trades ---------------------------------------------------

    it("positions: find by (market, outcome, user) triple, list by market/user", async () => {
      const store = makeStore();
      const marketId = brand<"MarketId">(uid("market"));
      const outcomeId = brand<"OutcomeId">(uid("outcome"));
      const userId = brand<"UserId">(uid("user"));
      const position = await store.positions.insert(
        makePosition({ marketId, outcomeId, userId }),
      );

      expect(await store.positions.find(marketId, outcomeId, userId)).toEqual(position);
      expect((await store.positions.listByMarket(marketId)).map((p) => p.id)).toEqual([position.id]);
      expect((await store.positions.listByUser(userId)).map((p) => p.id)).toEqual([position.id]);

      const updated = await store.positions.update(position.id, { shares: 42 });
      expect(updated.shares).toBe(42);
    });

    it("trades: insert and list by market/user", async () => {
      const store = makeStore();
      const marketId = brand<"MarketId">(uid("market"));
      const userId = brand<"UserId">(uid("user"));
      const trade = await store.trades.insert(makeTrade({ marketId, userId }));

      expect((await store.trades.listByMarket(marketId)).map((t) => t.id)).toEqual([trade.id]);
      expect((await store.trades.listByUser(userId)).map((t) => t.id)).toEqual([trade.id]);
    });

    // -- price history --------------------------------------------------------

    it("price history: append then listByMarket in chronological order", async () => {
      const store = makeStore();
      const marketId = brand<"MarketId">(uid("market"));
      const p1 = await store.priceHistory.append(
        makePricePoint({ marketId, at: new Date("2026-01-01T00:00:00Z") }),
      );
      const p2 = await store.priceHistory.append(
        makePricePoint({ marketId, at: new Date("2026-01-02T00:00:00Z") }),
      );

      const history = await store.priceHistory.listByMarket(marketId);
      expect(history.map((p) => p.at.toISOString())).toEqual([
        p1.at.toISOString(),
        p2.at.toISOString(),
      ]);

      const since = await store.priceHistory.listByMarket(marketId, {
        since: new Date("2026-01-02T00:00:00Z"),
      });
      expect(since).toHaveLength(1);
    });

    // -- invites ----------------------------------------------------------------

    it("invites: findByTokenHash, listByInvitee/Inviter, update", async () => {
      const store = makeStore();
      const inviter = brand<"UserId">(uid("user"));
      const invitee = brand<"UserId">(uid("user"));
      const invite = await store.invites.insert(
        makeInvite({ inviterId: inviter, inviteeId: invitee, tokenHash: "hash-1" }),
      );

      expect(await store.invites.findByTokenHash("hash-1")).toEqual(invite);
      expect((await store.invites.listByInviter(inviter)).map((i) => i.id)).toEqual([invite.id]);
      expect((await store.invites.listByInvitee(invitee)).map((i) => i.id)).toEqual([invite.id]);

      const updated = await store.invites.update(invite.id, { status: "accepted" });
      expect(updated.status).toBe("accepted");
    });

    // -- notifications ------------------------------------------------------

    it("notifications: listByUser unreadOnly, markRead, markAllRead", async () => {
      const store = makeStore();
      const userId = brand<"UserId">(uid("user"));
      const n1 = await store.notifications.insert(makeNotification({ userId }));
      const n2 = await store.notifications.insert(makeNotification({ userId }));

      expect(await store.notifications.listByUser(userId)).toHaveLength(2);
      expect(await store.notifications.listByUser(userId, { unreadOnly: true })).toHaveLength(2);

      await store.notifications.markRead(n1.id);
      expect(await store.notifications.listByUser(userId, { unreadOnly: true })).toHaveLength(1);

      await store.notifications.markAllRead(userId);
      expect(await store.notifications.listByUser(userId, { unreadOnly: true })).toHaveLength(0);
      void n2;
    });

    // -- messages: keyset pagination ------------------------------------------

    it("message keyset pagination is stable and non-overlapping across pages", async () => {
      const store = makeStore();
      const roomId = brand<"GroupId">(uid("room"));
      const total = 25;
      const inserted: Message[] = [];
      for (let i = 0; i < total; i++) {
        const msg = await store.messages.insert(
          makeMessage({
            roomId,
            id: brand(`msg_${String(i).padStart(3, "0")}`),
            at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          }),
        );
        inserted.push(msg);
      }

      const pageSize = 7;
      const pages: Message[][] = [];
      let cursor: { at: Date; id: string } | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await store.messages.listMessages(roomId, { before: cursor, limit: pageSize });
        if (page.length === 0) break;
        pages.push(page);
        const last = page[page.length - 1];
        cursor = { at: last.at, id: last.id };
      }

      const flattened = pages.flat();
      expect(flattened).toHaveLength(total);
      // No overlap: every id appears exactly once across all pages.
      const ids = flattened.map((m) => m.id);
      expect(new Set(ids).size).toBe(total);
      // Newest-first, globally: matches the reverse-insertion order.
      expect(ids).toEqual([...inserted].reverse().map((m) => m.id));
      // Every page itself is newest-first internally.
      for (const page of pages) {
        for (let i = 1; i < page.length; i++) {
          expect(page[i - 1].at.getTime()).toBeGreaterThanOrEqual(page[i].at.getTime());
        }
      }
    });

    it("message pagination pages remain stable and non-overlapping when new messages arrive mid-pagination", async () => {
      const store = makeStore();
      const roomId = brand<"GroupId">(uid("room"));
      for (let i = 0; i < 5; i++) {
        await store.messages.insert(
          makeMessage({
            roomId,
            id: brand(`orig_${i}`),
            at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          }),
        );
      }

      const firstPage = await store.messages.listMessages(roomId, { limit: 2 });
      expect(firstPage).toHaveLength(2);
      const cursor = { at: firstPage[1].at, id: firstPage[1].id };

      // New messages arrive, newer than everything seen so far.
      await store.messages.insert(
        makeMessage({ roomId, id: brand("new_1"), at: new Date(Date.UTC(2026, 0, 1, 1, 0, 0)) }),
      );

      const secondPage = await store.messages.listMessages(roomId, { before: cursor, limit: 10 });
      // The new message must NOT appear (it's newer than the cursor), and
      // nothing from firstPage should reappear.
      const firstIds = new Set(firstPage.map((m) => m.id));
      for (const m of secondPage) {
        expect(firstIds.has(m.id)).toBe(false);
        expect(m.id).not.toBe("new_1");
      }
      expect(secondPage).toHaveLength(3);
    });

    it("keyset pagination tie-breaks messages sharing an identical `at` by id, correctly across a page boundary", async () => {
      const store = makeStore();
      const roomId = brand<"GroupId">(uid("room"));
      const sameInstant = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
      const total = 6;
      for (let i = 0; i < total; i++) {
        await store.messages.insert(makeMessage({ roomId, id: brand(`tie_${i}`), at: sameInstant }));
      }

      // Ground truth: one unpaginated fetch of everything. Also confirms
      // this test is actually exercising the tie-break (all rows share one
      // timestamp), not accidentally falling back to time-ordering.
      const fullPage = await store.messages.listMessages(roomId, { limit: total });
      expect(fullPage).toHaveLength(total);
      expect(new Set(fullPage.map((m) => m.at.getTime())).size).toBe(1);
      const fullOrderIds = fullPage.map((m) => m.id);

      // Paginate in chunks smaller than the tied group, so at least one page
      // boundary falls strictly between two rows with the exact same `at`.
      const pageSize = 2;
      const pages: Message[][] = [];
      let cursor: { at: Date; id: string } | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await store.messages.listMessages(roomId, { before: cursor, limit: pageSize });
        if (page.length === 0) break;
        pages.push(page);
        const last = page[page.length - 1];
        cursor = { at: last.at, id: last.id };
      }

      const flattened = pages.flat();
      // No overlap, no skip.
      expect(new Set(flattened.map((m) => m.id)).size).toBe(total);
      expect(flattened).toHaveLength(total);
      // Paginating in chunks must reproduce EXACTLY the same order as one
      // unpaginated fetch. This is what actually pins the tie-break: if the
      // sort comparator and the cursor filter disagree on tie order (e.g.
      // one is ascending-by-id and the other descending), a tied row gets
      // either skipped or repeated and this equality fails even though the
      // "no overlap" / "no skip" checks above could still pass in some
      // inversions.
      expect(flattened.map((m) => m.id)).toEqual(fullOrderIds);
    });

    it("message insert is idempotent on (roomId, authorId, clientId)", async () => {
      const store = makeStore();
      const roomId = brand<"GroupId">(uid("room"));
      const authorId = brand<"UserId">(uid("user"));
      const first = await store.messages.insert(
        makeMessage({ roomId, authorId, clientId: "client-abc", body: "first attempt" }),
      );
      const retry = await store.messages.insert(
        makeMessage({
          roomId,
          authorId,
          clientId: "client-abc",
          body: "retried body — should be ignored",
          id: brand("a-different-id"),
        }),
      );

      expect(retry.id).toBe(first.id);
      expect(retry.body).toBe("first attempt");

      const page = await store.messages.listMessages(roomId, { limit: 10 });
      expect(page).toHaveLength(1);
    });

    // -- transact -------------------------------------------------------------

    it("transact commits all writes atomically on success", async () => {
      const store = makeStore();
      const user = await store.users.insert(makeUser({ balance: credits(100) }));
      let insertedGroupId: Group["id"] | undefined;

      await store.transact(async (tx) => {
        await tx.users.update(user.id, { balance: credits(200) });
        const group = await tx.groups.insert(makeGroup({ name: "committed group" }));
        insertedGroupId = group.id;
      });

      const fetchedUser = await store.users.findById(user.id);
      expect(fetchedUser?.balance).toBe(200);
      expect(insertedGroupId).toBeDefined();
      const fetchedGroup = await store.groups.findById(insertedGroupId as Group["id"]);
      expect(fetchedGroup?.name).toBe("committed group");
    });

    it("transact rolls back completely on throw — nothing partial is visible", async () => {
      const store = makeStore();
      const user = await store.users.insert(makeUser({ balance: credits(100) }));
      const groupBefore = await store.groups.insert(makeGroup());

      await expect(
        store.transact(async (tx) => {
          await tx.users.update(user.id, { balance: credits(999) });
          await tx.groups.update(groupBefore.id, { name: "should not stick" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      const fetchedUser = await store.users.findById(user.id);
      expect(fetchedUser?.balance).toBe(100);
      const fetchedGroup = await store.groups.findById(groupBefore.id);
      expect(fetchedGroup?.name).toBe(groupBefore.name);
    });

    it("a bare write to an UNTOUCHED table survives a concurrent transact's commit (per-key diff, not whole-map replace)", async () => {
      const store = makeStore();
      // Table A: users — this is what the in-flight transact reads and
      // writes. Table B: groups — the transact never touches this at all.
      const userA = await store.users.insert(makeUser({ balance: credits(100) }));
      const groupBefore = await store.groups.insert(makeGroup({ name: "original" }));

      // A gate the transact's callback parks on, and a signal it fires once
      // it has already read table A — i.e. once `transact` has definitely
      // already taken its internal snapshot (that happens before the
      // callback is even invoked), so anything the test does after
      // `await ready` is guaranteed to land strictly *inside* the window
      // between snapshot and commit, not before or after it.
      let releaseGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      let notifyReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        notifyReady = resolve;
      });

      const txPromise = store.transact(async (tx) => {
        const current = await tx.users.findById(userA.id); // read table A
        notifyReady();
        await gate; // pause here — the transact is now "in flight"
        const next = (current?.balance ?? 0) + 50;
        await tx.users.update(userA.id, { balance: credits(next) }); // write table A
      });

      await ready; // the transact's snapshot has definitely already been taken

      // A bare, non-transact write to a table the transact above never
      // touches, made while that transact is still in flight.
      await store.groups.update(groupBefore.id, { name: "bare write during transact" });

      releaseGate();
      await txPromise;

      const finalUser = await store.users.findById(userA.id);
      expect(finalUser?.balance).toBe(150);
      // This is the assertion that fails under a whole-map `Object.assign`
      // commit: the transact's own (stale) snapshot of `groups` clobbers
      // the bare write made while it was in flight, even though the
      // transact never touched `groups` at all.
      const finalGroup = await store.groups.findById(groupBefore.id);
      expect(finalGroup?.name).toBe("bare write during transact");
    });

    it("nested transact reuses the outer transaction rather than double-staging", async () => {
      const store = makeStore();
      const user = await store.users.insert(makeUser({ balance: credits(100) }));

      await store.transact(async (tx) => {
        await tx.users.update(user.id, { balance: credits(150) });
        await tx.transact(async (innerTx) => {
          // Inner transact must see the outer's uncommitted write.
          const seen = await innerTx.users.findById(user.id);
          expect(seen?.balance).toBe(150);
          await innerTx.users.update(user.id, { balance: credits(175) });
        });
        const afterInner = await tx.users.findById(user.id);
        expect(afterInner?.balance).toBe(175);
      });

      const final = await store.users.findById(user.id);
      expect(final?.balance).toBe(175);
    });

    it("a throw inside a nested transact rolls back the ENTIRE outer transaction too", async () => {
      const store = makeStore();
      const user = await store.users.insert(makeUser({ balance: credits(100) }));

      await expect(
        store.transact(async (tx) => {
          await tx.users.update(user.id, { balance: credits(150) });
          await tx.transact(async (innerTx) => {
            await innerTx.users.update(user.id, { balance: credits(999) });
            throw new Error("inner boom");
          });
        }),
      ).rejects.toThrow("inner boom");

      const final = await store.users.findById(user.id);
      expect(final?.balance).toBe(100);
    });

    it("concurrent-ish balance updates inside separate transacts don't interleave (no lost update)", async () => {
      const store = makeStore();
      const user = await store.users.insert(makeUser({ balance: credits(100) }));

      // Each transaction reads, yields (simulating async work / another
      // microtask getting a chance to run), then writes based on what it
      // read. If transactions interleaved, one increment would be lost.
      const bump = (amount: number) =>
        store.transact(async (tx) => {
          const current = await tx.users.findById(user.id);
          await Promise.resolve(); // yield a tick
          await Promise.resolve();
          const next = (current?.balance ?? 0) + amount;
          await tx.users.update(user.id, { balance: credits(next) });
        });

      await Promise.all([bump(10), bump(20), bump(30), bump(40)]);

      const final = await store.users.findById(user.id);
      expect(final?.balance).toBe(100 + 10 + 20 + 30 + 40);
    });
  });
}
