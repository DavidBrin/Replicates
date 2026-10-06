/**
 * The eight personas and the fold `persona ⊕ TIERS[tier]` (SPEC §4.13, D28, F3, F10).
 *
 * `drawPersonas` is **S2's**, not the resolver's (F3). It picks the persona literal, jitters the
 * sourced knobs ±10%, then overwrites from the tier row — the tier always wins — and stores the
 * **result**. Nothing downstream ever consults the tier row again, so a bot's behaviour is fully
 * described by one `BotPersona` object and a replay cannot drift when a tier row is retuned.
 * `SeatState.tier` survives only as a label for the HUD.
 *
 * Two sub-streams (§7.2): `assignRng` picks from `TIERS[tier].pool` and resolves `wildcard`;
 * `jitterRng` applies the jitter. Each seat consumes a **fixed** number of draws from each, so
 * adding a persona field does not shift another seat's draw.
 */

import type { BotPersona, BotTier, Rng } from "@/engine";

import { TIERS } from "./tiers";
import { ANTI_BOT_BIAS } from "./types";

/**
 * The **UNFOLDED** persona literals. `GameState` never holds one of these — it holds the fold.
 *
 * The `aggression` / `minWinChance` / `reserveFactor` / `reserveFloor` / `continentFocus` /
 * `expansionism` / `stackiness` / `leaderBias` / `placement` columns are sourced (RGD's named
 * personas and their proven Lux equivalents); the rest are **[SPEC]** fills consistent with each
 * persona's published description.
 *
 * Killbot's *"20 armies on each border"* is the only published absolute reserve number in any
 * source, and it is the assassin's `reserveFloor`.
 */
function literal(name: string, over: Partial<BotPersona>): BotPersona {
  return {
    name,
    tier: "medium",            // replaced by the fold
    aggression: 0.5,
    minWinChance: 0.5,
    dynamicMinWinChance: false,
    reserveFactor: 1.0,
    tierReserveFactor: 0.8,    // replaced by the fold
    antiBotBias: 0,            // replaced by the fold
    reserveFloor: 3,
    continentFocus: 0.5,
    expansionism: 0.5,
    stackiness: 0.4,
    turtleAversion: 0.5,
    leaderBias: 0.4,
    grudgeWeight: 1.0,
    grudgeDecay: 0.8,
    allianceLoyalty: 1.0,      // replaced by the fold
    lookahead: 0,              // replaced by the fold
    seesKillForCards: false,
    seesCardTradeTiming: false,
    seesDominationThreshold: false,
    usesExactOdds: true,       // replaced by the fold
    fogHonest: true,           // replaced by the fold
    fogPessimism: 1.2,         // replaced by the fold
    blunderRate: 0,            // replaced by the fold
    placement: "secure",
    ...over,
  };
}

export const PERSONAS: Record<string, BotPersona> = {
  // RGD "Aggressive" / Lux Angry, EvilPixie
  rusher: literal("rusher", {
    aggression: 0.9, minWinChance: 0.3, reserveFactor: 0.5, reserveFloor: 2,
    continentFocus: 0.4, expansionism: 0.8, stackiness: 0.3, leaderBias: 0.5,
    turtleAversion: 0.3, grudgeWeight: 0.8, grudgeDecay: 0.7, placement: "frontLoad",
  }),
  // RGD "Continental" / Lux Pixie
  continental: literal("continental", {
    aggression: 0.55, minWinChance: 0.5, reserveFactor: 1.0, reserveFloor: 3,
    continentFocus: 1.0, expansionism: 0.4, stackiness: 0.4, leaderBias: 0.4,
    turtleAversion: 0.5, grudgeWeight: 1.0, grudgeDecay: 0.85, placement: "secure",
  }),
  // Lux Cluster: scores connectivity over bonuses
  clusterer: literal("clusterer", {
    aggression: 0.5, minWinChance: 0.5, reserveFactor: 1.0, reserveFloor: 3,
    continentFocus: 0.3, expansionism: 0.6, stackiness: 0.5, leaderBias: 0.3,
    turtleAversion: 0.5, grudgeWeight: 0.9, grudgeDecay: 0.8, placement: "secure",
  }),
  // RGD "Stacker" / Lux Shaft: attacks only when dominant
  hoarder: literal("hoarder", {
    aggression: 0.35, minWinChance: 0.65, reserveFactor: 1.4, reserveFloor: 6,
    continentFocus: 0.3, expansionism: 0.3, stackiness: 1.0, leaderBias: 0.3,
    turtleAversion: 0.7, grudgeWeight: 0.7, grudgeDecay: 0.9, placement: "stack",
  }),
  // RGD "Defensive" / Lux Bort: one attack per turn
  turtle: literal("turtle", {
    aggression: 0.15, minWinChance: 0.8, reserveFactor: 2.0, reserveFloor: 4,
    continentFocus: 0.5, expansionism: 0.2, stackiness: 0.6, leaderBias: 0.2,
    turtleAversion: 0.8, grudgeWeight: 0.6, grudgeDecay: 0.95, placement: "secure",
  }),
  // RGD "Friendly" / Lux Yakool, Boscoe: card-seeking + leader-continent denial
  opportunist: literal("opportunist", {
    aggression: 0.5, minWinChance: 0.45, reserveFactor: 1.0, reserveFloor: 3,
    continentFocus: 0.5, expansionism: 0.5, stackiness: 0.4, leaderBias: 0.7,
    turtleAversion: 0.6, grudgeWeight: 1.0, grudgeDecay: 0.8, placement: "secure",
  }),
  // Lux Killbot, Reaper: masses between kills, and keeps 20 on each border
  assassin: literal("assassin", {
    aggression: 0.7, minWinChance: 0.4, reserveFactor: 1.0, reserveFloor: 20,
    continentFocus: 0.3, expansionism: 0.6, stackiness: 0.7, leaderBias: 0.6,
    turtleAversion: 0.4, grudgeWeight: 1.4, grudgeDecay: 0.6, placement: "frontLoad",
    seesKillForCards: true, // the assassin keeps it at every tier that draws it
  }),
  // Lux Chimera / RGD's own mechanism: samples another persona at match start
  wildcard: literal("wildcard", {
    aggression: 0.5, minWinChance: 0.5, reserveFactor: 1.0, reserveFloor: 3,
  }),
};

/** `turtle` caps itself at one attack per turn (§4.13). */
export const ONE_ATTACK_PERSONAS: readonly string[] = ["turtle"];
/** `hoarder` attacks only when dominant (§4.13). */
export const DOMINANT_ONLY_PERSONAS: readonly string[] = ["hoarder"];

/** The knobs the ±10% jitter touches, in a fixed order, so the draw count per seat is constant. */
const JITTERED: readonly (keyof BotPersona)[] = [
  "aggression", "reserveFactor", "continentFocus", "expansionism",
  "stackiness", "turtleAversion", "leaderBias", "grudgeWeight", "grudgeDecay",
];

/** Knobs that are probabilities and must stay inside [0, 1] after jitter. */
const UNIT_RANGE: ReadonlySet<string> = new Set([
  "aggression", "continentFocus", "expansionism", "stackiness", "turtleAversion", "leaderBias",
]);

const JITTER = 0.1;
/** Beginner draws from the softest end of the jitter band (§4.13's "softest jitter"). */
const BEGINNER_JITTER = 0.05;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Draw one persona for one tier and fold the row into it. `drawPersonas` is this, per seat.
 *
 * Draw discipline, fixed per seat: **two** `assignRng` draws (the pool pick, then the `wildcard`
 * resample — taken unconditionally so a non-wildcard seat does not shift a later seat's stream) and
 * exactly `JITTERED.length` `jitterRng` draws.
 */
export function personaFor(tier: BotTier, assignRng: Rng, jitterRng: Rng): BotPersona {
  const row = TIERS[tier];
  const pick = assignRng.nextFloat();
  const resample = assignRng.nextFloat();

  let name = row.pool[Math.min(row.pool.length - 1, Math.floor(pick * row.pool.length))] as string;
  if (name === "wildcard") {
    // The wildcard samples another persona at match start — never itself.
    const others = Object.keys(PERSONAS).filter((n) => n !== "wildcard").sort();
    name = others[Math.min(others.length - 1, Math.floor(resample * others.length))] as string;
  }
  const base = PERSONAS[name] as BotPersona;

  // ---- jitter the sourced knobs -------------------------------------------------------------
  const amplitude = tier === "beginner" ? BEGINNER_JITTER : JITTER;
  const jittered: Record<string, number> = {};
  for (const key of JITTERED) {
    const u = jitterRng.nextFloat();
    const value = base[key] as number;
    const scaled = value * (1 + (u * 2 - 1) * amplitude);
    jittered[key] = UNIT_RANGE.has(key)
      ? clamp(scaled, 0, 1)
      : key === "grudgeDecay"
        ? clamp(scaled, 0.5, 0.95)
        : Math.max(0, scaled);
  }

  // ---- the fold: the tier overwrites, because the tier IS the difficulty setting (F10) -------
  return {
    ...base,
    ...jittered,
    tier,
    ...(row.minWinChance === "dynamic"
      ? { minWinChance: 0, dynamicMinWinChance: true }
      : { minWinChance: row.minWinChance, dynamicMinWinChance: false }),
    blunderRate: row.blunderRate,
    tierReserveFactor: row.tierReserveFactor,
    placement: row.placement,
    lookahead: row.lookahead,
    usesExactOdds: row.usesExactOdds,
    fogHonest: row.fogHonest,
    fogPessimism: row.fogPessimism,
    allianceLoyalty: row.allianceLoyalty,
    seesKillForCards: row.seesKillForCards || base.seesKillForCards, // the assassin keeps it
    seesCardTradeTiming: row.seesCardTradeTiming,
    seesDominationThreshold: row.seesDominationThreshold,
    antiBotBias: row.antiBotBias ? ANTI_BOT_BIAS : 0,
  };
}

/**
 * One entry per seat, `null` for a human seat, each already folded with its tier (F10).
 *
 * Both sub-streams advance by a fixed amount **per bot seat**, in seat order, so inserting a human
 * seat between two bots does not reshuffle the bots' personas.
 */
export function drawPersonas(
  tiers: readonly (BotTier | null)[],
  assignRng: Rng,
  jitterRng: Rng,
): readonly (BotPersona | null)[] {
  return tiers.map((tier) => (tier === null ? null : personaFor(tier, assignRng, jitterRng)));
}
