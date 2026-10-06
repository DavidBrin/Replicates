/**
 * `dealTerritories` — the whole opening, in one action (R2–R8, R10, R11; D3,
 * D4, D64, D65; F39).
 *
 * **The order is fixed and load-bearing** (R3, F39):
 *
 * 1. **seat order** (R4) from the `turnOrder` sub-stream;
 * 2. **blizzards and portals** (R10, R11) via `placeModifiers`;
 * 3. **the deal over the non-blizzard territories only** (R3, R5);
 * 4. **capitals, each from that seat's own dealt territories** (R8).
 *
 * Blizzards must precede the deal because a blizzard tile is never dealt;
 * capitals must follow it because a capital is one of the seat's dealt
 * territories. Three sub-streams are passed in rather than one, so adding a
 * draw to the deal can never shift the modifier placement (D4).
 *
 * Draw counts, all asserted by a test (D4):
 *
 * | sub-stream      | draws                                                  |
 * |-----------------|--------------------------------------------------------|
 * | `turnOrder`     | `seats - 1` (Fisher–Yates)                             |
 * | `modifierPlace` | `blizzardSlots` (if on) + `2 * portalSlots` (if on)    |
 * | `deal`          | `nonBlizzard - 1` (shuffle) + `seats` (capitals, only when Capitals is on); 0 under Manual Placement |
 */
import { drawIndex, shuffled } from "../prng";
import { STARTING_ARMIES, SEAT_NEUTRAL, type Action, type BotPersona, type GameConfig, type MapDef, type Rng, type Seat, type SeatInit, type TerritoryId } from "../types";
import { placeModifiers } from "./placeModifiers";

/** One dealt territory. */
type DealEntry = { readonly territory: TerritoryId; readonly owner: Seat; readonly troops: number };

/**
 * R3 — one army on each owned territory, then the remainder spread evenly,
 * **leftovers to the lowest-index territory** (D65). Deterministic: no draw.
 */
function spreadArmies(territories: readonly TerritoryId[], armies: number): Map<TerritoryId, number> {
  const out = new Map<TerritoryId, number>();
  const k = territories.length;
  if (k === 0) return out;
  const sorted = [...territories].sort((a, b) => a - b);
  const remainder = Math.max(0, armies - k);
  const each = Math.floor(remainder / k);
  const leftover = remainder - each * k;
  for (const t of sorted) out.set(t, 1 + each);
  const first = sorted[0] as TerritoryId;
  out.set(first, (out.get(first) as number) + leftover);
  return out;
}

/**
 * R3/R5 — deal the non-blizzard territories round-robin from a shuffled order,
 * so the pile sizes differ by at most one and the **earlier recipients get the
 * larger piles**: `turnOrder`, then the neutral holding in the 2-seat variant
 * (R5, D64).
 */
function dealPiles(
  shuffledTerritories: readonly TerritoryId[],
  recipients: readonly Seat[],
): Map<Seat, TerritoryId[]> {
  const piles = new Map<Seat, TerritoryId[]>();
  for (const seat of recipients) piles.set(seat, []);
  shuffledTerritories.forEach((t, i) => {
    const seat = recipients[i % recipients.length] as Seat;
    (piles.get(seat) as TerritoryId[]).push(t);
  });
  return piles;
}

/** The whole opening in R3's fixed order (F39). */
export function dealTerritories(
  map: MapDef,
  config: GameConfig,
  personas: readonly (BotPersona | null)[],
  rngs: { deal: Rng; turnOrder: Rng; modifierPlace: Rng },
): Extract<Action, { type: "GAME_STARTED" }> {
  const seatCount = config.seats.length;

  // ① Seat order (R4). A seeded shuffle of the seat list is the same
  // distribution as "highest single die first, ties rerolled".
  const turnOrder = shuffled(
    rngs.turnOrder,
    Array.from({ length: seatCount }, (_v, i) => i),
  );

  // ② Blizzards and portals, BEFORE the deal (R3 ②, R10, R11).
  const { blizzards, portals } = placeModifiers(map, config.rules, rngs.modifierPlace);

  // ③ The deal over the non-blizzard territories only (R3, R5).
  const frozen = new Set<TerritoryId>(blizzards);
  const dealable = map.territories.filter((t) => !frozen.has(t.index)).map((t) => t.index);
  // D106 — the neutral is a 2-seat *option*, never the 2-seat default.
  const neutral = seatCount === 2 && config.rules.neutralHolding === true;
  const startingArmies = STARTING_ARMIES[seatCount] ?? 20;
  const deal: DealEntry[] = [];
  const pilesBySeat = new Map<Seat, TerritoryId[]>();

  if (!config.rules.manualPlacement) {
    const order = shuffled(rngs.deal, dealable);
    const recipients: Seat[] = neutral ? [...turnOrder, SEAT_NEUTRAL] : [...turnOrder];
    const piles = dealPiles(order, recipients);
    for (const seat of recipients) {
      const pile = piles.get(seat) as TerritoryId[];
      if (seat >= 0) pilesBySeat.set(seat, pile);
      // R6 under Auto Placement is performed here, by the even spread of R3
      // (D65): both seats and the neutral end on exactly their army total.
      const spread = spreadArmies(pile, startingArmies);
      for (const t of [...pile].sort((a, b) => a - b)) {
        deal.push({ territory: t, owner: seat, troops: spread.get(t) as number });
      }
    }
    deal.sort((a, b) => a.territory - b.territory);
  }

  // ④ Capitals, each from that seat's OWN dealt territories (R8).
  // Under Manual Placement nothing is owned yet, so every capital is `null`
  // here and the reducer assigns it once the seat's claims have resolved (R9).
  const drawCapitals = config.rules.capitals && !config.rules.manualPlacement;
  const capitals: (TerritoryId | null)[] = [];
  for (let seat = 0; seat < seatCount; seat++) {
    if (!drawCapitals) {
      capitals.push(null);
      continue;
    }
    const pile = [...(pilesBySeat.get(seat) ?? [])].sort((a, b) => a - b);
    const at = drawIndex(rngs.deal, pile.length);
    capitals.push(at < 0 ? null : (pile[at] as TerritoryId));
  }

  const seats: SeatInit[] = config.seats.map((seat, i) => ({
    seat: i,
    kind: seat.kind,
    name: seat.name,
    colour: seat.colour,
    tier: seat.tier,
    persona: personas[i] ?? null,
  }));

  return {
    type: "GAME_STARTED",
    seat: turnOrder[0] as Seat,
    mapSlug: map.slug,
    rules: config.rules,
    seats,
    turnOrder,
    neutral,
    startingArmies,
    deal,
    blizzards,
    portals,
    capitals,
  };
}
