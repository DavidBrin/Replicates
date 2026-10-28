/**
 * A charged smash attack through the real `step()`: the pose parks on its
 * wind-up while the button is held, and swings once it is let go.
 *
 * `charge` alone cannot tell those two apart. The engine counts it up while the
 * attack is held and then leaves it, frozen, until the move ends (the swing's
 * damage reads it), so a pose layer that parked whenever `charge > 0` held a
 * released smash on its wind-up through the whole swing.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn, type FighterState, type GameState, type InputFrame, type MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { moveTimingFor, poseNameFor, poseTimeFor } from "./timing";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };
/** Long enough to reach the latest hold frame on the roster (Donkey Kong's forward smash, 21) and charge well past it. */
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

/** The fighter after each frame of: smash, hold the attack for `HELD` frames, let go. */
function chargedSmash(id: string, dir: Btn): FighterState[] {
  let s: GameState = createInitialState("finalDestination", [{ defId: id }], RULES, 7);
  for (let i = 0; i < 80; i++) s = step(s, [0], { prevInputs: [0] }).state;
  const inputs: InputFrame[] = [
    dir | Btn.Attack,
    ...Array<InputFrame>(HELD).fill(Btn.Attack),
    ...Array<InputFrame>(120).fill(0),
  ];
  let prev: InputFrame = 0;
  const out: FighterState[] = [];
  for (const input of inputs) {
    s = step(s, [input], { prevInputs: [prev] }).state;
    prev = input;
    out.push(s.fighters[0]);
  }
  return out;
}

describe("a charged smash attack's pose", () => {
  for (const def of FIGHTERS) {
    it.each(SMASHES)(`${def.id} %s: parks while the attack is held, swings once it is let go`, (slot, dir) => {
      const all = chargedSmash(def.id, dir);
      const end = all.findIndex((f) => f.move !== slot);
      expect(end, "the move never finished inside the run").toBeGreaterThan(0);
      const frames = all.slice(0, end);
      const timing = moveTimingFor(def, slot);
      const time = (f: FighterState) => poseTimeFor(poseNameFor(f), f, 0, timing);

      // The engine's own account of which frames charged: `charge` rises on
      // each of them, and stays where it stopped once the button is up.
      const charging = frames.filter((f, i) => f.charge > 0 && f.charge > (frames[i - 1]?.charge ?? 0));
      const released = frames.filter((f, i) => f.charge > 0 && f.charge === frames[i - 1]?.charge);
      expect(charging.length, "the smash never charged").toBeGreaterThan(1);
      expect(released.length, "nothing of the swing was left after the charge").toBeGreaterThan(1);

      const parked = time(charging[0]);
      for (const f of charging) expect(time(f), `charging, frame ${f.actionFrame}`).toBe(parked);
      // Once let go, the swing plays exactly as an uncharged one does on the same frame.
      for (const f of released) {
        expect(time(f), `released, frame ${f.actionFrame}`).toBe(time({ ...f, charge: 0 }));
      }
      expect(time(released[0]), "the release did not move the pose on").toBeGreaterThan(parked);
    });
  }
});
