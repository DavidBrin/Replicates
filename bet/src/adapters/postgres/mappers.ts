/**
 * Row ↔ entity translation for the Postgres adapter.
 *
 * Three things have to be re-established on the way out of the database,
 * because SQL and `jsonb` each lose part of what the domain types carry:
 *
 * - **Branded ids.** `UserId`, `MarketId` and friends are `string` at
 *   runtime; `brand()` restores the compile-time brand a `text` column
 *   cannot carry.
 * - **`Credits`.** Integer-cent columns come back as plain `number`s;
 *   `credits()` re-brands them (and asserts they really are integers, which
 *   catches a column accidentally declared `numeric` at the first read).
 * - **`Date`s inside `jsonb`.** `Market.resolution` embeds four instants.
 *   `jsonb` stringifies them on the way in and hands back strings on the
 *   way out, so `resolution` is stored through the explicit
 *   {@link StoredResolution} shape and revived here. Top-level instants are
 *   `timestamptz` columns and need none of this — the driver returns real
 *   `Date`s.
 *
 * Absent optional fields are written as SQL `NULL` and read back as
 * `undefined` (the key omitted entirely), never as `null`: the in-memory
 * adapter and every consumer treat "no resolution source" as
 * `resolutionSource === undefined`, and `Notification.readAt === undefined`
 * is literally the definition of "unread" in `NotificationRepo`.
 */

import {
  brand,
  type FriendRequest,
  type FriendRequestStatus,
  type Friendship,
  type Group,
  type GroupId,
  type Invite,
  type InviteKind,
  type InviteStatus,
  type InviteTargetType,
  type Market,
  type MarketStatus,
  type MarketVisibility,
  type Message,
  type MessageKind,
  type Notification,
  type NotificationType,
  type OutcomeId,
  type Position,
  type PricePoint,
  type Resolution,
  type Trade,
  type TradeSide,
  type User,
  type UserId,
} from "@/domain/entities";
import { credits } from "@/domain/money";
import type {
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

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];
type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

/** `Resolution` with its four instants flattened to ISO strings, which is
 * the only lossless way to put it through a `jsonb` column. */
export type StoredResolution = {
  winningOutcomeId: string;
  proposedBy: string;
  proposedAt: string;
  finalizesAt: string;
  disputedBy?: string;
  disputedAt?: string;
  votes?: Record<string, string>;
  resolvedAt?: string;
};

export function encodeResolution(resolution: Resolution): StoredResolution {
  return {
    winningOutcomeId: resolution.winningOutcomeId,
    proposedBy: resolution.proposedBy,
    proposedAt: resolution.proposedAt.toISOString(),
    finalizesAt: resolution.finalizesAt.toISOString(),
    ...(resolution.disputedBy === undefined ? {} : { disputedBy: resolution.disputedBy }),
    ...(resolution.disputedAt === undefined
      ? {}
      : { disputedAt: resolution.disputedAt.toISOString() }),
    ...(resolution.votes === undefined ? {} : { votes: { ...resolution.votes } }),
    ...(resolution.resolvedAt === undefined
      ? {}
      : { resolvedAt: resolution.resolvedAt.toISOString() }),
  };
}

export function decodeResolution(stored: StoredResolution): Resolution {
  const votes = stored.votes
    ? (Object.fromEntries(
        Object.entries(stored.votes).map(([k, v]) => [k, brand<"OutcomeId">(v)]),
      ) as Record<UserId, OutcomeId>)
    : undefined;
  return {
    winningOutcomeId: brand(stored.winningOutcomeId),
    proposedBy: brand(stored.proposedBy),
    proposedAt: new Date(stored.proposedAt),
    finalizesAt: new Date(stored.finalizesAt),
    ...(stored.disputedBy === undefined ? {} : { disputedBy: brand<"UserId">(stored.disputedBy) }),
    ...(stored.disputedAt === undefined ? {} : { disputedAt: new Date(stored.disputedAt) }),
    ...(votes === undefined ? {} : { votes }),
    ...(stored.resolvedAt === undefined ? {} : { resolvedAt: new Date(stored.resolvedAt) }),
  };
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export function toUser(row: Row<typeof users>): User {
  return {
    id: brand(row.id),
    handle: row.handle,
    displayName: row.displayName,
    avatarColor: row.avatarColor,
    avatarInitials: row.avatarInitials,
    balance: credits(row.balance),
    createdAt: row.createdAt,
  };
}

export function fromUser(user: User): Insert<typeof users> {
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    avatarInitials: user.avatarInitials,
    balance: user.balance,
    createdAt: user.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Friendships / friend requests
// ---------------------------------------------------------------------------

export function toFriendship(row: Row<typeof friendships>): Friendship {
  return {
    userAId: brand(row.userAId),
    userBId: brand(row.userBId),
    createdAt: row.createdAt,
  };
}

export function fromFriendship(friendship: Friendship): Insert<typeof friendships> {
  return {
    userAId: friendship.userAId,
    userBId: friendship.userBId,
    createdAt: friendship.createdAt,
  };
}

export function toFriendRequest(row: Row<typeof friendRequests>): FriendRequest {
  return {
    id: brand(row.id),
    fromId: brand(row.fromId),
    toId: brand(row.toId),
    status: row.status as FriendRequestStatus,
    createdAt: row.createdAt,
  };
}

export function fromFriendRequest(request: FriendRequest): Insert<typeof friendRequests> {
  return {
    id: request.id,
    fromId: request.fromId,
    toId: request.toId,
    status: request.status,
    createdAt: request.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export function toGroup(row: Row<typeof groups>): Group {
  return {
    id: brand(row.id),
    slug: row.slug,
    name: row.name,
    emoji: row.emoji,
    memberIds: row.memberIds.map((id) => brand<"UserId">(id)),
    ownerId: brand(row.ownerId),
    createdAt: row.createdAt,
  };
}

export function fromGroup(group: Group): Insert<typeof groups> {
  return {
    id: group.id,
    slug: group.slug,
    name: group.name,
    emoji: group.emoji,
    memberIds: [...group.memberIds],
    ownerId: group.ownerId,
    createdAt: group.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export function toMarket(row: Row<typeof markets>): Market {
  return {
    id: brand(row.id),
    groupId: row.groupId === null ? null : brand<"GroupId">(row.groupId),
    creatorId: brand(row.creatorId),
    question: row.question,
    resolutionCriteria: row.resolutionCriteria,
    ...(row.resolutionSource === null ? {} : { resolutionSource: row.resolutionSource }),
    closesAt: row.closesAt,
    status: row.status as MarketStatus,
    visibility: row.visibility as MarketVisibility,
    pricing: row.pricing,
    minStake: credits(row.minStake),
    maxStake: credits(row.maxStake),
    stakesVisible: row.stakesVisible,
    outcomes: row.outcomes,
    createdAt: row.createdAt,
    ...(row.resolution === null ? {} : { resolution: decodeResolution(row.resolution) }),
    ...(row.category === null ? {} : { category: row.category }),
  };
}

export function fromMarket(market: Market): Insert<typeof markets> {
  return {
    id: market.id,
    groupId: market.groupId,
    creatorId: market.creatorId,
    question: market.question,
    resolutionCriteria: market.resolutionCriteria,
    resolutionSource: market.resolutionSource ?? null,
    closesAt: market.closesAt,
    status: market.status,
    visibility: market.visibility,
    pricing: market.pricing,
    minStake: market.minStake,
    maxStake: market.maxStake,
    stakesVisible: market.stakesVisible,
    outcomes: market.outcomes,
    resolution: market.resolution ? encodeResolution(market.resolution) : null,
    category: market.category ?? null,
    createdAt: market.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Position / trade / price point
// ---------------------------------------------------------------------------

export function toPosition(row: Row<typeof positions>): Position {
  return {
    id: brand(row.id),
    marketId: brand(row.marketId),
    outcomeId: brand(row.outcomeId),
    userId: brand(row.userId),
    shares: row.shares,
    costBasis: credits(row.costBasis),
  };
}

export function fromPosition(position: Position): Insert<typeof positions> {
  return {
    id: position.id,
    marketId: position.marketId,
    outcomeId: position.outcomeId,
    userId: position.userId,
    shares: position.shares,
    costBasis: position.costBasis,
  };
}

export function toTrade(row: Row<typeof trades>): Trade {
  return {
    id: brand(row.id),
    marketId: brand(row.marketId),
    outcomeId: brand(row.outcomeId),
    userId: brand(row.userId),
    side: row.side as TradeSide,
    shares: row.shares,
    cost: credits(row.cost),
    avgPrice: row.avgPrice,
    fee: credits(row.fee),
    at: row.at,
  };
}

export function fromTrade(trade: Trade): Insert<typeof trades> {
  return {
    id: trade.id,
    marketId: trade.marketId,
    outcomeId: trade.outcomeId,
    userId: trade.userId,
    side: trade.side,
    shares: trade.shares,
    cost: trade.cost,
    avgPrice: trade.avgPrice,
    fee: trade.fee,
    at: trade.at,
  };
}

export function toPricePoint(row: Row<typeof pricePoints>): PricePoint {
  return {
    marketId: brand(row.marketId),
    at: row.at,
    prices: row.prices,
  };
}

export function fromPricePoint(point: PricePoint): Insert<typeof pricePoints> {
  return {
    marketId: point.marketId,
    at: point.at,
    prices: { ...point.prices },
  };
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export function toMessage(row: Row<typeof messages>): Message {
  return {
    id: brand(row.id),
    roomId: brand<"GroupId">(row.roomId) as GroupId,
    authorId: row.authorId === null ? null : brand<"UserId">(row.authorId),
    kind: row.kind as MessageKind,
    body: row.body,
    ...(row.clientId === null ? {} : { clientId: row.clientId }),
    at: row.at,
  };
}

export function fromMessage(message: Message): Insert<typeof messages> {
  return {
    id: message.id,
    roomId: message.roomId,
    authorId: message.authorId,
    kind: message.kind,
    body: message.body,
    clientId: message.clientId ?? null,
    at: message.at,
  };
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

export function toInvite(row: Row<typeof invites>): Invite {
  return {
    id: brand(row.id),
    kind: row.kind as InviteKind,
    targetType: row.targetType as InviteTargetType,
    targetId: brand<"GroupId">(row.targetId),
    inviterId: brand(row.inviterId),
    ...(row.inviteeId === null ? {} : { inviteeId: brand<"UserId">(row.inviteeId) }),
    ...(row.tokenHash === null ? {} : { tokenHash: row.tokenHash }),
    status: row.status as InviteStatus,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export function fromInvite(invite: Invite): Insert<typeof invites> {
  return {
    id: invite.id,
    kind: invite.kind,
    targetType: invite.targetType,
    targetId: invite.targetId,
    inviterId: invite.inviterId,
    inviteeId: invite.inviteeId ?? null,
    tokenHash: invite.tokenHash ?? null,
    status: invite.status,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

export function toNotification(row: Row<typeof notifications>): Notification {
  return {
    id: brand(row.id),
    userId: brand(row.userId),
    type: row.type as NotificationType,
    payload: row.payload,
    ...(row.readAt === null ? {} : { readAt: row.readAt }),
    createdAt: row.createdAt,
  };
}

export function fromNotification(notification: Notification): Insert<typeof notifications> {
  return {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    payload: notification.payload,
    readAt: notification.readAt ?? null,
    createdAt: notification.createdAt,
  };
}
