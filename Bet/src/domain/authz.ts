/**
 * Authorization policy layer (docs/plan.md Task 4, G5). Implements the
 * matrix in research/social-and-invites.md §7.2 exactly.
 *
 * `can()` is pure: no I/O, no store access. Every fact it needs about
 * membership/ownership/state is precomputed by the caller (a route handler,
 * which *does* have I/O access) and passed in via `ctx`. This keeps the
 * policy testable with plain data and keeps route handlers the single place
 * that decides how membership facts are derived from storage.
 *
 * 404-vs-403 (D6, "ambiguity resolutions" in the Task 4 brief) is
 * deliberately NOT decided here — `can()` only returns a boolean. The
 * route layer (`src/lib/http.ts`'s `authorizeOr404`) decides whether a
 * denial should read as "not found" (existence-sensitive resources: market,
 * room, position, group) or "forbidden" (non-existence-sensitive: acting on
 * an invite you can already see). See that module's doc comment for the
 * full table.
 */

import type {
  GroupId,
  InviteId,
  MarketId,
  MarketStatus,
  PositionId,
  RoomId,
  UserId,
} from "./entities";

// ---------------------------------------------------------------------------
// Actor / Action / Resource
// ---------------------------------------------------------------------------

/** Who is asking. `anonymous` covers signed-out requests — every resource in
 * this app is private by default (research §7.1), so anonymous is denied
 * everywhere `can()` is consulted; public/no-auth surfaces (Explore, an
 * invite-link preview) intentionally never call `can()` at all. */
export type Actor = { userId: UserId } | { kind: "anonymous" };

export type Action = "read" | "write";

export type Resource =
  | { type: "market"; id: MarketId }
  | { type: "room"; id: RoomId }
  | { type: "position"; id: PositionId }
  | { type: "invite"; id: InviteId }
  | { type: "friendGraph"; ownerId: UserId }
  | { type: "group"; id: GroupId };

// ---------------------------------------------------------------------------
// Context — the membership facts each resource kind needs
// ---------------------------------------------------------------------------

export interface MarketAuthzFacts {
  creatorId: UserId;
  status: MarketStatus;
  /** A `market_participants` row exists for the caller. */
  isParticipant: boolean;
  /** A pending `invites` row targets the caller for this market. */
  hasPendingInvite: boolean;
}

export interface RoomAuthzFacts {
  /** Caller is a member of the room's scope — a group member (group room)
   * or a market participant/creator (market room). Resolved by the route
   * layer per research §5.1's `chat_channels(scope_type, scope_id)`. */
  isMember: boolean;
}

export interface PositionAuthzFacts {
  holderId: UserId;
  /** Caller holds a position in (or is the creator/participant of) the same
   * market as this position, i.e. a "fellow market_participant". */
  isFellowParticipant: boolean;
  /** `market.stakesVisible` — gates whether a fellow participant may view
   * this position's exact stake, never another user's by default. */
  stakesVisible: boolean;
  /** The owning market's status; a position is only writable while its
   * market is open (research §7.2: "only while market.status = 'open'"). */
  marketStatus: MarketStatus;
}

export interface InviteAuthzFacts {
  inviterId: UserId;
  /** Absent for an unredeemed link invite (research §3.2/§7.2: link-token
   * redemption is a separate code path keyed on token hash, not this
   * check). */
  inviteeId?: UserId;
}

/**
 * Facts for the `friendGraph` resource — research §7.2's "never a third
 * party" rule, expressed exactly as §7.3's reference `can()` does:
 * `resource.ownerId === ctx.actorId`.
 *
 * This same primitive covers every friend_requests/friendships mutation
 * from the matrix, not just "viewing my own friend list" — the union has no
 * separate `friendRequest` resource kind, so a route handler builds
 * `ownerId` to mean "the user-id whose authority this specific action
 * requires":
 *   - viewing a friend list -> ownerId = the list owner (never a third
 *     party can view, full stop)
 *   - cancelling a friend request -> ownerId = the request's `sender_id`
 *   - accepting/declining a friend request -> ownerId = the request's
 *     `recipient_id`
 *   - unfriending -> ownerId = either side's id (both parties own the
 *     symmetric row); the route picks whichever side is the current actor
 * The route handler, which has already loaded the request/friendship row,
 * is in the right place to pick the correct field — `can()` itself just
 * gatekeeps "is the caller that specific person."
 */
export interface FriendGraphAuthzFacts {
  ownerId: UserId;
}

export interface GroupAuthzFacts {
  ownerId: UserId;
  isMember: boolean;
}

/**
 * The full context `can()` needs, keyed by resource kind. A route handler
 * only ever populates the one field matching the `Resource` it's checking;
 * the rest stay `undefined`. Missing facts for the resource being checked
 * fail closed (denied), never throw — `can()` never throws.
 */
export interface AuthzContext {
  market?: MarketAuthzFacts;
  room?: RoomAuthzFacts;
  position?: PositionAuthzFacts;
  invite?: InviteAuthzFacts;
  friendGraph?: FriendGraphAuthzFacts;
  group?: GroupAuthzFacts;
}

// ---------------------------------------------------------------------------
// can()
// ---------------------------------------------------------------------------

function actorUserId(actor: Actor): UserId | null {
  return "userId" in actor ? actor.userId : null;
}

function canMarket(actorId: UserId | null, action: Action, facts: MarketAuthzFacts): boolean {
  if (actorId === null) return false;
  if (action === "write") {
    // "caller is creator (for edits pre-close); no one can edit after
    // closesAt" — modeled as: only the creator, and only while open.
    return facts.creatorId === actorId && facts.status === "open";
  }
  // read: creator, OR a participant, OR someone with a pending invite.
  return facts.creatorId === actorId || facts.isParticipant || facts.hasPendingInvite;
}

function canRoom(actorId: UserId | null, _action: Action, facts: RoomAuthzFacts): boolean {
  if (actorId === null) return false;
  // Read and write both require channel-scope membership. "any member can
  // post; sender_id must equal caller" is a payload check the route makes
  // directly (comparing the message's authorId to the actor), not a
  // membership fact — it needs no store lookup.
  return facts.isMember;
}

function canPosition(actorId: UserId | null, action: Action, facts: PositionAuthzFacts): boolean {
  if (actorId === null) return false;
  if (action === "write") {
    return facts.holderId === actorId && facts.marketStatus === "open";
  }
  if (facts.holderId === actorId) return true;
  return facts.isFellowParticipant && facts.stakesVisible;
}

function canInvite(actorId: UserId | null, _action: Action, facts: InviteAuthzFacts): boolean {
  if (actorId === null) return false;
  // Both read and write: inviter or invitee. The finer distinction ("only
  // the inviter may revoke, only the invitee may accept/decline") is a
  // specific-action check the route/service layer makes once it knows
  // which action was requested — can() only gatekeeps "are you a party to
  // this invite at all."
  return facts.inviterId === actorId || facts.inviteeId === actorId;
}

function canFriendGraph(
  actorId: UserId | null,
  _action: Action,
  facts: FriendGraphAuthzFacts,
): boolean {
  if (actorId === null) return false;
  return facts.ownerId === actorId;
}

function canGroup(actorId: UserId | null, action: Action, facts: GroupAuthzFacts): boolean {
  if (actorId === null) return false;
  if (action === "write") {
    return facts.ownerId === actorId;
  }
  return facts.isMember || facts.ownerId === actorId;
}

/**
 * The single authorization entry point (G5): every API route calls this
 * before reading or writing a resource. Pure and synchronous — no I/O.
 */
export function can(actor: Actor, action: Action, resource: Resource, ctx: AuthzContext): boolean {
  const actorId = actorUserId(actor);

  switch (resource.type) {
    case "market": {
      const facts = ctx.market;
      if (!facts) return false;
      return canMarket(actorId, action, facts);
    }
    case "room": {
      const facts = ctx.room;
      if (!facts) return false;
      return canRoom(actorId, action, facts);
    }
    case "position": {
      const facts = ctx.position;
      if (!facts) return false;
      return canPosition(actorId, action, facts);
    }
    case "invite": {
      const facts = ctx.invite;
      if (!facts) return false;
      return canInvite(actorId, action, facts);
    }
    case "friendGraph": {
      const facts = ctx.friendGraph;
      if (!facts) return false;
      return canFriendGraph(actorId, action, facts);
    }
    case "group": {
      const facts = ctx.group;
      if (!facts) return false;
      return canGroup(actorId, action, facts);
    }
  }
}
