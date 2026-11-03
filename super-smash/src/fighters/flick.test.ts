/**
 * A right-stick flick, and Attack, out of shield, and a flick while holding someone (Plan 6,
 * Task 5), through `step()` on the real roster. SmashWiki "C-Stick"
 * (https://www.ssbwiki.com/C-Stick): "The C-Stick can also be used to roll or sidestep out of
 * shield"; SmashWiki "Out of shield" (https://www.ssbwiki.com/Out_of_shield): flicking it
 * "upward while shielding" is "an immediate up smash out of shield", and the stick's up smash
 * comes "with an up smash input". SmashWiki "Grab" (https://www.ssbwiki.com/Grab): a grab "can
 * be performed by pressing the shield and attack buttons simultaneously" (ruling R-P6-14). In a
 * grab the flick throws its way (ruling D1, UNVERIFIED: no page says whether the hold reads the
 * stick or the button first).
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** A smash-mode flick's fire frame: its direction and Attack fresh, with `Btn.Flick`. */
const flick = (dir: Btn, held: InputFrame = 0): InputFrame => held | dir | Btn.Attack | Btn.Flick;

/** Mario on Final Destination, facing right, in `action`, Fox standing well away. */
function mario(over: Partial<GameState["fighters"][number]>): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 5);
  Object.assign(s.fighters[0], { grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0, ...over });
  Object.assign(s.fighters[1], { grounded: true, platform: 0, x: fx(60), y: 0, facing: -1, intangible: 0 });
  return s;
}

/** Step port 0 through `inputs`, port 1 idle; the state after each step. */
function run(s0: GameState, inputs: readonly InputFrame[]): GameState[] {
  let s = s0;
  let prev: InputFrame[] = [0, 0];
  const out: GameState[] = [];
  for (const i of inputs) {
    const now: InputFrame[] = [i, 0];
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

describe("out of shield (Plan 6, Task 5)", () => {
  const shielding = () => mario({ action: "shield", actionFrame: 10 });

  it("a flick rolls the way it is flicked", () => {
    const [after] = run(shielding(), [Btn.Shield | flick(Btn.Right)]);
    expect(after.fighters[0].action).toBe("roll");
  });

  it("a flick down spot-dodges", () => {
    const [after] = run(shielding(), [Btn.Shield | flick(Btn.Down)]);
    expect(after.fighters[0].action).toBe("spotDodge");
  });

  it("a flick up up-smashes", () => {
    const [after] = run(shielding(), [Btn.Shield | flick(Btn.Up)]);
    expect(after.fighters[0].action).toBe("attack");
    expect(after.fighters[0].move).toBe("usmash");
  });

  it("Attack alone grabs: shield and attack together (SmashWiki \"Grab\"; ruling R-P6-14)", () => {
    const [after] = run(shielding(), [Btn.Shield | Btn.Attack]);
    expect(after.fighters[0].action).toBe("grab");
  });

  it("Up and Attack together up-smash: the stick's up smash input (SmashWiki \"Out of shield\")", () => {
    const [after] = run(shielding(), [Btn.Shield | Btn.Up | Btn.Attack]);
    expect(after.fighters[0].action).toBe("attack");
    expect(after.fighters[0].move).toBe("usmash");
  });
});

describe("a flick while holding someone (Plan 6, Task 5; ruling D1)", () => {
  function holding(): GameState {
    const s = mario({ action: "grabHold", actionFrame: 0, x: fx(-4), grabbing: 1 });
    Object.assign(s.fighters[1], { action: "grabbed", actionFrame: 0, x: fx(4), facing: -1, grabbedBy: 0, grabTimer: 500 });
    return s;
  }

  it("throws the way it is flicked: down is the down throw", () => {
    const [after] = run(holding(), [flick(Btn.Down)]);
    expect(after.fighters[0].action).toBe("throw");
    expect(after.fighters[0].move).toBe("dthrow");
  });

  it("back is the back throw", () => {
    const [after] = run(holding(), [flick(Btn.Left)]);
    expect(after.fighters[0].move).toBe("bthrow");
  });

  it("Attack alone still pummels", () => {
    const [after] = run(holding(), [Btn.Attack]);
    expect(after.fighters[0].action).toBe("pummel");
  });
});
