/**
 * The lab must show the move the action actually performs.
 *
 * The move dropdown is hidden for an action that does not take one, but the
 * *value* behind it stays at whatever was last picked. That was harmless while
 * `drawMoveFx` refused to draw during a grab; the moment it learned to, the lab
 * started painting Mario's fire palm over his grab, and reporting the fallback
 * frame count instead of the grab's own.
 *
 * Silent in both directions — a wrong graphic on a correct pose looks like the
 * pose being wrong — so it is worth a test rather than a second look.
 */

import { describe, expect, it } from "vitest";
import { FIGHTERS } from "@/fighters";
import type { ActionState } from "@/engine/types";
import { fighterAt, groundedFor, lengthFor, moveFor, usesMoveFor, verticalFor, type Options } from "./page";
import { getFighter } from "@/fighters";
import { jumpRiseSpeeds } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
import type { MoveSlot } from "@/engine/types";
import { readBakeFromDisk } from "@/game/bakeNode";

const opts = (over: Partial<Options> = {}): Options => ({
  fighterId: "mario",
  action: "attack",
  move: "fsmash",
  jumpsUsed: 0,
  fastFalling: false,
  ...over,
});

describe("which move the lab is showing", () => {
  it("uses the chosen slot for an action that offers a choice", () => {
    for (const action of ["attack", "special", "throw"] as ActionState[]) {
      expect(moveFor(opts({ action, move: "dair" }))).toBe("dair");
    }
  });

  it("performs the grab when the action is a grab, whatever was last picked", () => {
    expect(moveFor(opts({ action: "grab", move: "fsmash" }))).toBe("grab");
  });

  it("treats a grab as having frame data of its own", () => {
    // The consequence that made the stale move visible: a grab is one of the
    // actions `drawMoveFx` draws for, so it needs its real length too.
    expect(usesMoveFor("grab")).toBe(true);
    for (const action of ["attack", "special", "throw"] as ActionState[]) {
      expect(usesMoveFor(action)).toBe(true);
    }
  });

  it("claims no frame data for an action that performs no move", () => {
    for (const action of ["stand", "walk", "roll", "hitstun", "ledgeHang"] as ActionState[]) {
      expect(usesMoveFor(action), action).toBe(false);
    }
  });

  it("names a slot every fighter actually has", () => {
    // A slot nobody declares would fall back to the 40-frame guess again.
    for (const def of FIGHTERS) {
      expect(def.moves[moveFor(opts({ action: "grab" }))], `${def.id} has no grab`).toBeDefined();
    }
  });
});

/**
 * The lab has to agree with the match about whether a fighter is in the air.
 *
 * Silent by construction: the drawing is identical either way, and only a prop
 * that reads `airborne` behaves differently — so a neutral air reviewed in the
 * lab showed Pikachu's tail hanging as if he were standing on the floor, and
 * nothing on screen said so.
 *
 * This is the third disagreement between the authoring view and the renderer
 * found in one pass, after the prop velocity the lab never passed at all and
 * the rim width it sized by its own formula. An authoring tool that quietly
 * differs from the thing it authors for is worse than no tool.
 */
describe("whether the lab thinks a fighter is on the ground", () => {
  const opts = (over: Partial<Options>): Options => ({
    fighterId: "pikachu",
    action: "stand",
    move: "jab1",
    jumpsUsed: 0,
    fastFalling: false,
    ...over,
  });

  it("puts every aerial in the air, whatever action wraps it", () => {
    // Every wrapper, because the claim is "whatever action wraps it" and
    // hard-coding `attack` let an implementation that special-cased attacks
    // pass while reporting the same slots as grounded under the others.
    for (const action of ["attack", "special", "throw", "grab"] as const) {
      for (const move of ["nair", "fair", "bair", "uair", "dair"] as MoveSlot[]) {
        if (!usesMoveFor(action)) continue;
        // A grab performs the grab, not the selected move — `moveFor` says so.
        const expected = action === "grab";
        expect(groundedFor(opts({ action, move })), `${action}/${move}`).toBe(expected);
      }
    }
  });

  /**
   * Through `fighterAt`, not through the helper.
   *
   * Every assertion above calls `groundedFor` directly, so reverting
   * `fighterAt` to its old hard-coded expression while leaving the helper
   * intact keeps them all green. The helper is not the contract; the fighter
   * the contact sheet poses (`Lab3D` poses `fighterAt`) is.
   */
  it("hands the sheet's fighter the airborne flag it computed", () => {
    const at = (over: Partial<Options>) => fighterAt(opts(over), 0).grounded;
    expect(at({ action: "attack", move: "nair" }), "an aerial was posed as grounded").toBe(false);
    expect(at({ action: "ledgeHang" }), "a ledge hang was posed as grounded").toBe(false);
    expect(at({ action: "attack", move: "fsmash" }), "a grounded smash was posed airborne").toBe(true);
  });

  it("treats hanging off a ledge as being in the air", () => {
    // A ledge is grabbed from the air and nothing re-grounds a hanging fighter;
    // one whose ledge was taken falls from it (Plan 3, Task 15).
    for (const action of ["ledgeHang", "ledgeJump", "ledgeTrumped"] as const) {
      expect(groundedFor(opts({ action })), `${action} is on the floor`).toBe(false);
    }
  });

  it("treats a tumble as being in the air", () => {
    // A tumbling fighter who touches the ground becomes `downed` on that frame,
    // so a frame that is still `tumble` is airborne by construction.
    expect(groundedFor(opts({ action: "tumble" }))).toBe(false);
  });

  it("uses the second jump's own rise when the second jump is selected", () => {
    // A full hop and a midair jump rise differently for every fighter (a full
    // hop has its initial height) — the lab offers the choice, so it has to
    // honour it, and with the engine's own numbers (`jumpRiseSpeeds`).
    const fox = getFighter("fox")!;
    const p = fighterParams(fox);
    const first = verticalFor(opts({ action: "jump", jumpsUsed: 1 }), fox, 0);
    const second = verticalFor(opts({ action: "jump", jumpsUsed: 2 }), fox, 0);
    expect(second, "the second jump borrowed the first's speed").not.toBe(first);
    expect(first).toBe(jumpRiseSpeeds(p, "full")[0]);
    expect(second).toBe(jumpRiseSpeeds(p, "air", 0)[0]);
    expect(verticalFor(opts({ action: "jump", jumpsUsed: 2 }), fox, 5)).toBe(jumpRiseSpeeds(p, "air", 0)[5]);
  });

  it("falls at the fighter's own terminal speed, faster when fast-falling", () => {
    const fox = getFighter("fox")!;
    const p = fighterParams(fox);
    const normal = verticalFor(opts({ action: "fall" }), fox, 10);
    const fast = verticalFor(opts({ action: "fall", fastFalling: true }), fox, 10);
    expect(normal).toBe(-p.air_speed_y_stable);
    expect(fast).toBe(-p.dive_speed_y);
  });

  it("leaves a grounded state at rest", () => {
    expect(verticalFor(opts({ action: "stand" }), getFighter("fox")!, 5)).toBe(0);
  });

  it("keeps a grounded attack on the ground", () => {
    for (const move of ["jab1", "ftilt", "fsmash", "dsmash", "dashAttack"] as MoveSlot[]) {
      expect(groundedFor(opts({ action: "attack", move })), `${move} is floating`).toBe(true);
    }
  });

  it("still trusts the airborne states by name", () => {
    for (const action of ["jump", "fall", "airDodge"] as const) {
      expect(groundedFor(opts({ action }))).toBe(false);
    }
  });

  it("ignores a stale aerial selection on an action that performs no move", () => {
    // The move dropdown keeps its last value when hidden, so `stand` can be
    // carrying `nair`. A fighter standing still is standing still.
    expect(groundedFor(opts({ action: "stand", move: "nair" }))).toBe(true);
  });
});

/**
 * The fighter the model sheet poses on each cell, and how many cells there are
 * (Plan 4, Task 21). Both are what the sim's own tables say, because the sheet
 * is tuned against the limbs and boxes the game plays.
 */
describe("what the model sheet shows", () => {
  const opts = (over: Partial<Options> = {}): Options => ({
    fighterId: "mario",
    action: "attack",
    move: "ftilt",
    jumpsUsed: 0,
    fastFalling: false,
    ...over,
  });

  it("poses cell i as a fighter i frames into the action, on the move the action performs", () => {
    for (const i of [0, 4, 24]) {
      const f = fighterAt(opts(), i);
      expect(f.actionFrame).toBe(i);
      expect(f.action).toBe("attack");
      expect(f.move).toBe("ftilt");
      expect(f.defId).toBe("mario");
    }
    // A grab performs the grab, whatever the dropdown still says.
    expect(fighterAt(opts({ action: "grab", move: "fsmash" }), 3).move).toBe("grab");
  });

  it("is as long as the game's own move: four slots' published lengths differ from the legacy table's", () => {
    const bake = readBakeFromDisk();
    // The game's lengths come from the imported scripts' first actionable frame (`withLimbScripts`):
    // FAF − 1, UltimateFrameData's own column (https://ultimateframedata.com).
    for (const [fighterId, move, legacy, game] of [
      ["mario", "uair", 30, 31],
      ["kirby", "nair", 52, 54],
      ["kirby", "uair", 35, 37],
      ["fox", "nair", 38, 41],
      // Where they agree, the bake changes nothing.
      ["mario", "ftilt", 25, 25],
    ] as const) {
      const o = opts({ fighterId, move });
      expect(lengthFor(o, null), `${fighterId} ${move} before the bake`).toBe(legacy);
      expect(lengthFor(o, bake), `${fighterId} ${move} with the bake`).toBe(game);
    }
  });

  it("leaves an action that is not a move alone", () => {
    const bake = readBakeFromDisk();
    for (const action of ["land", "stand", "roll"] as const) {
      expect(lengthFor(opts({ action }), bake), action).toBe(lengthFor(opts({ action }), null));
    }
  });
});
