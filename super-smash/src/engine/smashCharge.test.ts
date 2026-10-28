/**
 * A held smash through the real `step()`, for every smash on the roster: it
 * hits nothing while it charges, and the swing after the release lands scaled
 * by the charge.
 *
 * `chargeHoldFrame` parks the move while the attack is held. Parked on a frame
 * where a hitbox is live, the charge is itself an attack: an opponent standing
 * in reach (or rolling into it) is hit at about 1.0× while the wind-up pose is
 * held, the hit uses up the swing, and the release whiffs. Nothing else pins
 * that, because the golden script releases its smash at once and the CPU never
 * holds one.
 *
 * The second half is the rule itself, read off every chargeable move on the
 * roster (smashes and specials alike, not just the smashes the step() tests
 * above drive): the hold frame comes before the move's earliest live frame.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { mul } from "./fixed";
import { actionFrameOf, chargeHoldFrame } from "./hitbox";
import { computeStaleness } from "./knockback";
import { createInitialState, registerFighters, registerStages, step } from "./simulate";
import { chargeMultiplier } from "./states";
import { Btn } from "./types";
import type { FighterDef, GameState, Hitbox, InputFrame, MatchRules, MoveDef, MoveSlot } from "./types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };
/** Past the entry drop's intangibility, so the victim can be hit. */
const SETTLE = 120;
/** Long enough to reach the latest hold frame on the roster (Donkey Kong's forward smash) and charge past it. */
const HELD = 40;
const SMASHES = [
  ["fsmash", Btn.Right],
  ["usmash", Btn.Up],
  ["dsmash", Btn.Down],
] as const;

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** The move's earliest hitbox (lowest `startFrame`), which is where the victim stands. */
function earliest(def: FighterDef, slot: MoveSlot): Hitbox {
  const hitboxes = def.moves[slot]?.hitboxes ?? [];
  expect(hitboxes.length, `${def.id} ${slot} has no hitbox`).toBeGreaterThan(0);
  return hitboxes.reduce((a, b) => (b.startFrame < a.startFrame ? b : a));
}

interface Frame {
  readonly held: boolean;
  readonly charge: number;
  readonly actionFrame: number;
  readonly hits: readonly { damage: number; hitboxId: number }[];
}

/** Smash `slot` at a victim standing on its earliest hitbox; hold the attack `HELD` frames, then let go. */
function chargeAt(def: FighterDef, slot: MoveSlot, dir: Btn): Frame[] {
  let s: GameState = createInitialState("finalDestination", [{ defId: def.id }, { defId: "mario" }], RULES, 7);
  for (let i = 0; i < SETTLE; i++) s = step(s, [0, 0], { prevInputs: [0, 0] }).state;
  const [attacker, victim] = s.fighters;
  const hb = earliest(def, slot);
  victim.x = attacker.x + (attacker.facing >= 0 ? hb.x : -hb.x);
  const inputs: InputFrame[] = [
    dir | Btn.Attack,
    ...Array<InputFrame>(HELD).fill(Btn.Attack),
    ...Array<InputFrame>(120).fill(0),
  ];
  let prev: InputFrame = 0;
  const out: Frame[] = [];
  for (const input of inputs) {
    const next = step(s, [input, 0], { prevInputs: [prev, 0] });
    s = next.state;
    prev = input;
    const f = s.fighters[0];
    out.push({
      held: (input & Btn.Attack) !== 0,
      charge: f.charge,
      actionFrame: f.actionFrame,
      hits: next.events.hits.filter((h) => h.attacker === 0),
    });
    if (f.move !== slot) break;
  }
  return out;
}

describe("a held smash attack", () => {
  for (const def of FIGHTERS) {
    it.each(SMASHES)(`${def.id} %s: hits nothing while held, then lands scaled by the charge`, (slot, dir) => {
      const frames = chargeAt(def, slot, dir);

      const heldHits = frames.flatMap((f) => (f.held ? f.hits.map(() => `actionFrame ${f.actionFrame}, charge ${f.charge}`) : []));
      expect(heldHits, "a hit while the attack was still held").toEqual([]);

      const charge = frames.findLast((f) => f.held)?.charge ?? 0;
      expect(charge, "the smash never charged").toBeGreaterThan(0);

      const landed = frames.find((f) => !f.held && f.hits.length > 0);
      expect(landed, "the released swing never landed").toBeDefined();
      const hit = (landed as Frame).hits[0];
      const moveFrame = (landed as Frame).actionFrame + 1;
      const hb = def.moves[slot]?.hitboxes.find(
        (h) => h.id === hit.hitboxId && h.startFrame <= moveFrame && moveFrame <= h.endFrame,
      );
      expect(hb, `no hitbox ${hit.hitboxId} live on move frame ${moveFrame}`).toBeDefined();
      const fresh = computeStaleness([], slot).damage;
      expect(hit.damage).toBe(mul(mul((hb as Hitbox).damage, chargeMultiplier(charge)), fresh));
    });
  }
});

describe("chargeHoldFrame, for every chargeable move on the roster", () => {
  const chargeable = FIGHTERS.flatMap((def) =>
    (Object.entries(def.moves) as [MoveSlot, MoveDef | undefined][]).flatMap(([slot, move]) =>
      move?.chargeable ? [{ name: `${def.id} ${slot}`, slot, move }] : [],
    ),
  );

  it("covers the 24 smashes and the chargeable specials, so the rule below is not vacuous", () => {
    const smashes = chargeable.filter(({ slot }) => SMASHES.some(([smash]) => smash === slot));
    expect(smashes).toHaveLength(FIGHTERS.length * SMASHES.length);
    expect(chargeable.length, "no chargeable special on the roster").toBeGreaterThan(smashes.length);
  });

  it.each(chargeable.map((c) => [c.name, c.move] as const))("%s holds before its earliest live frame", (_name, move) => {
    if (move.hitboxes.length === 0) return; // nothing live to hold before
    const earliestLive = actionFrameOf(Math.min(...move.hitboxes.map((h) => h.startFrame)));
    expect(chargeHoldFrame(move)).toBeLessThan(earliestLive);
  });
});
