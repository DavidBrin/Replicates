// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createInitialState, rngFor, viewFor, SEAT_UNKNOWN } from "@/engine";
import type { Card, GameConfig, GameState, Rules } from "@/engine/types";
import { DEFAULT_RULES } from "@/engine/types";
import { classicWorld } from "@/engine/__fixtures__/maps";
import type { LoggedAction } from "@/ports/sync";

import { realServerEngine } from "../engine";
import { redactForSeat, redactLogForSeat } from "../redact";

/**
 * Per-viewer log redaction for a fog poll (SPEC §5.5, R73, F36).
 *
 * On a **real** map, deliberately: `tiny4` is four territories in a ring, so
 * every territory is adjacent to one of yours and a fog view masks nothing at
 * all — a redaction suite on it passes whatever the code does. Classic World
 * is 42 territories across six continents, which is the first map where "the
 * viewer cannot see this" is a state the fixtures can actually reach.
 */

const FOG_RULES: Rules = { ...DEFAULT_RULES, fogOfWar: true, turnSeconds: 90 };

/** A real opening on Classic World, and seat 0's masked view of it. */
function fogged(): { state: GameState; view: GameState } {
  const config: GameConfig = {
    mapSlug: classicWorld.slug,
    rules: FOG_RULES,
    seats: [
      { kind: "human", name: "Alpha", colour: "red", tier: null },
      { kind: "human", name: "Bravo", colour: "blue", tier: null },
    ],
    seed: "redaction-fixture",
  };
  const started = realServerEngine.dealTerritories(classicWorld, config, [null, null], {
    deal: rngFor(config.seed, "deal", 0),
    turnOrder: rngFor(config.seed, "turnOrder", 0),
    modifierPlace: rngFor(config.seed, "modifierPlace", 0),
  });
  const state = createInitialState(classicWorld, started);
  return { state, view: viewFor(state, classicWorld, 0) };
}

/** A territory seat 0's own view has blanked. */
function unseen(view: GameState): number {
  const at = view.territories.findIndex((row) => row.owner === SEAT_UNKNOWN);
  if (at < 0) throw new Error("the fixture map masks nothing — the suite would be vacuous");
  return at;
}

/** The card that names `territory`, exactly as `drawCard` would mint it. */
function cardFor(territory: number): Card {
  const row = classicWorld.territories[territory];
  if (!row) throw new Error(`no territory ${String(territory)}`);
  return { id: row.id, suit: row.suit, territory };
}

function row(seq: number, action: LoggedAction["action"], seat = 0): LoggedAction {
  return { seq, seat, action, actor: "server", clientActionId: null, stateHash: `h${seq}` };
}

describe("a fog viewer's own CARD_DRAWN", () => {
  /**
   * R19 deals off the whole deck, so the card a seat earns names a territory
   * anywhere on the board — and on a 42-territory map most of the board is
   * somewhere the viewer cannot see. Letting their own award fall through to
   * the generic "every territory it names must be visible" test therefore
   * replaced it with `{ type: "HIDDEN" }` most of the time: the player was told
   * *somebody* had drawn a card, having just drawn it themselves, and the
   * "you earned a card" beat had nothing to animate off.
   */
  it("goes out whole even when the card names a territory they cannot see", () => {
    const { view } = fogged();
    const hidden = unseen(view);
    const mine = row(7, { type: "CARD_DRAWN", seat: 0, card: cardFor(hidden) });

    const redacted = redactForSeat(mine, { seat: 0, state: view });

    // Not merely equal: untouched.
    expect(redacted).toBe(mine);
    expect(redacted?.action).toMatchObject({
      type: "CARD_DRAWN",
      seat: 0,
      card: { territory: hidden },
    });
  });

  it("still loses another seat's card, hidden territory or not", () => {
    const { view } = fogged();
    const hidden = unseen(view);
    const theirs = row(8, { type: "CARD_DRAWN", seat: 1, card: cardFor(hidden) }, 1);

    expect(redactForSeat(theirs, { seat: 0, state: view })?.action).toEqual({
      type: "CARD_DRAWN",
      seat: 1,
      card: null,
    });
  });

  it("keeps hiding everything else that names what the viewer cannot see", () => {
    const { view } = fogged();
    const hidden = unseen(view);
    const visible = view.territories.findIndex((candidate) => candidate.owner === 0);

    const out = redactLogForSeat(
      [
        row(9, { type: "DRAFT", seat: 1, territory: hidden, count: 2 }, 1),
        row(10, { type: "DRAFT", seat: 0, territory: visible, count: 2 }),
        row(11, { type: "CARD_DRAWN", seat: 0, card: cardFor(hidden) }),
      ],
      { seat: 0, state: view },
    );

    expect(out.map((line) => line.action.type)).toEqual(["HIDDEN", "DRAFT", "CARD_DRAWN"]);
    // The exemption is for the viewer's own card and nothing else: the same
    // hidden territory in a `DRAFT` is still hidden.
    expect(out[0]?.action).toEqual({ type: "HIDDEN", seat: 1 });
  });
});
