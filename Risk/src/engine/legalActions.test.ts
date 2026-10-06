/**
 * `legalActions` and the three lit-zone selectors (R16, R24, R29, R63, R66,
 * R67, R69, R74, R80, R91).
 */
import { describe, expect, it } from "vitest";

import { buildState, card } from "./__fixtures__/states";
import { mini, tiny4 } from "./__fixtures__/maps";
import {
  ACTION_ORDER,
  canAttackSomewhere,
  canFortifySomewhere,
  claimOwed,
  legalActions,
  legalAttackTargets,
  legalDraftTargets,
  legalFortifyMoves,
  legalNeutralClaimTargets,
  legalOwnClaimTargets,
} from "./legalActions";
import { apply } from "./reducer";
import { SEAT_NEUTRAL, SEAT_NONE, type Card } from "./types";
import { validate } from "./validate";

const inf = (id: string): Card => card(id, "infantry", null);
const cav = (id: string): Card => card(id, "cavalry", null);

function board(overrides: Parameters<typeof buildState>[1] = {}) {
  return buildState(mini, {
    seats: 3,
    owners: [0, 0, 0, 1, 2, 2],
    troops: [1, 1, 5, 3, 2, 2],
    ...overrides,
  });
}

describe("legalDraftTargets", () => {
  it("R16 — lists the seat's own territories", () => {
    expect(legalDraftTargets(board(), 0)).toEqual([0, 1, 2]);
    expect(legalDraftTargets(board(), 2)).toEqual([4, 5]);
  });

  it("R74 — excludes a blizzard", () => {
    const state = board({ owners: [0, 0, SEAT_NONE, 1, 2, 2], blizzards: [2] });
    expect(legalDraftTargets(state, 0)).toEqual([0, 1]);
  });

  it("is empty for a seat holding nothing", () => {
    expect(legalDraftTargets(board({ owners: [1, 1, 1, 1, 1, 1] }), 0)).toEqual([]);
  });
});

describe("legalAttackTargets", () => {
  it("R29 — lists the directly adjacent enemies", () => {
    expect(legalAttackTargets(board(), mini, 2)).toEqual([3]);
  });

  it("R33 — is empty from a one-troop territory", () => {
    expect(legalAttackTargets(board({ troops: [1, 1, 1, 3, 2, 2] }), mini, 2)).toEqual([]);
  });

  it("R69 — never reaches a non-neighbour, however connected the owner is", () => {
    const state = board({ owners: [0, 0, 0, 0, 2, 2], troops: [1, 1, 5, 5, 2, 2] });
    expect(legalAttackTargets(state, mini, 2)).toEqual([]);
    expect(legalAttackTargets(state, mini, 3)).toEqual([4, 5]);
  });

  it("R68 — includes an active portal's far end", () => {
    const state = board({ portals: [{ a: 2, b: 5, kind: "stable", activeFrom: 0 }] });
    expect(legalAttackTargets(state, mini, 2)).toEqual([3, 5]);
  });

  it("R74 — excludes a blizzard", () => {
    const state = board({ owners: [0, 0, 0, SEAT_NONE, 2, 2], blizzards: [3] });
    expect(legalAttackTargets(state, mini, 2)).toEqual([]);
  });

  it("R7 — includes a neutral holding", () => {
    const state = board({ owners: [0, 0, 0, SEAT_NEUTRAL, SEAT_NEUTRAL, SEAT_NEUTRAL], seats: 2 });
    expect(legalAttackTargets(state, mini, 2)).toEqual([3]);
  });

  it("is empty for an off-map source", () => {
    expect(legalAttackTargets(board(), mini, 42)).toEqual([]);
  });

  it("returns ascending ids (R91)", () => {
    const state = board({
      owners: [0, 0, 0, 1, 2, 2],
      troops: [1, 1, 5, 3, 2, 2],
      portals: [{ a: 2, b: 5, kind: "stable", activeFrom: 0 }],
    });
    const out = legalAttackTargets(state, mini, 2);
    expect([...out]).toEqual([...out].sort((a, b) => a - b));
  });
});

describe("legalFortifyMoves", () => {
  it("R66 — lists every own territory reachable through own territories", () => {
    const state = board({ owners: [0, 0, 0, 0, 2, 2], troops: [5, 1, 1, 1, 2, 2] });
    expect(legalFortifyMoves(state, mini, 0)).toEqual([1, 2, 3]);
  });

  it("R66 — needs two troops at the source", () => {
    expect(legalFortifyMoves(board({ troops: [1, 1, 1, 3, 2, 2] }), mini, 0)).toEqual([]);
  });

  it("R69 — is strictly wider than legalAttackTargets on a connected holding", () => {
    const state = board({ owners: [0, 0, 0, 0, 2, 2], troops: [5, 1, 1, 1, 2, 2] });
    expect(legalFortifyMoves(state, mini, 0).length).toBeGreaterThan(
      legalAttackTargets(state, mini, 0).length,
    );
  });

  it("canAttackSomewhere / canFortifySomewhere summarise the board", () => {
    const state = board();
    expect(canAttackSomewhere(state, mini, 0)).toBe(true);
    expect(canFortifySomewhere(state, mini, 0)).toBe(true);
    const penned = board({ owners: [0, 1, 1, 1, 1, 1], troops: [5, 1, 1, 1, 1, 1] });
    expect(canFortifySomewhere(penned, mini, 0)).toBe(false);
    expect(canAttackSomewhere(penned, mini, 0)).toBe(true);
  });
});

describe("legalActions", () => {
  it("reports in a fixed order (R91)", () => {
    const state = board({ phase: "draft", troopsToPlace: 3, rules: { alliances: true } });
    const kinds = legalActions(state, mini, 0);
    const positions = kinds.map((k) => ACTION_ORDER.indexOf(k));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("is empty once the game is over (R83)", () => {
    const state = {
      ...board(),
      outcome: { winner: 0, reason: "world" as const, tiebreak: false, round: 1 },
    };
    expect(legalActions(state, mini, 0)).toEqual([]);
  });

  it("is empty for an eliminated seat", () => {
    expect(legalActions(board({ standings: { 1: "eliminated" } }), mini, 1)).toEqual([]);
  });

  it("offers nothing to a seat whose turn it is not, unless alliances are on", () => {
    expect(legalActions(board(), mini, 1)).toEqual([]);
    const allied = board({ rules: { alliances: true } });
    // `ALLIANCE_ACCEPT` is NOT here: `validateAlliance` answers an offer, and there is none in the
    // air yet (R80, §4.7 — codex round 4, finding 2).
    expect(legalActions(allied, mini, 1)).toEqual(["ALLIANCE_PROPOSE"]);
    const offered = apply(allied, mini, { type: "ALLIANCE_PROPOSE", seat: 2, to: 1 }).state;
    expect(legalActions(offered, mini, 1)).toEqual(["ALLIANCE_PROPOSE", "ALLIANCE_ACCEPT"]);
  });

  it("R80 — offers ALLIANCE_BREAK only to a seat that holds a pact", () => {
    const state = board({ rules: { alliances: true } });
    const offered = apply(state, mini, { type: "ALLIANCE_PROPOSE", seat: 1, to: 0 }).state;
    const allied = apply(offered, mini, { type: "ALLIANCE_ACCEPT", seat: 0, from: 1 }).state;
    expect(legalActions(allied, mini, 0)).toContain("ALLIANCE_BREAK");
    expect(legalActions(allied, mini, 2)).not.toContain("ALLIANCE_BREAK");
  });

  /**
   * R80 — `ALLIANCE_ACCEPT` answers an offer in **that** direction (codex round 4, finding 2).
   *
   * The pair is directed, so my own outstanding proposal is not something I can accept: the
   * proposer must wait for the other seat. `validateAlliance` says exactly that, and the list has
   * to agree or the UI lights a button the authority refuses.
   */
  it("R80 — does not offer ALLIANCE_ACCEPT to the seat that made the offer (§4.7)", () => {
    const state = board({ rules: { alliances: true } });
    const offered = apply(state, mini, { type: "ALLIANCE_PROPOSE", seat: 1, to: 0 }).state;
    expect(legalActions(offered, mini, 1)).not.toContain("ALLIANCE_ACCEPT");
    expect(legalActions(offered, mini, 0)).toContain("ALLIANCE_ACCEPT");
    expect(validate(offered, mini, { type: "ALLIANCE_ACCEPT", seat: 1, from: 0 })?.code).toBe("notAlliable");
  });

  /**
   * R80/R84 — a **resigned** seat is out of the game's diplomacy (codex round 4, finding 5).
   *
   * It keeps taking turns (D76), which is the gate this function opens on, but it has stopped being
   * a contender — and `validateAlliance` asks for two contenders. Advertising a kind it refuses is
   * the same disagreement from the other end.
   */
  it("R80 — offers a resigned seat no alliance kinds at all", () => {
    const state = board({ rules: { alliances: true }, standings: { 1: "resigned" } });
    expect(legalActions(state, mini, 1)).toEqual([]);
    expect(validate(state, mini, { type: "ALLIANCE_PROPOSE", seat: 1, to: 2 })?.code).toBe("notAlliable");
    // And nobody may propose TO it either.
    expect(legalActions(state, mini, 2)).not.toContain("ALLIANCE_ACCEPT");
    expect(validate(state, mini, { type: "ALLIANCE_PROPOSE", seat: 2, to: 1 })?.code).toBe("notAlliable");
  });

  it("R80 — stops offering ALLIANCE_PROPOSE once every pair has an offer in the air (§4.7)", () => {
    // Two seats, so seat 1's one possible target is seat 0, and the offer below uses it up.
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      rules: { alliances: true },
    });
    expect(legalActions(state, mini, 1)).toContain("ALLIANCE_PROPOSE");
    const offered = apply(state, mini, { type: "ALLIANCE_PROPOSE", seat: 1, to: 0 }).state;
    // `validate` refuses every proposal this seat could send, so `legalActions` must not offer it.
    expect(legalActions(offered, mini, 1)).not.toContain("ALLIANCE_PROPOSE");
    expect(legalActions(offered, mini, 0)).not.toContain("ALLIANCE_PROPOSE");
    // Answering it is still on the table, which is the point.
    expect(legalActions(offered, mini, 0)).toContain("ALLIANCE_ACCEPT");
  });

  it("in claim, offers CLAIM while anything is owed", () => {
    const state = buildState(tiny4, {
      seats: 3,
      phase: "claim",
      rules: { manualPlacement: true },
      armiesToClaim: { 0: 2, 1: 2, 2: 2 },
    });
    expect(legalActions(state, tiny4, 0)).toEqual(["CLAIM"]);
  });

  it("in claim, offers nothing to a seat that has placed everything", () => {
    const state = buildState(tiny4, {
      seats: 3,
      phase: "claim",
      owners: [0, 1, 2, 0],
      rules: { manualPlacement: true },
      armiesToClaim: { 0: 0, 1: 1, 2: 1 },
    });
    expect(legalActions(state, tiny4, 0)).toEqual([]);
  });

  it("in draft, offers the draft actions while troops remain", () => {
    const state = board({ phase: "draft", troopsToPlace: 3 });
    expect(legalActions(state, mini, 0)).toEqual(["DRAFT", "AUTO_DEPLOY"]);
  });

  it("R17 — in draft, offers END_PHASE only once the counter is empty", () => {
    expect(legalActions(board({ phase: "draft", troopsToPlace: 0 }), mini, 0)).toEqual(["END_PHASE"]);
  });

  it("in draft, offers an optional TRADE_CARDS when a set is held", () => {
    const hand = [inf("a"), inf("b"), inf("c")];
    const state = board({ phase: "draft", troopsToPlace: 2, hands: { 0: hand } });
    expect(legalActions(state, mini, 0)).toEqual(["TRADE_CARDS", "DRAFT", "AUTO_DEPLOY"]);
  });

  /**
   * R24 — the forced trade is the only **play**, and diplomacy rides along (codex round 4,
   * finding 7).
   *
   * `validateAlliance` never reads the hand: it gates on `rules.alliances`, two contenders and the
   * pair. A bare `["TRADE_CARDS"]` therefore dropped kinds `validate` was accepting all along.
   */
  it("R24 — in draft with five cards and nothing traded, offers only TRADE_CARDS plus diplomacy", () => {
    const hand = [inf("a"), inf("b"), inf("c"), cav("d"), cav("e")];
    const state = board({
      phase: "draft",
      troopsToPlace: 3,
      hands: { 0: hand },
      rules: { alliances: true },
    });
    expect(legalActions(state, mini, 0)).toEqual(["TRADE_CARDS", "ALLIANCE_PROPOSE"]);
    expect(validate(state, mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 1 })).toBeNull();
    // With alliances off it really is the trade alone.
    expect(legalActions(board({ phase: "draft", troopsToPlace: 3, hands: { 0: hand } }), mini, 0))
      .toEqual(["TRADE_CARDS"]);
  });

  /**
   * R28 — a hand of seven or more is the one case where it IS `TRADE_CARDS` alone.
   *
   * `validate`'s seven-card guard refuses every action carrying that seat but the trade (and
   * `MOVE_IN`, and the administrative three), alliance actions included, so the list must shed them
   * too or the agreement property breaks.
   */
  it("R28 — with eight cards mid-trade-down, offers TRADE_CARDS and nothing else", () => {
    const hand = [inf("a"), inf("b"), inf("c"), cav("d"), cav("e"), cav("f"), inf("g"), cav("h")];
    const state = board({
      phase: "draft",
      troopsToPlace: 3,
      hands: { 0: hand },
      resumePhase: "attack",
      setsTradedThisTurn: 1,
      rules: { alliances: true },
    });
    expect(legalActions(state, mini, 0)).toEqual(["TRADE_CARDS"]);
    expect(validate(state, mini, { type: "ALLIANCE_PROPOSE", seat: 0, to: 1 })?.code).toBe("illegalAction");
  });

  it("in attack, offers the attack actions", () => {
    expect(legalActions(board({ phase: "attack" }), mini, 0)).toEqual(["ATTACK", "END_PHASE", "END_TURN"]);
  });

  it("in attack with nothing to attack, drops ATTACK", () => {
    const state = board({ phase: "attack", owners: [0, 0, 0, 0, 0, 0], troops: [5, 5, 5, 5, 5, 5] });
    expect(legalActions(state, mini, 0)).toEqual(["END_PHASE", "END_TURN"]);
  });

  it("R63 — with a move-in pending, offers ONLY MOVE_IN", () => {
    const state = { ...board({ phase: "attack" }), pendingMoveIn: { from: 2, to: 3, min: 1, max: 4 } };
    expect(legalActions(state, mini, 0)).toEqual(["MOVE_IN"]);
  });

  it("R20/R67 — offers CARD_DRAWN in fortify once something has been captured, never in attack", () => {
    expect(legalActions(board({ phase: "attack", conqueredThisTurn: true }), mini, 0)).not.toContain(
      "CARD_DRAWN",
    );
    const state = board({
      phase: "fortify",
      conqueredThisTurn: true,
      owners: [0, 0, 0, 0, 2, 2],
      troops: [5, 1, 1, 1, 2, 2],
    });
    expect(legalActions(state, mini, 0)).toEqual(["FORTIFY", "END_TURN", "CARD_DRAWN"]);
  });

  it("R67 — in fortify, offers FORTIFY and END_TURN but never END_PHASE", () => {
    const state = board({ phase: "fortify", owners: [0, 0, 0, 0, 2, 2], troops: [5, 1, 1, 1, 2, 2] });
    expect(legalActions(state, mini, 0)).toEqual(["FORTIFY", "END_TURN"]);
  });

  it("R66 — in fortify, drops FORTIFY once it has been used", () => {
    const state = board({
      phase: "fortify",
      owners: [0, 0, 0, 0, 2, 2],
      troops: [5, 1, 1, 1, 2, 2],
      fortifyUsed: true,
    });
    expect(legalActions(state, mini, 0)).toEqual(["END_TURN"]);
  });

  it("every reported kind is actually accepted by validate for some payload", () => {
    // The strongest cheap check: each listed kind has at least one accepted
    // instance, so the list never promises something the reducer refuses.
    const state = board({ phase: "attack" });
    const kinds = legalActions(state, mini, 0);
    expect(kinds).toContain("ATTACK");
    expect(
      apply(state, mini, {
        type: "ATTACK",
        seat: 0,
        from: 2,
        to: 3,
        mode: "blitz",
        attackerLosses: 1,
        defenderLosses: 1,
      }).error,
    ).toBeUndefined();
    expect(apply(state, mini, { type: "END_PHASE", seat: 0 }).error).toBeUndefined();
    expect(apply(state, mini, { type: "END_TURN", seat: 0 }).error).toBeUndefined();
  });
});

describe("claimOwed — R6's alternation, asked rather than guessed", () => {
  const twoSeat = (spec: Parameters<typeof buildState>[1] = {}) => buildState(mini, {
    seats: 2,
    phase: "claim",
    rules: { manualPlacement: true },
    armiesToClaim: { 0: 8, 1: 8 },
    ...spec,
  });

  it("asks for the seat's own army first", () => {
    const state = twoSeat({ owners: [] });
    expect(claimOwed(state, 0)).toBe("own");
  });

  it("asks for the NEUTRAL army once the seat's pair of two is complete (R6)", () => {
    // Seat 0 has placed two armies; the neutral holding is owed one.
    const state = twoSeat({ owners: [0, 0], troops: [1, 1] });
    expect(claimOwed(state, 0)).toBe("neutral");
    // Which is exactly what `validate` insists on, and nothing else.
    expect(apply(state, mini, { type: "CLAIM", seat: 0, territory: 2 }).error?.code)
      .toBe("mustPlaceAllTroops");
    expect(apply(state, mini, { type: "CLAIM", seat: 0, territory: 2, forNeutral: true }).error)
      .toBeUndefined();
  });

  it("goes back to the seat's own army once the neutral is placed", () => {
    const state = twoSeat({ owners: [0, 0, SEAT_NEUTRAL], troops: [1, 1, 1] });
    expect(claimOwed(state, 0)).toBe("own");
  });

  it("never answers `neutral` in a 3-to-6-seat game", () => {
    const state = buildState(mini, {
      seats: 3, phase: "claim", rules: { manualPlacement: true },
      armiesToClaim: { 0: 4, 1: 4, 2: 4 }, owners: [0, 0, 1, 1, 2, 2], troops: [1, 1, 1, 1, 1, 1],
    });
    expect(claimOwed(state, 0)).toBe("own");
  });

  it("answers `none` out of the claim phase, off-turn and once the seat is spent", () => {
    expect(claimOwed(twoSeat({ phase: "draft", owners: [] }), 0)).toBe("none");
    expect(claimOwed(twoSeat({ owners: [] }), 1)).toBe("none");
    expect(claimOwed(twoSeat({ owners: [], armiesToClaim: { 0: 0, 1: 0 } }), 0)).toBe("none");
  });

  it("lights the neutral's own and the unclaimed tiles for a neutral claim (R6)", () => {
    const state = twoSeat({ owners: [0, 0, SEAT_NEUTRAL], troops: [1, 1, 1] });
    expect(legalNeutralClaimTargets(state)).toEqual([2, 3, 4, 5]);
    expect(legalNeutralClaimTargets(state)).not.toContain(0);
  });

  it("lights the unclaimed tiles for an own claim, then the seat's own once the board is full", () => {
    expect(legalOwnClaimTargets(twoSeat({ owners: [0, 0], troops: [1, 1] }), 0))
      .toEqual([2, 3, 4, 5]);
    const full = twoSeat({ owners: [0, 0, 0, 1, 1, 1], troops: [1, 1, 1, 1, 1, 1] });
    expect(legalOwnClaimTargets(full, 0)).toEqual([0, 1, 2]);
  });
});
