/**
 * The tier table (SPEC §4.13, D28, D29, D31, D63).
 *
 * Difficulty selects **which characters you might face plus the competence caps**, not a single
 * smartness slider — SMG's own support article says difficulty is "a mixture of various personas"
 * and that "some personas are restricted to certain difficulties". Each tier *adds*; nothing is
 * removed. Beginner is interpolated below Easy ([ours]).
 *
 * The tier always wins the fold (F10), because the tier **is** the player's `AI Difficulty` setting.
 */

import type { BotTier } from "@/engine";

import type { TierRow } from "./types";

export const TIERS: Record<BotTier, TierRow> = {
  beginner: {
    pool: ["turtle", "opportunist"],
    minWinChance: 0.25,
    blunderRate: 0.4, // [ours] — interpolated below Easy's sourced 0.30
    tierReserveFactor: 0.4,
    placement: "spread",
    lookahead: 0,
    usesExactOdds: false,
    fogHonest: true,
    fogPessimism: 1.5,
    allianceLoyalty: 1.0,
    seesKillForCards: false,
    seesCardTradeTiming: false,
    seesDominationThreshold: false,
    antiBotBias: true, // [SMG]
  },
  easy: {
    pool: ["turtle", "opportunist"],
    minWinChance: 0.25,
    blunderRate: 0.3,
    tierReserveFactor: 0.5,
    placement: "spread",
    lookahead: 0,
    usesExactOdds: false,
    fogHonest: true,
    fogPessimism: 1.4,
    allianceLoyalty: 1.0,
    seesKillForCards: false,
    seesCardTradeTiming: false,
    seesDominationThreshold: false,
    antiBotBias: true, // [SMG]
  },
  medium: {
    pool: ["turtle", "opportunist", "continental", "hoarder"],
    minWinChance: 0.45,
    blunderRate: 0.12,
    tierReserveFactor: 0.8,
    placement: "secure",
    lookahead: 0,
    usesExactOdds: true,
    fogHonest: true,
    fogPessimism: 1.2,
    allianceLoyalty: 1.0,
    seesKillForCards: false,
    seesCardTradeTiming: true,
    seesDominationThreshold: true,
    antiBotBias: false,
  },
  hard: {
    pool: ["turtle", "opportunist", "continental", "hoarder", "rusher"],
    minWinChance: 0.55,
    blunderRate: 0.03,
    tierReserveFactor: 1.0,
    placement: "secure",
    lookahead: 1,
    usesExactOdds: true,
    fogHonest: true,
    fogPessimism: 1.1,
    allianceLoyalty: 0.9,
    seesKillForCards: true,
    seesCardTradeTiming: true,
    seesDominationThreshold: true,
    antiBotBias: false,
  },
  expert: {
    // All eight, weighted toward continental and rusher — the weighting lives in `EXPERT_POOL`,
    // which repeats those two names so a uniform draw over the list biases toward them.
    pool: ["continental", "continental", "rusher", "rusher", "clusterer", "hoarder", "turtle", "opportunist", "assassin", "wildcard"],
    minWinChance: "dynamic", // the floor is `score <= 0`
    blunderRate: 0,
    tierReserveFactor: 1.2, // [SPEC]
    placement: "secure",
    lookahead: 2,
    usesExactOdds: true,
    /**
     * D31: only Expert reads true, un-fogged state (RGD parity). SMG state plainly that their real
     * AI sees the player's troops under Fog of War at *every* difficulty; giving that edge only to
     * Expert is a deliberate, disclosed divergence that keeps low tiers feeling fair.
     */
    fogHonest: false,
    fogPessimism: 1.0,
    allianceLoyalty: 0.6, // D63: rare and decisive, never a repeated nibble
    seesKillForCards: true,
    seesCardTradeTiming: true,
    seesDominationThreshold: true,
    antiBotBias: false,
  },
};

/** Strictly increasing competence: the one invariant the tier table owes the player. */
export const TIER_ORDER: readonly BotTier[] = ["beginner", "easy", "medium", "hard", "expert"];
