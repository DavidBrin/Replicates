/**
 * Domain entities — every type from SPEC.md §4, using exactly those field
 * names. Plain types plus (elsewhere) pure functions; no classes for
 * entities, per docs/plan.md Task 3 instructions.
 *
 * Ids are branded string types so e.g. a `MarketId` can never be passed
 * where a `UserId` is expected, even though both are plain strings at
 * runtime. The brand is structural (`string & { readonly __brand: B }`),
 * not nominal via `unique symbol`, so a branded id stays assignable to
 * `string` and to any other module's independently-declared `{ ... :
 * string }`-shaped structural types (see Task 2's `Position`).
 */

import type { Credits } from "./money";

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

export type Id<Brand extends string> = string & { readonly __brand: Brand };

/** Constructs a branded id from a raw string. Does not validate format or
 * uniqueness — that's the caller's (or an `IdGen`'s) job. */
export function brand<Brand extends string>(s: string): Id<Brand> {
  return s as Id<Brand>;
}

export type UserId = Id<"UserId">;
export type FriendRequestId = Id<"FriendRequestId">;
export type GroupId = Id<"GroupId">;
export type MarketId = Id<"MarketId">;
export type OutcomeId = Id<"OutcomeId">;
export type PositionId = Id<"PositionId">;
export type TradeId = Id<"TradeId">;
export type MessageId = Id<"MessageId">;
export type InviteId = Id<"InviteId">;
export type NotificationId = Id<"NotificationId">;

/**
 * A chat room is scoped 1:1 to either a group or a market (research/
 * social-and-invites.md §5.1's `chat_channels(scope_type, scope_id)`, folded
 * down to "the scope id itself is the room id" since Task 3's brief lists no
 * separate `ChannelRepo`/`Room` entity). Callers pass a `GroupId` or a
 * `MarketId` directly wherever a `RoomId` is expected.
 */
export type RoomId = GroupId | MarketId;

// ---------------------------------------------------------------------------
// User / social graph
// ---------------------------------------------------------------------------

export type User = {
  id: UserId;
  handle: string;
  displayName: string;
  avatarColor: string;
  avatarInitials: string;
  balance: Credits;
  createdAt: Date;
};

/** Symmetric friendship, stored ordered: `userAId < userBId` lexicographically
 * (research/social-and-invites.md §1.4), so a pair has exactly one row. */
export type Friendship = {
  userAId: UserId;
  userBId: UserId;
  createdAt: Date;
};

export type FriendRequestStatus = "pending" | "accepted" | "declined" | "cancelled";

export type FriendRequest = {
  id: FriendRequestId;
  fromId: UserId;
  toId: UserId;
  status: FriendRequestStatus;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export type Group = {
  id: GroupId;
  slug: string;
  name: string;
  emoji: string;
  memberIds: UserId[];
  ownerId: UserId;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

/**
 * SPEC §4's market status machine: `open → closed → resolving →
 * (disputed →) resolved`, plus `cancelled` from any pre-resolved state. The
 * legal-transition table lives in `market-state.ts`.
 */
export type MarketStatus =
  | "open"
  | "closed"
  | "resolving"
  | "disputed"
  | "resolved"
  | "cancelled";

export type MarketVisibility = "private" | "group" | "public";

/**
 * Per-market pricing configuration, selected by `pricing.kind` and resolved
 * through Task 2's registry (`market.pricing.kind`, per DECISIONS.md D3).
 *
 * Deliberately declared locally rather than imported from
 * `src/domain/pricing/types.ts`: that module is Task 2's exclusive territory
 * (built concurrently, may not exist yet at any given moment while both
 * tasks run), and importing a type from it here would make Task 3's own
 * typecheck/test run non-deterministic depending on Task 2's progress. The
 * shape below mirrors Task 2's brief (`{kind:"lmsr"; b; q}` |
 * `{kind:"fixedOdds"; openingPrices; escrow}` |
 * `{kind:"parimutuel"; rakeBps; pools}`) plus a `feeBps` every kind carries
 * (SPEC §6.3 / DECISIONS D3: "a market's `feeBps` of 0 disables fees").
 * Task 4 (composition root) is expected to treat these as interchangeable
 * when wiring the pricing registry against stored markets.
 */
export type PricingConfig =
  | { kind: "lmsr"; b: number; feeBps: number; q: Record<OutcomeId, number> }
  | {
      kind: "fixedOdds";
      feeBps: number;
      openingPrices: Record<OutcomeId, number>;
      escrow: Record<OutcomeId, Credits>;
    }
  | {
      kind: "parimutuel";
      feeBps: number;
      rakeBps: number;
      pools: Record<OutcomeId, Credits>;
    };

/**
 * A market's resolution lifecycle (SPEC §6.4): creator proposes a winning
 * outcome, a 12h dispute window opens, and the market either auto-finalizes
 * unchallenged or escalates to a quorum vote of position holders on dispute.
 * Field shapes are this task's own design (SPEC only declares
 * `resolution?: Resolution` without enumerating fields).
 */
export type Resolution = {
  winningOutcomeId: OutcomeId;
  proposedBy: UserId;
  proposedAt: Date;
  /** `proposedAt` + 12h; auto-finalize deadline if unchallenged. */
  finalizesAt: Date;
  disputedBy?: UserId;
  disputedAt?: Date;
  /** Quorum vote among position holders, keyed by voter. */
  votes?: Record<UserId, OutcomeId>;
  resolvedAt?: Date;
};

export type Outcome = {
  id: OutcomeId;
  marketId: MarketId;
  label: string;
  description?: string;
  color: string;
};

export type Market = {
  id: MarketId;
  groupId: GroupId | null;
  creatorId: UserId;
  question: string;
  resolutionCriteria: string;
  resolutionSource?: string;
  closesAt: Date;
  status: MarketStatus;
  visibility: MarketVisibility;
  pricing: PricingConfig;
  minStake: Credits;
  maxStake: Credits;
  stakesVisible: boolean;
  outcomes: Outcome[];
  createdAt: Date;
  resolution?: Resolution;
};

// ---------------------------------------------------------------------------
// Positions / trades / price history
// ---------------------------------------------------------------------------

/**
 * Must stay structurally assignable to Task 2's pricing-engine `Position`
 * (`{ userId: string; outcomeId: string; shares: number; costBasis: Credits
 * }`) so the pricing engines accept these entities directly — same field
 * names, and `UserId`/`OutcomeId` are branded strings (subtypes of
 * `string`), `Credits` is the identical type from `./money`.
 */
export type Position = {
  id: PositionId;
  marketId: MarketId;
  outcomeId: OutcomeId;
  userId: UserId;
  shares: number;
  costBasis: Credits;
};

export type TradeSide = "buy" | "sell";

export type Trade = {
  id: TradeId;
  marketId: MarketId;
  outcomeId: OutcomeId;
  userId: UserId;
  side: TradeSide;
  shares: number;
  cost: Credits;
  avgPrice: number;
  fee: Credits;
  at: Date;
};

export type PricePoint = {
  marketId: MarketId;
  at: Date;
  prices: Record<OutcomeId, number>;
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type MessageKind = "text" | "system";

export type Message = {
  id: MessageId;
  roomId: RoomId;
  authorId: UserId | null;
  kind: MessageKind;
  body: string;
  clientId?: string;
  at: Date;
};

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export type InviteKind = "direct" | "link";
export type InviteTargetType = "group" | "market";

/**
 * State machine per research/social-and-invites.md §3.3:
 * created → sent → viewed → accepted|declined, with expired/revoked reachable
 * from any non-terminal state.
 */
export type InviteStatus =
  | "created"
  | "sent"
  | "viewed"
  | "accepted"
  | "declined"
  | "expired"
  | "revoked";

export type Invite = {
  id: InviteId;
  kind: InviteKind;
  targetType: InviteTargetType;
  targetId: GroupId | MarketId;
  inviterId: UserId;
  inviteeId?: UserId;
  tokenHash?: string;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** research/social-and-invites.md §6.1's `type` enum. */
export type NotificationType =
  | "friend_request_received"
  | "friend_request_accepted"
  | "bet_invite_received"
  | "bet_invite_accepted"
  | "market_resolved"
  | "market_closing_soon"
  | "chat_message"
  | "chat_mention";

export type Notification = {
  id: NotificationId;
  userId: UserId;
  type: NotificationType;
  payload: Record<string, unknown>;
  readAt?: Date;
  createdAt: Date;
};
