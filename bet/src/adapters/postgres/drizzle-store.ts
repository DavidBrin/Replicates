/**
 * Postgres-backed `DataStore` (Drizzle + PGlite locally / Neon in prod).
 *
 * Selected when `DATABASE_URL` is set. Every repo method mirrors the
 * in-memory adapter's contract: missing reads return `undefined`, returned
 * entities are structural clones, duplicate inserts / missing updates throw,
 * and `transact` commits atomically (nested calls reuse the same tx).
 */

import { and, asc, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { DataStore } from "@/ports/data-store";
import type {
  FriendRequest,
  FriendRequestId,
  FriendRequestStatus,
  Friendship,
  Group,
  GroupId,
  Invite,
  InviteId,
  Market,
  MarketId,
  Message,
  Notification,
  NotificationId,
  OutcomeId,
  Position,
  PositionId,
  PricePoint,
  RoomId,
  Trade,
  TradeId,
  User,
  UserId,
} from "@/domain/entities";
import type { MessagePageOptions, MessageRepo } from "@/ports/data-store";
import {
  applySchema,
  detectDriver,
  openPostgres,
  type Db,
  type PostgresConnection,
} from "./client";
import {
  friendRequests,
  friendships,
  groups,
  invites,
  markets,
  messages,
  notifications,
  positions,
  pricePoints,
  trades,
  users,
} from "./schema";
import {
  fromFriendRequest,
  fromFriendship,
  fromGroup,
  fromInvite,
  fromMarket,
  fromMessage,
  fromNotification,
  fromPosition,
  fromPricePoint,
  fromTrade,
  fromUser,
  toFriendRequest,
  toFriendship,
  toGroup,
  toInvite,
  toMarket,
  toMessage,
  toNotification,
  toPosition,
  toPricePoint,
  toTrade,
  toUser,
} from "./mappers";

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

/** Postgres unique_violation (SQLSTATE 23505), including drizzle wrappers. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      (current as { code: unknown }).code === "23505"
    ) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }
  return false;
}

function orderFriendshipPair(
  a: UserId,
  b: UserId,
): { userAId: UserId; userBId: UserId } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

class PgUserRepo {
  constructor(private readonly db: Db) {}

  async findById(id: UserId): Promise<User | undefined> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? cloneJson(toUser(rows[0])) : undefined;
  }

  async findByHandle(handle: string): Promise<User | undefined> {
    const rows = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.handle}) = ${handle.toLowerCase()}`)
      .limit(1);
    return rows[0] ? cloneJson(toUser(rows[0])) : undefined;
  }

  async searchByHandlePrefix(prefix: string, limit: number): Promise<User[]> {
    const rows = await this.db
      .select()
      .from(users)
      .where(sql`${users.handle} ilike ${`${prefix}%`}`)
      .orderBy(asc(users.handle))
      .limit(limit);
    return rows.map((row) => cloneJson(toUser(row)));
  }

  async list(): Promise<User[]> {
    const rows = await this.db.select().from(users);
    return rows.map((row) => cloneJson(toUser(row)));
  }

  async insert(user: User): Promise<User> {
    const existing = await this.findById(user.id);
    if (existing) throw new Error(`User ${user.id} already exists`);
    await this.db.insert(users).values(fromUser(user));
    return cloneJson(user);
  }

  async update(id: UserId, patch: Partial<Omit<User, "id">>): Promise<User> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`User ${id} not found`);
    const updated: User = { ...existing, ...patch, id };
    await this.db
      .update(users)
      .set(fromUser(updated))
      .where(eq(users.id, id));
    return cloneJson(updated);
  }
}

class PgFriendRepo {
  constructor(private readonly db: Db) {}

  async areFriends(a: UserId, b: UserId): Promise<boolean> {
    const { userAId, userBId } = orderFriendshipPair(a, b);
    const rows = await this.db
      .select()
      .from(friendships)
      .where(and(eq(friendships.userAId, userAId), eq(friendships.userBId, userBId)))
      .limit(1);
    return rows.length > 0;
  }

  async listFriends(userId: UserId): Promise<Friendship[]> {
    const rows = await this.db
      .select()
      .from(friendships)
      .where(or(eq(friendships.userAId, userId), eq(friendships.userBId, userId)));
    return rows.map((row) => cloneJson(toFriendship(row)));
  }

  async insertFriendship(friendship: Friendship): Promise<Friendship> {
    const { userAId, userBId } = orderFriendshipPair(
      friendship.userAId,
      friendship.userBId,
    );
    if (await this.areFriends(userAId, userBId)) {
      throw new Error(`Friendship between ${userAId} and ${userBId} already exists`);
    }
    const ordered: Friendship = {
      userAId,
      userBId,
      createdAt: friendship.createdAt,
    };
    await this.db.insert(friendships).values(fromFriendship(ordered));
    return cloneJson(ordered);
  }

  async removeFriendship(a: UserId, b: UserId): Promise<void> {
    const { userAId, userBId } = orderFriendshipPair(a, b);
    await this.db
      .delete(friendships)
      .where(and(eq(friendships.userAId, userAId), eq(friendships.userBId, userBId)));
  }

  async createRequest(request: FriendRequest): Promise<FriendRequest> {
    const existing = await this.findRequestById(request.id);
    if (existing) throw new Error(`FriendRequest ${request.id} already exists`);
    await this.db.insert(friendRequests).values(fromFriendRequest(request));
    return cloneJson(request);
  }

  async findRequestById(id: FriendRequestId): Promise<FriendRequest | undefined> {
    const rows = await this.db
      .select()
      .from(friendRequests)
      .where(eq(friendRequests.id, id))
      .limit(1);
    return rows[0] ? cloneJson(toFriendRequest(rows[0])) : undefined;
  }

  async findPendingRequest(
    fromId: UserId,
    toId: UserId,
  ): Promise<FriendRequest | undefined> {
    const rows = await this.db
      .select()
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.fromId, fromId),
          eq(friendRequests.toId, toId),
          eq(friendRequests.status, "pending"),
        ),
      )
      .limit(1);
    return rows[0] ? cloneJson(toFriendRequest(rows[0])) : undefined;
  }

  async listIncomingRequests(
    userId: UserId,
    status?: FriendRequestStatus,
  ): Promise<FriendRequest[]> {
    const rows = await this.db
      .select()
      .from(friendRequests)
      .where(
        status
          ? and(eq(friendRequests.toId, userId), eq(friendRequests.status, status))
          : eq(friendRequests.toId, userId),
      );
    return rows.map((row) => cloneJson(toFriendRequest(row)));
  }

  async listOutgoingRequests(
    userId: UserId,
    status?: FriendRequestStatus,
  ): Promise<FriendRequest[]> {
    const rows = await this.db
      .select()
      .from(friendRequests)
      .where(
        status
          ? and(eq(friendRequests.fromId, userId), eq(friendRequests.status, status))
          : eq(friendRequests.fromId, userId),
      );
    return rows.map((row) => cloneJson(toFriendRequest(row)));
  }

  async updateRequestStatus(
    id: FriendRequestId,
    status: FriendRequestStatus,
  ): Promise<FriendRequest> {
    const existing = await this.findRequestById(id);
    if (!existing) throw new Error(`FriendRequest ${id} not found`);
    const updated: FriendRequest = { ...existing, status };
    await this.db
      .update(friendRequests)
      .set({ status })
      .where(eq(friendRequests.id, id));
    return cloneJson(updated);
  }
}

class PgGroupRepo {
  constructor(private readonly db: Db) {}

  async findById(id: GroupId): Promise<Group | undefined> {
    const rows = await this.db.select().from(groups).where(eq(groups.id, id)).limit(1);
    return rows[0] ? cloneJson(toGroup(rows[0])) : undefined;
  }

  async findBySlug(slug: string): Promise<Group | undefined> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(eq(groups.slug, slug))
      .limit(1);
    return rows[0] ? cloneJson(toGroup(rows[0])) : undefined;
  }

  async listByMember(userId: UserId): Promise<Group[]> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(sql`${userId} = any(${groups.memberIds})`);
    return rows.map((row) => cloneJson(toGroup(row)));
  }

  async insert(group: Group): Promise<Group> {
    const existing = await this.findById(group.id);
    if (existing) throw new Error(`Group ${group.id} already exists`);
    await this.db.insert(groups).values(fromGroup(group));
    return cloneJson(group);
  }

  async update(id: GroupId, patch: Partial<Omit<Group, "id">>): Promise<Group> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Group ${id} not found`);
    const updated: Group = { ...existing, ...patch, id };
    await this.db.update(groups).set(fromGroup(updated)).where(eq(groups.id, id));
    return cloneJson(updated);
  }

  async addMember(id: GroupId, userId: UserId): Promise<Group> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Group ${id} not found`);
    if (existing.memberIds.includes(userId)) return cloneJson(existing);
    return this.update(id, { memberIds: [...existing.memberIds, userId] });
  }

  async removeMember(id: GroupId, userId: UserId): Promise<Group> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Group ${id} not found`);
    return this.update(id, {
      memberIds: existing.memberIds.filter((m) => m !== userId),
    });
  }
}

class PgMarketRepo {
  constructor(private readonly db: Db) {}

  async findById(id: MarketId): Promise<Market | undefined> {
    const rows = await this.db.select().from(markets).where(eq(markets.id, id)).limit(1);
    return rows[0] ? cloneJson(toMarket(rows[0])) : undefined;
  }

  async listByGroup(groupId: GroupId): Promise<Market[]> {
    const rows = await this.db
      .select()
      .from(markets)
      .where(eq(markets.groupId, groupId));
    return rows.map((row) => cloneJson(toMarket(row)));
  }

  async listByCreator(userId: UserId): Promise<Market[]> {
    const rows = await this.db
      .select()
      .from(markets)
      .where(eq(markets.creatorId, userId));
    return rows.map((row) => cloneJson(toMarket(row)));
  }

  async listPublic(): Promise<Market[]> {
    const rows = await this.db
      .select()
      .from(markets)
      .where(eq(markets.visibility, "public"));
    return rows.map((row) => cloneJson(toMarket(row)));
  }

  async insert(market: Market): Promise<Market> {
    const existing = await this.findById(market.id);
    if (existing) throw new Error(`Market ${market.id} already exists`);
    await this.db.insert(markets).values(fromMarket(market));
    return cloneJson(market);
  }

  async update(id: MarketId, patch: Partial<Omit<Market, "id">>): Promise<Market> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Market ${id} not found`);
    const updated: Market = { ...existing, ...patch, id };
    await this.db.update(markets).set(fromMarket(updated)).where(eq(markets.id, id));
    return cloneJson(updated);
  }
}

class PgPositionRepo {
  constructor(private readonly db: Db) {}

  async findById(id: PositionId): Promise<Position | undefined> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(eq(positions.id, id))
      .limit(1);
    return rows[0] ? cloneJson(toPosition(rows[0])) : undefined;
  }

  async find(
    marketId: MarketId,
    outcomeId: OutcomeId,
    userId: UserId,
  ): Promise<Position | undefined> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.marketId, marketId),
          eq(positions.outcomeId, outcomeId),
          eq(positions.userId, userId),
        ),
      )
      .limit(1);
    return rows[0] ? cloneJson(toPosition(rows[0])) : undefined;
  }

  async listByMarket(marketId: MarketId): Promise<Position[]> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(eq(positions.marketId, marketId));
    return rows.map((row) => cloneJson(toPosition(row)));
  }

  async listByUser(userId: UserId): Promise<Position[]> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(eq(positions.userId, userId));
    return rows.map((row) => cloneJson(toPosition(row)));
  }

  async insert(position: Position): Promise<Position> {
    const existing = await this.findById(position.id);
    if (existing) throw new Error(`Position ${position.id} already exists`);
    await this.db.insert(positions).values(fromPosition(position));
    return cloneJson(position);
  }

  async update(
    id: PositionId,
    patch: Partial<Omit<Position, "id">>,
  ): Promise<Position> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Position ${id} not found`);
    const updated: Position = { ...existing, ...patch, id };
    await this.db
      .update(positions)
      .set(fromPosition(updated))
      .where(eq(positions.id, id));
    return cloneJson(updated);
  }
}

class PgTradeRepo {
  constructor(private readonly db: Db) {}

  async findById(id: TradeId): Promise<Trade | undefined> {
    const rows = await this.db.select().from(trades).where(eq(trades.id, id)).limit(1);
    return rows[0] ? cloneJson(toTrade(rows[0])) : undefined;
  }

  async listByMarket(marketId: MarketId): Promise<Trade[]> {
    const rows = await this.db
      .select()
      .from(trades)
      .where(eq(trades.marketId, marketId));
    return rows.map((row) => cloneJson(toTrade(row)));
  }

  async listByUser(userId: UserId): Promise<Trade[]> {
    const rows = await this.db
      .select()
      .from(trades)
      .where(eq(trades.userId, userId));
    return rows.map((row) => cloneJson(toTrade(row)));
  }

  async insert(trade: Trade): Promise<Trade> {
    const existing = await this.findById(trade.id);
    if (existing) throw new Error(`Trade ${trade.id} already exists`);
    await this.db.insert(trades).values(fromTrade(trade));
    return cloneJson(trade);
  }
}

class PgMessageRepo implements MessageRepo {
  constructor(private readonly db: Db) {}

  async listMessages(
    roomId: RoomId,
    options: MessagePageOptions,
  ): Promise<Message[]> {
    const keyset = options.before
      ? or(
          sql`${messages.at} < ${options.before.at}`,
          and(
            eq(messages.at, options.before.at),
            sql`${messages.id} < ${options.before.id}`,
          ),
        )
      : undefined;
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        keyset ? and(eq(messages.roomId, roomId), keyset) : eq(messages.roomId, roomId),
      )
      .orderBy(desc(messages.at), desc(messages.id))
      .limit(options.limit);
    return rows.map((row) => cloneJson(toMessage(row)));
  }

  async findByClientId(
    roomId: RoomId,
    authorId: UserId | null,
    clientId: string,
  ): Promise<Message | undefined> {
    const authorClause =
      authorId === null
        ? isNull(messages.authorId)
        : eq(messages.authorId, authorId);
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.roomId, roomId),
          authorClause,
          eq(messages.clientId, clientId),
        ),
      )
      .limit(1);
    return rows[0] ? cloneJson(toMessage(rows[0])) : undefined;
  }

  async insert(message: Message): Promise<Message> {
    if (message.clientId !== undefined) {
      const existing = await this.findByClientId(
        message.roomId,
        message.authorId,
        message.clientId,
      );
      if (existing) return existing;
    }
    const byId = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, message.id))
      .limit(1);
    if (byId[0]) throw new Error(`Message ${message.id} already exists`);
    try {
      await this.db.insert(messages).values(fromMessage(message));
    } catch (error) {
      // Concurrent idempotent send: lost the check-then-insert race; the
      // unique index on (room_id, author_id, client_id) fired. Return the
      // winner's row instead of surfacing 23505 to the client.
      if (
        message.clientId !== undefined &&
        isUniqueViolation(error)
      ) {
        const winner = await this.findByClientId(
          message.roomId,
          message.authorId,
          message.clientId,
        );
        if (winner) return winner;
      }
      throw error;
    }
    return cloneJson(message);
  }
}

class PgInviteRepo {
  constructor(private readonly db: Db) {}

  async findById(id: InviteId): Promise<Invite | undefined> {
    const rows = await this.db.select().from(invites).where(eq(invites.id, id)).limit(1);
    return rows[0] ? cloneJson(toInvite(rows[0])) : undefined;
  }

  async findByTokenHash(tokenHash: string): Promise<Invite | undefined> {
    const rows = await this.db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ? cloneJson(toInvite(rows[0])) : undefined;
  }

  async listByInvitee(userId: UserId): Promise<Invite[]> {
    const rows = await this.db
      .select()
      .from(invites)
      .where(eq(invites.inviteeId, userId));
    return rows.map((row) => cloneJson(toInvite(row)));
  }

  async listByInviter(userId: UserId): Promise<Invite[]> {
    const rows = await this.db
      .select()
      .from(invites)
      .where(eq(invites.inviterId, userId));
    return rows.map((row) => cloneJson(toInvite(row)));
  }

  async insert(invite: Invite): Promise<Invite> {
    const existing = await this.findById(invite.id);
    if (existing) throw new Error(`Invite ${invite.id} already exists`);
    await this.db.insert(invites).values(fromInvite(invite));
    return cloneJson(invite);
  }

  async update(id: InviteId, patch: Partial<Omit<Invite, "id">>): Promise<Invite> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Invite ${id} not found`);
    const updated: Invite = { ...existing, ...patch, id };
    await this.db.update(invites).set(fromInvite(updated)).where(eq(invites.id, id));
    return cloneJson(updated);
  }
}

class PgNotificationRepo {
  constructor(private readonly db: Db) {}

  async findById(id: NotificationId): Promise<Notification | undefined> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);
    return rows[0] ? cloneJson(toNotification(rows[0])) : undefined;
  }

  async listByUser(
    userId: UserId,
    options?: { unreadOnly?: boolean },
  ): Promise<Notification[]> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        options?.unreadOnly
          ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
          : eq(notifications.userId, userId),
      )
      .orderBy(desc(notifications.createdAt));
    return rows.map((row) => cloneJson(toNotification(row)));
  }

  async insert(notification: Notification): Promise<Notification> {
    const existing = await this.findById(notification.id);
    if (existing) throw new Error(`Notification ${notification.id} already exists`);
    await this.db.insert(notifications).values(fromNotification(notification));
    return cloneJson(notification);
  }

  async markRead(id: NotificationId): Promise<Notification> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Notification ${id} not found`);
    const updated: Notification = { ...existing, readAt: new Date() };
    await this.db
      .update(notifications)
      .set(fromNotification(updated))
      .where(eq(notifications.id, id));
    return cloneJson(updated);
  }

  async markAllRead(userId: UserId): Promise<void> {
    const now = new Date();
    await this.db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }
}

class PgPriceHistoryRepo {
  constructor(private readonly db: Db) {}

  async append(point: PricePoint): Promise<PricePoint> {
    await this.db.insert(pricePoints).values(fromPricePoint(point));
    return cloneJson(point);
  }

  async listByMarket(
    marketId: MarketId,
    options?: { since?: Date },
  ): Promise<PricePoint[]> {
    const rows = await this.db
      .select()
      .from(pricePoints)
      .where(
        options?.since
          ? and(
              eq(pricePoints.marketId, marketId),
              gte(pricePoints.at, options.since),
            )
          : eq(pricePoints.marketId, marketId),
      )
      .orderBy(asc(pricePoints.at));
    return rows.map((row) => cloneJson(toPricePoint(row)));
  }
}

function bindRepos(db: Db): Omit<DataStore, "transact"> {
  return {
    users: new PgUserRepo(db),
    friends: new PgFriendRepo(db),
    groups: new PgGroupRepo(db),
    markets: new PgMarketRepo(db),
    positions: new PgPositionRepo(db),
    trades: new PgTradeRepo(db),
    messages: new PgMessageRepo(db),
    invites: new PgInviteRepo(db),
    notifications: new PgNotificationRepo(db),
    priceHistory: new PgPriceHistoryRepo(db),
  };
}

class PostgresDataStore implements DataStore {
  readonly users: PgUserRepo;
  readonly friends: PgFriendRepo;
  readonly groups: PgGroupRepo;
  readonly markets: PgMarketRepo;
  readonly positions: PgPositionRepo;
  readonly trades: PgTradeRepo;
  readonly messages: PgMessageRepo;
  readonly invites: PgInviteRepo;
  readonly notifications: PgNotificationRepo;
  readonly priceHistory: PgPriceHistoryRepo;

  private readonly connection: PostgresConnection;
  private readonly rootDb: Db;
  private readonly isTransactional: boolean;
  /** Serializes root-level `transact` calls. PGlite (and a single Neon
   * Pool client in interactive transactions) cannot run overlapping
   * interactive transactions on one connection — without this mutex the
   * concurrent-balance contract case hangs forever. */
  private mutex: Promise<unknown> = Promise.resolve();

  constructor(connection: PostgresConnection, db: Db, isTransactional = false) {
    this.connection = connection;
    this.rootDb = db;
    this.isTransactional = isTransactional;
    const repos = bindRepos(db);
    this.users = repos.users as PgUserRepo;
    this.friends = repos.friends as PgFriendRepo;
    this.groups = repos.groups as PgGroupRepo;
    this.markets = repos.markets as PgMarketRepo;
    this.positions = repos.positions as PgPositionRepo;
    this.trades = repos.trades as PgTradeRepo;
    this.messages = repos.messages as PgMessageRepo;
    this.invites = repos.invites as PgInviteRepo;
    this.notifications = repos.notifications as PgNotificationRepo;
    this.priceHistory = repos.priceHistory as PgPriceHistoryRepo;
  }

  async transact<T>(fn: (tx: DataStore) => Promise<T>): Promise<T> {
    if (this.isTransactional) {
      return fn(this);
    }

    const run = () =>
      this.rootDb.transaction(async (txHandle) => {
        const txStore = new PostgresDataStore(
          this.connection,
          txHandle as unknown as Db,
          true,
        );
        return fn(txStore);
      });

    const scheduled = this.mutex.then(run, run);
    this.mutex = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  /** Test helper — close the underlying engine/pool. */
  async close(): Promise<void> {
    if (!this.isTransactional) {
      await this.connection.close();
    }
  }

  /** Test helper — wipe every table between contract cases. */
  async truncateForTests(): Promise<void> {
    const { truncateAll } = await import("./client");
    await truncateAll(this.connection.db);
  }
}

/**
 * Opens `url`, applies schema, and returns a ready `DataStore`.
 */
export async function createPostgresDataStore(url: string): Promise<DataStore> {
  const connection = await openPostgres(url);
  await applySchema(connection.db);
  return new PostgresDataStore(connection, connection.db);
}

export type PostgresTestStore = DataStore & {
  close(): Promise<void>;
  truncateForTests(): Promise<void>;
};

/** Same as {@link createPostgresDataStore}, plus test helpers. */
export async function createPostgresDataStoreForTests(
  url = "memory://",
): Promise<PostgresTestStore> {
  const connection = await openPostgres(url);
  await applySchema(connection.db);
  return new PostgresDataStore(connection, connection.db);
}

export { detectDriver, truncateAll } from "./client";
