/**
 * Cards: the deck, the sets, the values and the three timing branches
 * (R19–R28; D19, D20, D56).
 */
import { describe, expect, it } from "vitest";

import { buildState, card, territoryCard } from "./__fixtures__/states";
import type { Card } from "./types";
import { classicWorld, mini, tiny4 } from "./__fixtures__/maps";
import {
  cardById,
  cardSets,
  cardTradeValue,
  deckFor,
  hasSet,
  isValidSet,
  mustTradeAtTurnStart,
  mustTradeDown,
  mustTradeNow,
  remainingDeck,
  wildCardId,
} from "./cards";

const inf = (n: number) => card(`i${String(n)}`, "infantry", n);
const cav = (n: number) => card(`c${String(n)}`, "cavalry", n);
const art = (n: number) => card(`a${String(n)}`, "artillery", n);
const wild = (n: number) => card(wildCardId(n), "wild", null);

describe("R19 — the deck", () => {
  it("is one card per territory plus exactly two wilds", () => {
    const deck = deckFor(classicWorld);
    expect(deck).toHaveLength(44);
    expect(deck.filter((c) => c.suit === "wild")).toHaveLength(2);
    expect(deck.filter((c) => c.suit !== "wild")).toHaveLength(42);
  });

  it("names each territory card after its territory and carries the authored suit", () => {
    const deck = deckFor(classicWorld);
    for (const t of classicWorld.territories) {
      const entry = deck.find((c) => c.id === t.id);
      expect(entry).toBeDefined();
      expect(entry?.suit).toBe(t.suit);
      expect(entry?.territory).toBe(t.index);
    }
  });

  it("gives the two wilds a null territory and the canonical ids", () => {
    const wilds = deckFor(tiny4).filter((c) => c.suit === "wild");
    expect(wilds.map((c) => c.id)).toEqual(["wild-1", "wild-2"]);
    expect(wilds.every((c) => c.territory === null)).toBe(true);
  });

  it("is sorted by id, so every derived pool is order-stable (R91)", () => {
    const ids = deckFor(classicWorld).map((c) => c.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("stores no order: the live pool is allCards minus hands minus discard", () => {
    const held = [territoryCard(mini, 0), territoryCard(mini, 1)];
    const discarded = [territoryCard(mini, 2)];
    const state = buildState(mini, { hands: { 0: held }, discard: discarded });
    const pool = remainingDeck(state, mini);
    expect(pool).toHaveLength(8 - 3);
    expect(pool.map((c) => c.id)).not.toContain("l1");
    expect(pool.map((c) => c.id)).not.toContain("l3");
  });

  it("empties the pool once every card is held or discarded, which is the reshuffle cue", () => {
    const all = deckFor(mini);
    const state = buildState(mini, { discard: all });
    expect(remainingDeck(state, mini)).toEqual([]);
  });

  it("cardById finds a card by its canonical id", () => {
    expect(cardById(mini, "r2")?.territory).toBe(4);
    expect(cardById(mini, "wild-2")?.suit).toBe("wild");
    expect(cardById(mini, "nope")).toBeNull();
  });
});

describe("R21 — valid sets", () => {
  it("accepts three of a kind", () => {
    expect(isValidSet([inf(1), inf(2), inf(3)])).toBe(true);
    expect(isValidSet([cav(1), cav(2), cav(3)])).toBe(true);
    expect(isValidSet([art(1), art(2), art(3)])).toBe(true);
  });

  it("accepts one of each", () => {
    expect(isValidSet([inf(1), cav(2), art(3)])).toBe(true);
  });

  it("accepts any two plus a Wild", () => {
    expect(isValidSet([inf(1), inf(2), wild(1)])).toBe(true);
    expect(isValidSet([inf(1), cav(2), wild(1)])).toBe(true);
    expect(isValidSet([wild(1), wild(2), art(3)])).toBe(true);
  });

  it("rejects two of one suit and one of another", () => {
    expect(isValidSet([inf(1), inf(2), cav(3)])).toBe(false);
  });

  it("rejects the wrong number of cards", () => {
    expect(isValidSet([inf(1), inf(2)])).toBe(false);
    expect(isValidSet([inf(1), inf(2), inf(3), inf(4)])).toBe(false);
    expect(isValidSet([])).toBe(false);
  });

  it("rejects the same card counted twice", () => {
    expect(isValidSet([inf(1), inf(1), inf(2)])).toBe(false);
  });
});

describe("cardSets", () => {
  it("enumerates every tradeable triple in a hand", () => {
    const sets = cardSets([inf(1), inf(2), inf(3), cav(4)]);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toEqual(["i1", "i2", "i3"]);
  });

  it("includes every wild combination", () => {
    const sets = cardSets([inf(1), cav(2), wild(1)]);
    expect(sets).toHaveLength(1);
  });

  it("returns triples sorted by id, in a stable order (R91)", () => {
    const sets = cardSets([art(9), inf(1), cav(5), inf(2), inf(3)]);
    for (const triple of sets) expect([...triple]).toEqual([...triple].sort());
    expect(sets).toEqual([...sets].map((t) => t).sort((a, b) => (a.join() < b.join() ? -1 : 1)));
  });

  it("finds nothing in a hand that holds no set", () => {
    expect(cardSets([inf(1), inf(2), cav(3), cav(4)])).toEqual([]);
    expect(hasSet([inf(1), inf(2), cav(3), cav(4)])).toBe(false);
  });

  it("every 5-card hand holds at least one set, which is what makes R24 reachable", () => {
    const hands = [
      [inf(1), inf(2), inf(3), cav(4), cav(5)],
      [inf(1), inf(2), cav(3), cav(4), cav(5)],
      [inf(1), cav(2), art(3), art(4), art(5)],
      [inf(1), inf(2), inf(3), inf(4), inf(5)],
    ];
    for (const hand of hands) expect(hasSet(hand)).toBe(true);
  });
});

describe("R22 — set values", () => {
  it("Fixed pays 4 / 6 / 8 for three of a kind", () => {
    expect(cardTradeValue([inf(1), inf(2), inf(3)], 0, "fixed")).toBe(4);
    expect(cardTradeValue([cav(1), cav(2), cav(3)], 0, "fixed")).toBe(6);
    expect(cardTradeValue([art(1), art(2), art(3)], 0, "fixed")).toBe(8);
  });

  it("Fixed pays 10 for one of each", () => {
    expect(cardTradeValue([inf(1), cav(2), art(3)], 0, "fixed")).toBe(10);
  });

  it("Fixed pays 10 for any set containing a Wild", () => {
    expect(cardTradeValue([inf(1), inf(2), wild(1)], 0, "fixed")).toBe(10);
    expect(cardTradeValue([cav(1), art(2), wild(1)], 0, "fixed")).toBe(10);
    expect(cardTradeValue([wild(1), wild(2), inf(1)], 0, "fixed")).toBe(10);
  });

  it("Fixed ignores how many sets have been traded", () => {
    expect(cardTradeValue([inf(1), inf(2), inf(3)], 11, "fixed")).toBe(4);
  });

  it("Progressive climbs 4, 6, 8, 10, 12, 15 then +5 forever", () => {
    const ladder = [4, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
    ladder.forEach((value, i) => {
      expect(cardTradeValue([inf(1), inf(2), inf(3)], i, "progressive")).toBe(value);
    });
  });

  it("Progressive ignores the suits", () => {
    expect(cardTradeValue([art(1), art(2), art(3)], 0, "progressive")).toBe(4);
    expect(cardTradeValue([inf(1), cav(2), wild(1)], 2, "progressive")).toBe(8);
  });

  it("values an invalid triple at 0; the reducer refuses it before this is reached", () => {
    expect(cardTradeValue([inf(1), inf(2), cav(3)], 0, "fixed")).toBe(0);
    expect(cardTradeValue([inf(1), inf(2)], 0, "progressive")).toBe(0);
  });
});

describe("the three card-timing branches", () => {
  const fiveCards = [inf(1), inf(2), inf(3), cav(4), cav(5)];

  it("R24 — five cards at turn start forces a trade before DRAFT", () => {
    const state = buildState(mini, { phase: "draft", hands: { 0: fiveCards }, troopsToPlace: 5 });
    expect(mustTradeAtTurnStart(state, 0)).toBe(true);
    expect(mustTradeNow(state, 0)).toBe(true);
  });

  it("R24 — four cards force nothing", () => {
    const state = buildState(mini, { phase: "draft", hands: { 0: fiveCards.slice(0, 4) } });
    expect(mustTradeNow(state, 0)).toBe(false);
  });

  it("R24 — the optional second trade is never forced", () => {
    const state = buildState(mini, {
      phase: "draft",
      hands: { 0: fiveCards },
      setsTradedThisTurn: 1,
    });
    expect(mustTradeAtTurnStart(state, 0)).toBe(false);
    expect(mustTradeNow(state, 0)).toBe(false);
  });

  it("R25 — your own reward draw to five or six forces nothing in the phase it lands in", () => {
    // The draw lands in attack or fortify; only the NEXT turn's draft checks.
    for (const phase of ["attack", "fortify"] as const) {
      const state = buildState(mini, { phase, hands: { 0: [...fiveCards, art(6)] } });
      expect(mustTradeAtTurnStart(state, 0)).toBe(false);
    }
  });

  it("R26 — inheritance to six forces a trade-down, from whatever phase it landed in", () => {
    /*
     * R27's bounce is part of the inheritance: whatever phase the seizure arrived in, the reducer
     * puts play back in `draft` and records where to resume. `resumePhase` is therefore how
     * `mustTradeDown` knows this six is an inheritance rather than R20's reward draw — see the R25
     * case below, which is the same hand with no bounce.
     */
    for (const resumePhase of ["draft", "attack", "fortify"] as const) {
      const state = buildState(mini, {
        phase: "draft",
        resumePhase,
        hands: { 0: [...fiveCards, art(6)] },
      });
      expect(mustTradeDown(state, 0)).toBe(true);
      expect(mustTradeNow(state, 0)).toBe(true);
    }
  });

  it("R25 — the reward draw's six forces nothing, and is NOT read as an inheritance", () => {
    /*
     * Codex round 3, finding 1. `validateCardDrawn` admits the R20 award at a hand of five, so the
     * reward legitimately lands the hand on six in `fortify` — with no bounce, because nothing was
     * seized. Read as an inheritance, that hand had no legal action at all: `END_TURN` refused with
     * `mustTradeCards`, `END_PHASE` is illegal out of fortify (R67), `TRADE_CARDS` is draft-only.
     */
    const awarded = [...fiveCards, art(6)];
    const landed = buildState(mini, { phase: "fortify", hands: { 0: awarded } });
    expect(mustTradeDown(landed, 0)).toBe(false);
    expect(mustTradeNow(landed, 0)).toBe(false);

    // R24 picks it up at the start of the seat's next turn, which is what R25 asks for.
    const nextTurn = buildState(mini, { phase: "draft", hands: { 0: awarded } });
    expect(mustTradeAtTurnStart(nextTurn, 0)).toBe(true);
    expect(mustTradeNow(nextTurn, 0)).toBe(true);
  });

  it("R26/D114 — an inheritance to five IS a trade-down once the reducer has bounced it", () => {
    const state = buildState(mini, { phase: "draft", resumePhase: "attack", hands: { 0: fiveCards } });
    expect(mustTradeDown(state, 0)).toBe(true);
    expect(mustTradeNow(state, 0)).toBe(true);
  });

  it("R26 — an inheritance that leaves you under five waits for your next turn", () => {
    const state = buildState(mini, { phase: "attack", hands: { 0: fiveCards.slice(0, 4) } });
    expect(mustTradeDown(state, 0)).toBe(false);
    expect(mustTradeNow(state, 0)).toBe(false);
  });

  /*
   * R26's floor is FOUR, and a trade removes exactly three cards, so the walk
   * down from an 8-card inheritance is 8 -> 5 -> 2: five is not a stopping
   * point. `hand.length >= 6` alone let the hand out at five, and
   * `mustTradeAtTurnStart` declines once a set has been traded this turn, so
   * nothing forced the second trade and the seat played on holding five.
   */
  describe("R26 — the trade-down does not stop until the hand is four or fewer", () => {
    const eight = [inf(1), inf(2), inf(3), cav(4), cav(5), cav(6), art(7), art(8)];
    const five = eight.slice(0, 5);

    /** Mid-trade-down: the first forced trade has bounced play back to draft (R27). */
    const midTradeDown = (hand: readonly Card[]) => buildState(mini, {
      phase: "draft",
      resumePhase: "attack",
      setsTradedThisTurn: 1,
      hands: { 0: hand },
      troopsToPlace: 4,
    });

    it("still forces at five, mid-trade-down", () => {
      const state = midTradeDown(five);
      expect(five).toHaveLength(5);
      expect(mustTradeDown(state, 0)).toBe(true);
      expect(mustTradeNow(state, 0)).toBe(true);
    });

    it("stops at four, three and two", () => {
      for (const n of [4, 3, 2]) {
        const state = midTradeDown(eight.slice(0, n));
        expect(mustTradeDown(state, 0)).toBe(false);
        expect(mustTradeNow(state, 0)).toBe(false);
      }
    });

    it("8 -> 5 -> 2: the whole walk is forced until the floor", () => {
      let hand: readonly Card[] = eight;
      const sizes: number[] = [hand.length];
      for (let step = 0; step < 4; step++) {
        const state = step === 0
          // The inheritance itself: the reducer has already bounced play back to draft (R27).
          ? buildState(mini, {
            phase: "draft", resumePhase: "attack", hands: { 0: hand }, troopsToPlace: 4,
          })
          : midTradeDown(hand);
        if (!mustTradeDown(state, 0)) break;
        const traded = cardSets(hand)[0] as readonly string[];
        hand = hand.filter((c) => !traded.includes(c.id));
        sizes.push(hand.length);
      }
      expect(sizes).toEqual([8, 5, 2]);
      expect(hand.length).toBeLessThanOrEqual(4);
    });

    it("a hand of five that is NOT mid-trade-down still waits for the next turn (R26)", () => {
      // `resumePhase === null`: this five arrived by inheritance, not by trading down.
      const state = buildState(mini, { phase: "attack", hands: { 0: five } });
      expect(mustTradeDown(state, 0)).toBe(false);
      expect(mustTradeNow(state, 0)).toBe(false);
    });

    it("and still waits when a set HAS been traded this turn but no bounce happened", () => {
      /*
       * Codex round 2, finding 9 — the shape that rules out deriving "mid-trade-down" from the
       * hand size: `hand.length + 3 * setsTradedThisTurn = 8 >= 6`, yet this seat traded at turn
       * start and only then inherited back up to five, so it has never held six. R26 defers it.
       * `reducer.test.ts` drives the same shape through `apply` end to end.
       */
      const state = buildState(mini, {
        phase: "attack",
        resumePhase: null,
        setsTradedThisTurn: 1,
        hands: { 0: five },
      });
      expect(mustTradeDown(state, 0)).toBe(false);
      expect(mustTradeNow(state, 0)).toBe(false);
    });
  });

  it("R26 — one trade from six reaches three, which is why it stops there", () => {
    const hand = [...fiveCards, art(6)];
    expect(hand).toHaveLength(6);
    const traded = cardSets(hand)[0] as readonly string[];
    const left = hand.filter((c) => !traded.includes(c.id));
    expect(left).toHaveLength(3);
    expect(left.length).toBeLessThanOrEqual(4);
  });

  it("neither branch fires for a seat whose turn it is not", () => {
    const state = buildState(mini, { phase: "draft", hands: { 1: fiveCards }, currentIndex: 0 });
    expect(mustTradeNow(state, 1)).toBe(false);
  });

  it("neither branch fires on a hand that holds no set", () => {
    const noSet = [inf(1), inf(2), cav(3), cav(4), wild(1)];
    expect(hasSet(noSet)).toBe(true); // the wild makes it a set, as R21 says
    const state = buildState(mini, { phase: "draft", hands: { 0: noSet } });
    expect(mustTradeNow(state, 0)).toBe(true);
  });
});
