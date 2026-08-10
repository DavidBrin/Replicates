/**
 * `POST /api/markets` — the create-bet wizard's submit (SPEC §3.4 step 5):
 * "writes market + outcomes + invites in one transaction and routes to the
 * new market." Everything below runs inside exactly one `store.transact`.
 */

import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { getActor, getContainer } from "@/lib/container";
import { authorizeOr404, handler, jsonOk, parseBody, throwApp } from "@/lib/http";
import { can } from "@/domain/authz";
import { brand, type Market, type Outcome, type OutcomeId, type PricingConfig } from "@/domain/entities";
import { fromDecimal, zero, type Credits } from "@/domain/money";
import { defaultB } from "@/domain/pricing/lmsr";

/** A small, fixed default palette for outcomes the wizard doesn't assign a
 * color to — the same documented accent ramp SPEC §7.1/§7.3 draws from
 * (Bet indigo, Polymarket blue/purple/teal/magenta, Kalshi orange/gold),
 * kept local rather than importing `adapters/memory/seed-data/palette.ts`
 * so market creation doesn't depend on seed-only data (G1 doesn't forbid
 * it — routes may import adapters — but the coupling has no upside here). */
const DEFAULT_OUTCOME_COLORS: readonly string[] = [
  "#7c6cff",
  "#4877ff",
  "#a261e1",
  "#0595b3",
  "#ff9500",
  "#ee2ba6",
  "#e5bd45",
  "#a394ff",
];

const outcomeInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  color: z.string().trim().min(1).max(20).optional(),
});

const pricingInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lmsr"),
    expectedParticipants: z.number().int().positive().max(500).optional(),
  }),
  z.object({
    kind: z.literal("fixedOdds"),
    /** Positional, matching `outcomes[]` by index — the client can't key
     * by outcome id yet, since outcomes are created in this same request. */
    openingPrices: z.array(z.number().positive().max(0.999)).min(2).max(8),
  }),
  z.object({
    kind: z.literal("parimutuel"),
    rakeBps: z.number().int().min(0).max(2000).optional(),
  }),
]);

const createMarketSchema = z.object({
  groupId: z.string().min(1),
  question: z.string().trim().min(1).max(140),
  resolutionCriteria: z.string().trim().min(20),
  resolutionSource: z.string().trim().max(200).optional(),
  closesAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "closesAt must be a valid date",
  }),
  outcomes: z.array(outcomeInputSchema).min(2).max(8),
  pricing: pricingInputSchema.default({ kind: "lmsr" }),
  minStake: z.number().positive().optional(),
  maxStake: z.number().positive().optional(),
  stakesVisible: z.boolean().optional(),
  feeBps: z.number().int().min(0).max(2000).optional(),
  inviteeIds: z.array(z.string().min(1)).max(50).optional(),
  createLinkInvite: z.boolean().optional(),
});

function randomToken(): string {
  return randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * `POST /api/markets { groupId, question, resolutionCriteria, closesAt,
 * outcomes, pricing?, minStake?, maxStake?, stakesVisible?, feeBps?,
 * inviteeIds?, createLinkInvite? }`
 *
 * Authorization: must be a member of `groupId` (a market always belongs
 * to a group in this app — public/`visibility: "public"` markets only
 * exist as Explore seed data, never created through this route).
 */
export const POST = handler(async (req) => {
  const actor = await getActor(req);
  const { store, clock, idGen } = await getContainer();
  const body = await parseBody(req, createMarketSchema);

  if (!("userId" in actor)) throwApp({ code: "forbidden", message: "Sign in required." });
  const creatorId = actor.userId;

  const groupId = brand<"GroupId">(body.groupId);
  const group = await store.groups.findById(groupId);
  if (!group) throwApp({ code: "not_found", message: "Group not found." });
  authorizeOr404(
    can(
      actor,
      "read",
      { type: "group", id: groupId },
      { group: { ownerId: group.ownerId, isMember: group.memberIds.includes(creatorId) } },
    ),
  );
  const resolvedGroup = group;

  if (body.pricing.kind === "fixedOdds" && body.pricing.openingPrices.length !== body.outcomes.length) {
    throwApp({
      code: "validation",
      message: "pricing.openingPrices must have exactly one entry per outcome.",
      fields: { "pricing.openingPrices": "length must match outcomes" },
    });
  }

  const now = clock.now();
  const closesAt = new Date(body.closesAt);
  if (closesAt.getTime() <= now.getTime()) {
    throwApp({
      code: "validation",
      message: "closesAt must be in the future.",
      fields: { closesAt: "must be in the future" },
    });
  }

  const feeBps = body.feeBps ?? 0;
  const minStake: Credits = body.minStake !== undefined ? fromDecimal(body.minStake) : fromDecimal(1);
  const maxStake: Credits = body.maxStake !== undefined ? fromDecimal(body.maxStake) : fromDecimal(500);

  const result = await store.transact(async (tx) => {
    const marketId = brand<"MarketId">(idGen.next("mkt"));
    const outcomes: Outcome[] = body.outcomes.map((o, i) => ({
      id: brand<"OutcomeId">(idGen.next("out")),
      marketId,
      label: o.label,
      color: o.color ?? DEFAULT_OUTCOME_COLORS[i % DEFAULT_OUTCOME_COLORS.length]!,
    }));

    let pricing: PricingConfig;
    switch (body.pricing.kind) {
      case "lmsr": {
        const b = defaultB(body.pricing.expectedParticipants ?? resolvedGroup.memberIds.length);
        const q: Record<OutcomeId, number> = {};
        outcomes.forEach((o) => {
          q[o.id] = 0;
        });
        pricing = { kind: "lmsr", b, feeBps, q };
        break;
      }
      case "fixedOdds": {
        const raw = body.pricing.openingPrices;
        const total = raw.reduce((sum, p) => sum + p, 0);
        const openingPrices: Record<OutcomeId, number> = {};
        const escrow: Record<OutcomeId, Credits> = {};
        outcomes.forEach((o, i) => {
          openingPrices[o.id] = raw[i]! / total;
          escrow[o.id] = zero();
        });
        pricing = { kind: "fixedOdds", feeBps, openingPrices, escrow };
        break;
      }
      case "parimutuel": {
        const pools: Record<OutcomeId, Credits> = {};
        outcomes.forEach((o) => {
          pools[o.id] = zero();
        });
        pricing = { kind: "parimutuel", feeBps, rakeBps: body.pricing.rakeBps ?? 0, pools };
        break;
      }
    }

    const market: Market = {
      id: marketId,
      groupId: resolvedGroup.id,
      creatorId,
      question: body.question,
      resolutionCriteria: body.resolutionCriteria,
      resolutionSource: body.resolutionSource,
      closesAt,
      status: "open",
      visibility: "group",
      pricing,
      minStake,
      maxStake,
      stakesVisible: body.stakesVisible ?? true,
      outcomes,
      createdAt: now,
    };
    await tx.markets.insert(market);
    await tx.messages.insert({
      id: brand(idGen.next("msg")),
      roomId: marketId,
      authorId: null,
      kind: "system",
      body: `${resolvedGroup.name} — "${market.question}" is open for trading.`,
      at: now,
    });

    for (const inviteeIdRaw of body.inviteeIds ?? []) {
      const inviteeId = brand<"UserId">(inviteeIdRaw);
      if (inviteeId === creatorId) continue;
      const areFriends = await tx.friends.areFriends(creatorId, inviteeId);
      if (!areFriends) {
        throwApp({
          code: "validation",
          message: "You can only invite friends to a bet directly — use a link invite otherwise.",
          fields: { inviteeIds: "must all be friends" },
        });
      }
      await tx.invites.insert({
        id: brand(idGen.next("inv")),
        kind: "direct",
        targetType: "market",
        targetId: marketId,
        inviterId: creatorId,
        inviteeId,
        status: "sent",
        expiresAt: new Date(now.getTime() + 7 * 86_400_000),
        createdAt: now,
      });
      await tx.notifications.insert({
        id: brand(idGen.next("ntf")),
        userId: inviteeId,
        type: "bet_invite_received",
        payload: { marketId, question: market.question },
        createdAt: now,
      });
    }

    let inviteLink: { token: string; expiresAt: string } | undefined;
    if (body.createLinkInvite) {
      const token = randomToken();
      const expiresAt = new Date(now.getTime() + 7 * 86_400_000);
      await tx.invites.insert({
        id: brand(idGen.next("inv")),
        kind: "link",
        targetType: "market",
        targetId: marketId,
        inviterId: creatorId,
        tokenHash: hashToken(token),
        status: "created",
        expiresAt,
        createdAt: now,
      });
      inviteLink = { token, expiresAt: expiresAt.toISOString() };
    }

    return { market, inviteLink };
  });

  return jsonOk(result, { status: 201 });
});
