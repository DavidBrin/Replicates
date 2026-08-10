/**
 * Storage port. One interface per aggregate, plus a `DataStore` that
 * aggregates them and provides `transact` for atomic multi-repo writes.
 *
 * Contract, binding on every adapter (in-memory now, a real DB later):
 * - All methods return `Promise`, even where an in-memory implementation
 *   could answer synchronously — callers must not assume synchronicity.
 * - Reads that can legitimately miss return `T | undefined`. They never
 *   throw for "not found." (Genuine failures, e.g. a broken adapter, may
 *   still throw.)
 * - Repos return domain entities directly, not `Result` — `Result` is for
 *   the use-case layer (later tasks), not storage.
 * - Every entity returned by a read is a defensive structural clone: a
 *   caller mutating the object it got back must never corrupt the store.
 * - `transact` stages a copy of the store, hands the callback a `DataStore`
 *   view backed by that staged copy, and commits atomically only if the
 *   callback resolves; any throw discards the staged copy entirely, leaving
 *   the outer store untouched. A `transact` call made from *inside* another
 *   transact's callback reuses the same outer staging layer rather than
 *   nesting a second one.
 */

import type {
  Friendship,
  FriendRequest,
  FriendRequestId,
  FriendRequestStatus,
  Group,
  GroupId,
  Invite,
  InviteId,
  Market,
  MarketId,
  Message,
  Notification,
  NotificationId,
  Position,
  PositionId,
  PricePoint,
  RoomId,
  Trade,
  TradeId,
  User,
  UserId,
} from "@/domain/entities";

// ---------------------------------------------------------------------------
// UserRepo
// ---------------------------------------------------------------------------

export interface UserRepo {
  findById(id: UserId): Promise<User | undefined>;
  findByHandle(handle: string): Promise<User | undefined>;
  /** Case-insensitive prefix search over `handle`, capped at `limit`
   * results, ordered by handle. Backs `GET /api/users/search?q=`. */
  searchByHandlePrefix(prefix: string, limit: number): Promise<User[]>;
  /** All users. Small-scale, in-memory-app-sized escape hatch for seeding
   * and admin/debug tooling — not part of any public API route. */
  list(): Promise<User[]>;
  insert(user: User): Promise<User>;
  update(id: UserId, patch: Partial<Omit<User, "id">>): Promise<User>;
}

// ---------------------------------------------------------------------------
// FriendRepo — friendships (symmetric, ordered-pair) + friend requests
// ---------------------------------------------------------------------------

export interface FriendRepo {
  /** Single ordered-pair lookup — O(1), never scans the full friend list. */
  areFriends(a: UserId, b: UserId): Promise<boolean>;
  /** Every friendship row involving `userId` (either side of the ordered
   * pair). Callers derive "the other user's id" per row. */
  listFriends(userId: UserId): Promise<Friendship[]>;
  /** Inserts the symmetric row. Callers (or the adapter) must order
   * `userAId < userBId` — the in-memory adapter enforces this regardless of
   * the order the caller passes fields in. */
  insertFriendship(friendship: Friendship): Promise<Friendship>;
  removeFriendship(a: UserId, b: UserId): Promise<void>;

  createRequest(request: FriendRequest): Promise<FriendRequest>;
  findRequestById(id: FriendRequestId): Promise<FriendRequest | undefined>;
  /** The live (`pending`) request from `fromId` to `toId`, if any — used to
   * detect simultaneous mutual requests (auto-accept case). */
  findPendingRequest(
    fromId: UserId,
    toId: UserId,
  ): Promise<FriendRequest | undefined>;
  listIncomingRequests(
    userId: UserId,
    status?: FriendRequestStatus,
  ): Promise<FriendRequest[]>;
  listOutgoingRequests(
    userId: UserId,
    status?: FriendRequestStatus,
  ): Promise<FriendRequest[]>;
  updateRequestStatus(
    id: FriendRequestId,
    status: FriendRequestStatus,
  ): Promise<FriendRequest>;
}

// ---------------------------------------------------------------------------
// GroupRepo
// ---------------------------------------------------------------------------

export interface GroupRepo {
  findById(id: GroupId): Promise<Group | undefined>;
  findBySlug(slug: string): Promise<Group | undefined>;
  listByMember(userId: UserId): Promise<Group[]>;
  insert(group: Group): Promise<Group>;
  update(id: GroupId, patch: Partial<Omit<Group, "id">>): Promise<Group>;
  addMember(id: GroupId, userId: UserId): Promise<Group>;
  removeMember(id: GroupId, userId: UserId): Promise<Group>;
}

// ---------------------------------------------------------------------------
// MarketRepo
// ---------------------------------------------------------------------------

export interface MarketRepo {
  findById(id: MarketId): Promise<Market | undefined>;
  listByGroup(groupId: GroupId): Promise<Market[]>;
  listByCreator(userId: UserId): Promise<Market[]>;
  /** `visibility === "public"` markets, for `GET /api/explore`. */
  listPublic(): Promise<Market[]>;
  insert(market: Market): Promise<Market>;
  update(id: MarketId, patch: Partial<Omit<Market, "id">>): Promise<Market>;
}

// ---------------------------------------------------------------------------
// PositionRepo
// ---------------------------------------------------------------------------

export interface PositionRepo {
  findById(id: PositionId): Promise<Position | undefined>;
  /** The single position row for this (market, outcome, user) triple, if
   * one exists — the row a trade execution reads-modifies-writes. */
  find(
    marketId: MarketId,
    outcomeId: Position["outcomeId"],
    userId: UserId,
  ): Promise<Position | undefined>;
  listByMarket(marketId: MarketId): Promise<Position[]>;
  listByUser(userId: UserId): Promise<Position[]>;
  insert(position: Position): Promise<Position>;
  update(
    id: PositionId,
    patch: Partial<Omit<Position, "id">>,
  ): Promise<Position>;
}

// ---------------------------------------------------------------------------
// TradeRepo
// ---------------------------------------------------------------------------

export interface TradeRepo {
  findById(id: TradeId): Promise<Trade | undefined>;
  listByMarket(marketId: MarketId): Promise<Trade[]>;
  listByUser(userId: UserId): Promise<Trade[]>;
  insert(trade: Trade): Promise<Trade>;
}

// ---------------------------------------------------------------------------
// MessageRepo
// ---------------------------------------------------------------------------

export type MessageCursor = { at: Date; id: string };

export interface MessagePageOptions {
  before?: MessageCursor;
  limit: number;
}

export interface MessageRepo {
  /** Newest-first, keyset-paginated. Stable and non-overlapping across pages
   * even as new messages arrive mid-pagination (the cursor seeks past a
   * fixed `(at, id)` point rather than an offset). */
  listMessages(
    roomId: RoomId,
    options: MessagePageOptions,
  ): Promise<Message[]>;
  findByClientId(
    roomId: RoomId,
    authorId: UserId | null,
    clientId: string,
  ): Promise<Message | undefined>;
  /** Idempotent on `(roomId, authorId, clientId)` when `clientId` is set: a
   * retry of the same client-generated send returns the original row
   * instead of inserting a duplicate. */
  insert(message: Message): Promise<Message>;
}

// ---------------------------------------------------------------------------
// InviteRepo
// ---------------------------------------------------------------------------

export interface InviteRepo {
  findById(id: InviteId): Promise<Invite | undefined>;
  findByTokenHash(tokenHash: string): Promise<Invite | undefined>;
  listByInvitee(userId: UserId): Promise<Invite[]>;
  listByInviter(userId: UserId): Promise<Invite[]>;
  insert(invite: Invite): Promise<Invite>;
  update(id: InviteId, patch: Partial<Omit<Invite, "id">>): Promise<Invite>;
}

// ---------------------------------------------------------------------------
// NotificationRepo
// ---------------------------------------------------------------------------

export interface NotificationRepo {
  findById(id: NotificationId): Promise<Notification | undefined>;
  listByUser(
    userId: UserId,
    options?: { unreadOnly?: boolean },
  ): Promise<Notification[]>;
  insert(notification: Notification): Promise<Notification>;
  markRead(id: NotificationId): Promise<Notification>;
  markAllRead(userId: UserId): Promise<void>;
}

// ---------------------------------------------------------------------------
// PriceHistoryRepo
// ---------------------------------------------------------------------------

export interface PriceHistoryRepo {
  /** Appends one price point. `PricePoint` has no id of its own — identity
   * is `(marketId, at)`. */
  append(point: PricePoint): Promise<PricePoint>;
  /** Chronological ascending, optionally only points at/after `since`. */
  listByMarket(marketId: MarketId, options?: { since?: Date }): Promise<PricePoint[]>;
}

// ---------------------------------------------------------------------------
// DataStore
// ---------------------------------------------------------------------------

export interface DataStore {
  readonly users: UserRepo;
  readonly friends: FriendRepo;
  readonly groups: GroupRepo;
  readonly markets: MarketRepo;
  readonly positions: PositionRepo;
  readonly trades: TradeRepo;
  readonly messages: MessageRepo;
  readonly invites: InviteRepo;
  readonly notifications: NotificationRepo;
  readonly priceHistory: PriceHistoryRepo;

  /**
   * Runs `fn` against a transactional view of this store. Commits atomically
   * if `fn`'s promise resolves; discards every staged write if it throws
   * (or rejects), and the rejection propagates to the caller. Calling
   * `transact` again from inside `fn` (on the `tx` it was handed) reuses the
   * same transaction rather than staging a second layer.
   */
  transact<T>(fn: (tx: DataStore) => Promise<T>): Promise<T>;
}
