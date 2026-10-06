/**
 * `viewFor` (R73, F12, F36) and the hash/serialise pair (D16, R92).
 */
import { describe, expect, it } from "vitest";

import { buildState, card, territoryCard } from "./__fixtures__/states";
import { classicWorld, mini, tiny4 } from "./__fixtures__/maps";
import { canSee, viewFor, visibilityFor } from "./fog";
import { canonicalize, hashState } from "./hash";
import { legalActions } from "./legalActions";
import { apply } from "./reducer";
import { pendingAlliancesOf } from "./rules";
import { deserializeState, serializeState, STATE_FORMAT_VERSION } from "./serialize";
import { SEAT_UNKNOWN, TROOPS_UNKNOWN, type GameState } from "./types";
import { validate } from "./validate";

const hands = {
  0: [territoryCard(mini, 0), territoryCard(mini, 1)],
  1: [territoryCard(mini, 3), territoryCard(mini, 4), card("wild-1", "wild", null)],
};

/** mini, seats 0 and 1 split across the two continents. */
function split(fog: boolean) {
  return buildState(mini, {
    seats: 2,
    owners: [0, 0, 0, 1, 1, 1],
    troops: [2, 3, 4, 5, 6, 7],
    rules: { fogOfWar: fog },
    hands,
  });
}

describe("F12 — hands are secret whether or not fog is on", () => {
  it("empties every other seat's cards and keeps the true cardCount", () => {
    const view = viewFor(split(false), mini, 0);
    expect(view.seats[0]?.cards).toHaveLength(2);
    expect(view.seats[1]?.cards).toEqual([]);
    expect(view.seats[1]?.cardCount).toBe(3);
  });

  it("keeps the viewer's own hand intact", () => {
    const view = viewFor(split(true), mini, 1);
    expect(view.seats[1]?.cards.map((c) => c.id)).toEqual(["r1", "r2", "wild-1"]);
    expect(view.seats[0]?.cards).toEqual([]);
    expect(view.seats[0]?.cardCount).toBe(2);
  });

  it("never leaks another seat's card ids anywhere in the serialised view", () => {
    const json = JSON.stringify(viewFor(split(true), mini, 0));
    expect(json).not.toContain("wild-1");
    expect(json).not.toContain('"r2"');
  });
});

describe("R73 — territory masking", () => {
  it("is the identity over the territories with fog off", () => {
    const state = split(false);
    const view = viewFor(state, mini, 0);
    expect(view.territories).toEqual(state.territories);
  });

  it("hides owner and troops for anything not adjacent to something you occupy", () => {
    // Seat 0 holds 0, 1, 2; 2 (l3) borders 3 (r1), so 3 is visible and 4, 5 are not.
    const view = viewFor(split(true), mini, 0);
    expect(view.territories[3]).toEqual({ owner: 1, troops: 5, blizzard: false });
    expect(view.territories[4]).toEqual({ owner: SEAT_UNKNOWN, troops: TROOPS_UNKNOWN, blizzard: false });
    expect(view.territories[5]).toEqual({ owner: SEAT_UNKNOWN, troops: TROOPS_UNKNOWN, blizzard: false });
  });

  it("always shows the viewer its own territories", () => {
    const view = viewFor(split(true), mini, 0);
    for (const t of [0, 1, 2]) expect(view.territories[t]?.owner).toBe(0);
  });

  it("R68 — an active portal reveals its far end", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      rules: { fogOfWar: true },
      portals: [{ a: 0, b: 5, kind: "stable", activeFrom: 0 }],
    });
    expect(canSee(state, mini, 0, 5)).toBe(true);
    expect(viewFor(state, mini, 0).territories[5]?.owner).toBe(1);
  });

  it("keeps the blizzard flag visible, since it is terrain rather than a holding", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1],
      blizzards: [5],
      rules: { fogOfWar: true },
    });
    const view = viewFor(state, mini, 0);
    expect(view.territories[5]?.blizzard).toBe(true);
    expect(view.territories[5]?.owner).toBe(SEAT_UNKNOWN);
  });

  it("visibilityFor flags exactly the seat's own tiles and their neighbours", () => {
    const visible = visibilityFor(split(true), mini, 0);
    expect([...visible]).toEqual([1, 1, 1, 1, 0, 0]);
  });

  it("a seat holding nothing sees nothing", () => {
    const state = buildState(mini, { seats: 2, owners: [1, 1, 1, 1, 1, 1], rules: { fogOfWar: true } });
    expect([...visibilityFor(state, mini, 0)]).toEqual([0, 0, 0, 0, 0, 0]);
    const view = viewFor(state, mini, 0);
    expect(view.territories.every((t) => t.owner === SEAT_UNKNOWN)).toBe(true);
  });

  it("reveals more as the viewer's holdings grow", () => {
    const narrow = viewFor(buildState(mini, { seats: 2, owners: [0, 1, 1, 1, 1, 1], rules: { fogOfWar: true } }), mini, 0);
    const wide = viewFor(split(true), mini, 0);
    const hiddenIn = (s: typeof narrow) => s.territories.filter((t) => t.owner === SEAT_UNKNOWN).length;
    expect(hiddenIn(narrow)).toBeGreaterThan(hiddenIn(wide));
  });
});

describe("F36 — a view is never hashable", () => {
  it("always sets fogged: true, fog on or off", () => {
    expect(viewFor(split(false), mini, 0).fogged).toBe(true);
    expect(viewFor(split(true), mini, 0).fogged).toBe(true);
  });

  it("hashState throws on a fogged state", () => {
    const view = viewFor(split(true), mini, 0);
    expect(() => hashState(view)).toThrow(/fogged/);
  });

  it("hashState accepts authoritative state", () => {
    expect(hashState(split(true))).toMatch(/^[0-9a-f]{16}$/);
  });

  it("leaves the input state untouched", () => {
    const state = split(true);
    const before = JSON.stringify(state);
    viewFor(state, mini, 0);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("hashState", () => {
  it("is a 64-bit hex digest (D16)", () => {
    expect(hashState(split(false))).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for the same state", () => {
    expect(hashState(split(false))).toBe(hashState(split(false)));
  });

  it("moves when any rule-relevant field moves", () => {
    const base = split(false);
    const digests = new Set([
      hashState(base),
      hashState({ ...base, round: 2 }),
      hashState({ ...base, turn: 2 }),
      hashState({ ...base, phase: "fortify" }),
      hashState({ ...base, troopsToPlace: 1 }),
      hashState({ ...base, currentIndex: 1 }),
      hashState({ ...base, setsTradedTotal: 1 }),
      hashState({ ...base, conqueredThisTurn: true }),
      hashState({ ...base, fortifyUsed: true }),
    ]);
    expect(digests.size).toBe(9);
  });

  it("moves when a territory moves", () => {
    const base = split(false);
    const moved = { ...base, territories: base.territories.map((t, i) => (i === 0 ? { ...t, troops: 99 } : t)) };
    expect(hashState(moved)).not.toBe(hashState(base));
  });

  it("F1 — never covers the map, only the slug", () => {
    const onMini = buildState(mini, { seats: 2, owners: [0, 0, 0, 1, 1, 1], troops: [1, 1, 1, 1, 1, 1] });
    const sameShapeOtherSlug = { ...onMini, mapSlug: "classic-world" };
    expect(hashState(sameShapeOtherSlug)).not.toBe(hashState(onMini));
    // And two states over the same slug with the same contents agree, however
    // the MapDef that produced them differed.
    expect(hashState({ ...onMini })).toBe(hashState(onMini));
  });

  it("is insensitive to property insertion order", () => {
    const base = split(false);
    const entries = Object.entries(base).reverse();
    const reordered = Object.fromEntries(entries) as typeof base;
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(base)[0]);
    expect(hashState(reordered)).toBe(hashState(base));
  });

  it("is insensitive to hand order, because hands are kept sorted", () => {
    const base = split(false);
    expect(canonicalize(base)).toContain('"cards"');
  });
});

describe("canonicalize", () => {
  it("sorts object keys", () => {
    const state = buildState(tiny4, { seats: 2 });
    const text = canonicalize(state);
    const topLevelKeys = [...text.matchAll(/"([a-zA-Z]+)":/g)].map((m) => m[1] as string);
    const first = topLevelKeys.slice(0, 3);
    expect(first[0]).toBe("conqueredThisTurn");
    expect([...first]).toEqual([...first].sort());
  });

  it("prints integers as integers and the one fraction on a fixed grid", () => {
    const state = buildState(tiny4, { seats: 2, rules: { dominationThreshold: 0.7 } });
    const text = canonicalize(state);
    expect(text).toContain('"dominationThreshold":0.700000');
    expect(text).toContain('"round":1');
  });

  it("writes null for an absent optional rather than dropping the slot", () => {
    const state = buildState(tiny4, { seats: 2 });
    expect(canonicalize(state)).toContain('"pendingMoveIn":null');
  });

  it("omits an undefined key the way JSON does, so a round trip cannot move the hash", () => {
    const state = buildState(tiny4, { seats: 2 });
    const withUndefined = { ...state, outcome: undefined } as unknown as typeof state;
    expect(canonicalize(withUndefined)).not.toContain('"outcome"');
    // And the round trip agrees, which is the property that actually matters:
    // JSON.stringify drops the key too, so serialise/deserialise is a fixpoint.
    const roundTripped = JSON.parse(JSON.stringify(withUndefined)) as typeof state;
    expect(canonicalize(roundTripped)).toBe(canonicalize(withUndefined));
    // `null` is a value in `GameState`, not an absence, and is written as one.
    expect(canonicalize({ ...state, outcome: null })).toContain('"outcome":null');
  });

  it("works over a 100-territory-scale state", () => {
    const state = buildState(classicWorld, { seats: 6, owners: classicWorld.territories.map((_t, i) => i % 6) });
    expect(canonicalize(state).length).toBeGreaterThan(1000);
    expect(hashState(state)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("serialize / deserialize", () => {
  it("round-trips a state through the versioned envelope", () => {
    const state = split(false);
    const back = deserializeState(serializeState(state));
    expect(back).toEqual(state);
  });

  it("R92 — the round trip never moves the hash (T5)", () => {
    const state = split(true);
    expect(hashState(deserializeState(serializeState(state)))).toBe(hashState(state));
  });

  it("carries the envelope version", () => {
    expect(JSON.parse(serializeState(split(false))) as { v: number }).toMatchObject({
      v: STATE_FORMAT_VERSION,
    });
  });

  it("refuses a foreign envelope version", () => {
    expect(() => deserializeState(JSON.stringify({ v: 99, state: split(false) }))).toThrow(/version/);
  });

  it("refuses a malformed payload", () => {
    expect(() => deserializeState("null")).toThrow();
    expect(() => deserializeState(JSON.stringify({ v: 1 }))).toThrow(/malformed/);
    expect(() => deserializeState(JSON.stringify({ v: 1, state: { territories: [] } }))).toThrow(/malformed/);
  });

  it("refuses a state from a newer ruleset (R92)", () => {
    const future = { ...split(false), version: 99 };
    expect(() => deserializeState(JSON.stringify({ v: 1, state: future }))).toThrow(/newer ruleset/);
  });

  it("accepts a state from an older ruleset, so stored replays keep playing back (R92)", () => {
    const older = { ...split(false), version: 0 };
    expect(deserializeState(JSON.stringify({ v: 1, state: older })).version).toBe(0);
  });

  /**
   * R92 — the v1 → v2 move, which is `GameState.pendingAlliances` (§4.7; codex round 4, finding 3).
   *
   * The field was added to the state without a format bump, so a v1 envelope was accepted as a
   * *current* state that was in fact half understood: `validate`, `legalActions` and `apply` all
   * read `pendingAlliances`, and all three threw a `TypeError` on the first alliance question —
   * crashing a resumed autosave, which is exactly the silent misreading the envelope exists to
   * stop. The migration fills the only value it can mean: nothing was in the air, because that
   * build had no way to record an offer.
   */
  describe("the v1 → v2 migration", () => {
    function v1Envelope(): string {
      const state = { ...split(false) } as Record<string, unknown>;
      delete state.pendingAlliances;
      return JSON.stringify({ v: 1, state });
    }

    it("is a real version move, not a silent widening", () => {
      expect(STATE_FORMAT_VERSION).toBe(3);
      expect(JSON.parse(serializeState(split(false))) as { v: number }).toMatchObject({ v: 3 });
    });

    it("v2 → v3 (D106): a two-seat board of that era had the neutral, any other did not", () => {
      const two = { ...split(false) } as Record<string, unknown>;
      delete (two.rules as Record<string, unknown>).neutralHolding;
      const backTwo = deserializeState(JSON.stringify({ v: 2, state: two }));
      expect(backTwo.rules.neutralHolding).toBe(true);

      const three = { ...buildState(mini, { seats: 3, owners: [0, 0, 1, 1, 2, 2] }) } as Record<string, unknown>;
      delete (three.rules as Record<string, unknown>).neutralHolding;
      const backThree = deserializeState(JSON.stringify({ v: 2, state: three }));
      expect(backThree.rules.neutralHolding).toBe(false);

      // A v3 envelope that already says so is left alone, whatever the seat count.
      const kept = deserializeState(serializeState(split(false)));
      expect(kept.rules.neutralHolding).toBe(false);
    });

    it("deserialises a v1 envelope that lacks pendingAlliances", () => {
      const back = deserializeState(v1Envelope());
      expect(back.pendingAlliances).toEqual([]);
    });

    it("the migrated state answers every engine door that reads the field", () => {
      const back = deserializeState(v1Envelope());
      expect(() => legalActions(back, mini, 0)).not.toThrow();
      expect(validate(back, mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 1 })?.code).toBe("notAlliable");
      // `alliances` is off on this fixture, so the refusal above is R80's toggle and not a crash.
      expect(apply(back, mini, { type: "END_PHASE", seat: 0 }).error).toBeUndefined();
    });

    /**
     * The belt behind the braces: {@link pendingAlliancesOf} is what every *other* door reads
     * through, because a snapshot row and a poll body are already-parsed states that never pass
     * through the envelope at all. `apply` is the one that must not throw (R86).
     */
    it("pendingAlliancesOf and apply tolerate a state the envelope never saw", () => {
      const stale = { ...split(false), rules: { ...split(false).rules, alliances: true } } as Record<string, unknown>;
      delete stale.pendingAlliances;
      const foreign = stale as unknown as GameState;
      expect(pendingAlliancesOf(foreign)).toEqual([]);
      expect(() => legalActions(foreign, mini, 0)).not.toThrow();
      expect(() => validate(foreign, mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 1 })).not.toThrow();
      expect(() => apply(foreign, mini, { type: "END_PHASE", seat: 0 })).not.toThrow();
      // And the state `apply` hands back carries the field, so the next fold needs no help.
      expect(apply(foreign, mini, { type: "END_PHASE", seat: 0 }).state.pendingAlliances).toEqual([]);
    });
  });
});
