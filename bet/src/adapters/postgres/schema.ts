/**
 * Drizzle table definitions for the Postgres adapter — the opt-in
 * `DataStore` implementation selected when `DATABASE_URL` is set (D8).
 *
 * The shape is deliberately pragmatic rather than fully normalized:
 *
 * - **Money is `integer` cents**, matching `domain/money.ts`'s `Credits`
 *   (never `numeric`/`float`: a play-money ledger that rounds is worse than
 *   one that overflows at 21 million credits, which this app cannot reach).
 * - **Instants are `timestamptz`**, so `Date` round-trips without the
 *   adapter having to know the server's timezone.
 * - **`markets.outcomes` / `pricing` / `resolution` are `jsonb`.** They are
 *   read and written only as a whole market, never queried into, and
 *   `PricingConfig` is a three-armed discriminated union whose arms have
 *   disjoint columns — normalizing it would buy nothing and cost a join
 *   plus a three-table write on every trade. `resolution` embeds `Date`s,
 *   so it goes through an explicit encode/decode pair in `mappers.ts`
 *   rather than relying on JSON's lossy `Date` handling.
 * - **`groups.member_ids` is `text[]`**, mirroring `Group.memberIds`
 *   exactly, instead of a join table. Group membership is always read as
 *   "the whole group" and `listByMember` is a single `= ANY(...)`.
 * - **No foreign keys.** The `DataStore` contract (see
 *   `adapters/__tests__/data-store-contract.ts`) inserts positions, trades
 *   and messages that reference ids no other table holds, because the port
 *   promises nothing about referential integrity and the in-memory adapter
 *   enforces none. Adding FKs here would make the two adapters disagree —
 *   exactly the drift the shared contract suite exists to prevent.
 *
 * The runtime DDL lives in `ddl.ts` as plain SQL rather than being derived
 * from this file, so opening a database needs no `drizzle-kit` at runtime.
 * The two must be kept in step; every column below is exercised by
 * `drizzle-store.test.ts` against a real (PGlite) database, so a mismatch
 * fails the suite rather than production.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  Notification,
  Outcome,
  OutcomeId,
  PricingConfig,
} from "@/domain/entities";
import type { StoredResolution } from "./mappers";

/** Every instant in this schema is a `timestamptz` mapped to a JS `Date`. */
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    avatarColor: text("avatar_color").notNull(),
    avatarInitials: text("avatar_initials").notNull(),
    /** `Credits` — integer cents. */
    balance: integer("balance").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [index("users_handle_idx").on(t.handle)],
);

/** One row per pair, stored ordered so `user_a_id < user_b_id` always. */
export const friendships = pgTable(
  "friendships",
  {
    userAId: text("user_a_id").notNull(),
    userBId: text("user_b_id").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userAId, t.userBId] }),
    index("friendships_user_b_idx").on(t.userBId),
  ],
);

export const friendRequests = pgTable(
  "friend_requests",
  {
    id: text("id").primaryKey(),
    fromId: text("from_id").notNull(),
    toId: text("to_id").notNull(),
    status: text("status").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [
    index("friend_requests_to_idx").on(t.toId, t.status),
    index("friend_requests_from_idx").on(t.fromId, t.status),
  ],
);

export const groups = pgTable(
  "groups",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    emoji: text("emoji").notNull(),
    memberIds: text("member_ids").array().notNull(),
    ownerId: text("owner_id").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [index("groups_slug_idx").on(t.slug)],
);

export const markets = pgTable(
  "markets",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id"),
    creatorId: text("creator_id").notNull(),
    question: text("question").notNull(),
    resolutionCriteria: text("resolution_criteria").notNull(),
    resolutionSource: text("resolution_source"),
    closesAt: instant("closes_at").notNull(),
    status: text("status").notNull(),
    visibility: text("visibility").notNull(),
    pricing: jsonb("pricing").$type<PricingConfig>().notNull(),
    minStake: integer("min_stake").notNull(),
    maxStake: integer("max_stake").notNull(),
    stakesVisible: boolean("stakes_visible").notNull(),
    outcomes: jsonb("outcomes").$type<Outcome[]>().notNull(),
    resolution: jsonb("resolution").$type<StoredResolution>(),
    category: text("category"),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [
    index("markets_group_idx").on(t.groupId),
    index("markets_creator_idx").on(t.creatorId),
    index("markets_visibility_idx").on(t.visibility),
  ],
);

export const positions = pgTable(
  "positions",
  {
    id: text("id").primaryKey(),
    marketId: text("market_id").notNull(),
    outcomeId: text("outcome_id").notNull(),
    userId: text("user_id").notNull(),
    shares: doublePrecision("shares").notNull(),
    /** `Credits` — integer cents. */
    costBasis: integer("cost_basis").notNull(),
  },
  (t) => [
    uniqueIndex("positions_market_outcome_user_key").on(t.marketId, t.outcomeId, t.userId),
    index("positions_user_idx").on(t.userId),
  ],
);

export const trades = pgTable(
  "trades",
  {
    id: text("id").primaryKey(),
    marketId: text("market_id").notNull(),
    outcomeId: text("outcome_id").notNull(),
    userId: text("user_id").notNull(),
    side: text("side").notNull(),
    shares: doublePrecision("shares").notNull(),
    /** `Credits` — integer cents. */
    cost: integer("cost").notNull(),
    avgPrice: doublePrecision("avg_price").notNull(),
    /** `Credits` — integer cents. */
    fee: integer("fee").notNull(),
    at: instant("at").notNull(),
  },
  (t) => [index("trades_market_idx").on(t.marketId, t.at), index("trades_user_idx").on(t.userId, t.at)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    authorId: text("author_id"),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    clientId: text("client_id"),
    at: instant("at").notNull(),
  },
  (t) => [
    /** Exactly the keyset order `listMessages` pages in: `(at, id)` DESC. */
    index("messages_room_keyset_idx").on(t.roomId, t.at.desc(), t.id.desc()),
    index("messages_client_id_idx").on(t.roomId, t.clientId),
    /** Backstop for the idempotent-send check `MessageRepo.insert` does in
     * application code. `nullsNotDistinct` is what makes it cover system
     * messages, whose `author_id` is null. */
    uniqueIndex("messages_client_id_key")
      .on(t.roomId, t.authorId, t.clientId)
      .nullsNotDistinct()
      .where(sql`${t.clientId} is not null`),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    inviterId: text("inviter_id").notNull(),
    inviteeId: text("invitee_id"),
    tokenHash: text("token_hash"),
    status: text("status").notNull(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [
    index("invites_token_hash_idx").on(t.tokenHash),
    index("invites_inviter_idx").on(t.inviterId),
    index("invites_invitee_idx").on(t.inviteeId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Notification["payload"]>().notNull(),
    readAt: instant("read_at"),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt.desc())],
);

/** `PricePoint` has no id: identity is `(market_id, at)`. */
export const pricePoints = pgTable(
  "price_points",
  {
    marketId: text("market_id").notNull(),
    at: instant("at").notNull(),
    prices: jsonb("prices").$type<Record<OutcomeId, number>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.marketId, t.at] })],
);

export const schema = {
  users,
  friendships,
  friendRequests,
  groups,
  markets,
  positions,
  trades,
  messages,
  invites,
  notifications,
  pricePoints,
};

export type Schema = typeof schema;
