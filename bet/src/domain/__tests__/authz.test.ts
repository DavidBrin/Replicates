import { describe, expect, it } from "vitest";
import { brand } from "@/domain/entities";
import { can, type Actor, type AuthzContext } from "@/domain/authz";

const owner = { userId: brand<"UserId">("usr_owner") };
const member = { userId: brand<"UserId">("usr_member") };
const invitee = { userId: brand<"UserId">("usr_invitee") };
const stranger = { userId: brand<"UserId">("usr_stranger") };
const anonymous: Actor = { kind: "anonymous" };

describe("authz.can() — research/social-and-invites.md §7.2 matrix", () => {
  // -------------------------------------------------------------------
  // market
  // -------------------------------------------------------------------
  describe("market", () => {
    const resource = { type: "market" as const, id: brand<"MarketId">("mkt_1") };
    const openMarketCtx = (over: Partial<AuthzContext["market"]> = {}): AuthzContext => ({
      market: {
        creatorId: owner.userId,
        status: "open",
        isParticipant: false,
        hasPendingInvite: false,
        ...over,
      },
    });

    it("owner (creator) can read", () => {
      expect(can(owner, "read", resource, openMarketCtx())).toBe(true);
    });
    it("owner (creator) can write while open", () => {
      expect(can(owner, "write", resource, openMarketCtx())).toBe(true);
    });
    it("owner cannot write once closed", () => {
      expect(can(owner, "write", resource, openMarketCtx({ status: "closed" }))).toBe(false);
    });

    it("member (participant) can read", () => {
      expect(can(member, "read", resource, openMarketCtx({ isParticipant: true }))).toBe(true);
    });
    it("member (participant) cannot write — not the creator", () => {
      expect(can(member, "write", resource, openMarketCtx({ isParticipant: true }))).toBe(false);
    });

    it("invitee (pending invite) can read", () => {
      expect(can(invitee, "read", resource, openMarketCtx({ hasPendingInvite: true }))).toBe(
        true,
      );
    });
    it("invitee cannot write", () => {
      expect(can(invitee, "write", resource, openMarketCtx({ hasPendingInvite: true }))).toBe(
        false,
      );
    });

    it("stranger cannot read", () => {
      expect(can(stranger, "read", resource, openMarketCtx())).toBe(false);
    });
    it("stranger cannot write", () => {
      expect(can(stranger, "write", resource, openMarketCtx())).toBe(false);
    });

    it("anonymous cannot read", () => {
      expect(can(anonymous, "read", resource, openMarketCtx())).toBe(false);
    });
    it("anonymous cannot write", () => {
      expect(can(anonymous, "write", resource, openMarketCtx())).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // room
  // -------------------------------------------------------------------
  describe("room", () => {
    const resource = { type: "room" as const, id: brand<"MarketId">("mkt_1") };
    const memberCtx: AuthzContext = { room: { isMember: true } };
    const nonMemberCtx: AuthzContext = { room: { isMember: false } };

    it("member can read", () => {
      expect(can(member, "read", resource, memberCtx)).toBe(true);
    });
    it("member can write (post a message)", () => {
      expect(can(member, "write", resource, memberCtx)).toBe(true);
    });
    it("stranger (non-member) cannot read", () => {
      expect(can(stranger, "read", resource, nonMemberCtx)).toBe(false);
    });
    it("stranger (non-member) cannot write", () => {
      expect(can(stranger, "write", resource, nonMemberCtx)).toBe(false);
    });
    it("anonymous cannot read even a room the ctx marks as a member", () => {
      // Defense in depth: an anonymous actor is always denied regardless of
      // what membership facts a caller mistakenly supplies.
      expect(can(anonymous, "read", resource, memberCtx)).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // position
  // -------------------------------------------------------------------
  describe("position", () => {
    const resource = { type: "position" as const, id: brand<"PositionId">("pos_1") };
    const holder = owner;
    const ctx = (over: Partial<AuthzContext["position"]> = {}): AuthzContext => ({
      position: {
        holderId: holder.userId,
        isFellowParticipant: false,
        stakesVisible: false,
        marketStatus: "open",
        ...over,
      },
    });

    it("owner (the position holder) can read", () => {
      expect(can(holder, "read", resource, ctx())).toBe(true);
    });
    it("owner (the position holder) can write while the market is open", () => {
      expect(can(holder, "write", resource, ctx())).toBe(true);
    });
    it("owner cannot write once the market is no longer open", () => {
      expect(can(holder, "write", resource, ctx({ marketStatus: "closed" }))).toBe(false);
    });

    it("member (fellow participant) can read only when stakesVisible", () => {
      expect(
        can(member, "read", resource, ctx({ isFellowParticipant: true, stakesVisible: true })),
      ).toBe(true);
    });
    it("member (fellow participant) cannot read when stakesVisible is off", () => {
      expect(
        can(member, "read", resource, ctx({ isFellowParticipant: true, stakesVisible: false })),
      ).toBe(false);
    });
    it("member (fellow participant) can never write someone else's position", () => {
      expect(
        can(member, "write", resource, ctx({ isFellowParticipant: true, stakesVisible: true })),
      ).toBe(false);
    });

    it("stranger cannot read even with stakesVisible on (must be a fellow participant)", () => {
      expect(can(stranger, "read", resource, ctx({ stakesVisible: true }))).toBe(false);
    });

    it("anonymous cannot read", () => {
      expect(can(anonymous, "read", resource, ctx({ stakesVisible: true }))).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // invite
  // -------------------------------------------------------------------
  describe("invite", () => {
    const resource = { type: "invite" as const, id: brand<"InviteId">("inv_1") };
    const ctx: AuthzContext = { invite: { inviterId: owner.userId, inviteeId: invitee.userId } };

    it("owner (inviter) can read", () => {
      expect(can(owner, "read", resource, ctx)).toBe(true);
    });
    it("owner (inviter) can write (revoke)", () => {
      expect(can(owner, "write", resource, ctx)).toBe(true);
    });
    it("invitee can read", () => {
      expect(can(invitee, "read", resource, ctx)).toBe(true);
    });
    it("invitee can write (accept/decline)", () => {
      expect(can(invitee, "write", resource, ctx)).toBe(true);
    });
    it("stranger cannot read", () => {
      expect(can(stranger, "read", resource, ctx)).toBe(false);
    });
    it("stranger cannot write", () => {
      expect(can(stranger, "write", resource, ctx)).toBe(false);
    });
    it("anonymous cannot read", () => {
      expect(can(anonymous, "read", resource, ctx)).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // friendGraph
  // -------------------------------------------------------------------
  describe("friendGraph", () => {
    const resource = { type: "friendGraph" as const, ownerId: owner.userId };
    const ctx: AuthzContext = { friendGraph: { ownerId: owner.userId } };

    it("owner can read their own graph", () => {
      expect(can(owner, "read", resource, ctx)).toBe(true);
    });
    it("owner can write (send/cancel/accept/decline against their own graph)", () => {
      expect(can(owner, "write", resource, ctx)).toBe(true);
    });
    it("stranger (any third party) cannot read — never enumerable, §1.6", () => {
      expect(can(stranger, "read", resource, ctx)).toBe(false);
    });
    it("stranger cannot write", () => {
      expect(can(stranger, "write", resource, ctx)).toBe(false);
    });
    it("anonymous cannot read", () => {
      expect(can(anonymous, "read", resource, ctx)).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // group
  // -------------------------------------------------------------------
  describe("group", () => {
    const resource = { type: "group" as const, id: brand<"GroupId">("grp_1") };
    const ctx = (over: Partial<AuthzContext["group"]> = {}): AuthzContext => ({
      group: { ownerId: owner.userId, isMember: false, ...over },
    });

    it("owner can read", () => {
      expect(can(owner, "read", resource, ctx({ isMember: true }))).toBe(true);
    });
    it("owner can write", () => {
      expect(can(owner, "write", resource, ctx({ isMember: true }))).toBe(true);
    });
    it("member (non-owner) can read", () => {
      expect(can(member, "read", resource, ctx({ isMember: true }))).toBe(true);
    });
    it("member (non-owner) cannot write", () => {
      expect(can(member, "write", resource, ctx({ isMember: true }))).toBe(false);
    });
    it("stranger (non-member) cannot read — 404-not-403, membership gates every read", () => {
      expect(can(stranger, "read", resource, ctx())).toBe(false);
    });
    it("stranger cannot write", () => {
      expect(can(stranger, "write", resource, ctx())).toBe(false);
    });
    it("anonymous cannot read", () => {
      expect(can(anonymous, "read", resource, ctx())).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // Missing facts fail closed rather than throwing
  // -------------------------------------------------------------------
  it("denies (never throws) when the matching ctx facts are absent", () => {
    const resource = { type: "market" as const, id: brand<"MarketId">("mkt_missing") };
    expect(() => can(owner, "read", resource, {})).not.toThrow();
    expect(can(owner, "read", resource, {})).toBe(false);
  });
});
