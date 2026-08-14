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
import { drawCell, groundedFor, moveFor, usesMoveFor, verticalFor, type Options } from "./page";
import { getFighter } from "@/fighters";
import { CHARACTER_RIGS } from "@/render/characterArt";
import { createMockContext } from "@/render/mockContext";
import type { MoveSlot } from "@/engine/types";

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
   * Through `drawCell`, not through the helper.
   *
   * Every assertion above calls `groundedFor` directly, so reverting
   * `fighterAt` to its old hard-coded expression while leaving the helper
   * intact keeps them all green — and props would again be told a neutral air
   * happens on the floor. The helper is not the contract; what `drawCell`
   * hands a prop painter is.
   */
  it("hands a prop painter the airborne flag it computed", () => {
    const seen: boolean[] = [];
    const rig = CHARACTER_RIGS["pikachu"];
    const original = rig.props;
    Object.defineProperty(rig, "props", {
      value: [
        {
          kind: "custom",
          bone: "head",
          at: 1,
          size: 1,
          colour: "primary",
          draw: (_b: unknown, _p: unknown, anim: { airborne: boolean }) => seen.push(anim.airborne),
        },
      ],
      configurable: true,
      writable: true,
    });
    try {
      const cell = (over: Partial<Options>) => {
        seen.length = 0;
        drawCell(
          createMockContext(600, 600) as unknown as CanvasRenderingContext2D,
          {
            fighterId: "pikachu",
            action: "stand",
            move: "jab1",
            jumpsUsed: 0,
            fastFalling: false,
            ...over,
          },
          0,
          300,
          500,
          8,
        );
        return seen[0];
      };
      expect(cell({ action: "attack", move: "nair" }), "an aerial was drawn as grounded").toBe(true);
      expect(cell({ action: "ledgeHang" }), "a ledge hang was drawn as grounded").toBe(true);
      expect(cell({ action: "attack", move: "fsmash" }), "a grounded smash was drawn airborne").toBe(false);
    } finally {
      Object.defineProperty(rig, "props", { value: original, configurable: true, writable: true });
    }
  });

  it("treats hanging off a ledge as being in the air", () => {
    // A ledge is grabbed from the air and nothing re-grounds a hanging fighter.
    for (const action of ["ledgeHang", "ledgeJump"] as const) {
      expect(groundedFor(opts({ action })), `${action} is on the floor`).toBe(false);
    }
  });

  it("treats a tumble as being in the air", () => {
    // A tumbling fighter who touches the ground becomes `downed` on that frame,
    // so a frame that is still `tumble` is airborne by construction.
    expect(groundedFor(opts({ action: "tumble" }))).toBe(false);
  });

  it("uses the second jump's own velocity when the second jump is selected", () => {
    // `airJumpVelocity` differs from `fullHopVelocity` for DK, Fox and Kirby,
    // and the lab offers the choice — so taking the first jump's number for
    // both made the option a lie for exactly the fighters it matters to.
    const fox = getFighter("fox")!.attributes;
    expect(fox.airJumpVelocity, "Fox's two jumps are the same speed").not.toBe(fox.fullHopVelocity);
    const first = verticalFor(opts({ action: "jump", jumpsUsed: 1 }), fox, 0);
    const second = verticalFor(opts({ action: "jump", jumpsUsed: 2 }), fox, 0);
    expect(second, "the second jump borrowed the first's velocity").not.toBe(first);
    expect(second).toBe(fox.airJumpVelocity - fox.gravity * 0);
  });

  it("falls at the fighter's own terminal speed, faster when fast-falling", () => {
    const fox = getFighter("fox")!.attributes;
    const normal = verticalFor(opts({ action: "fall" }), fox, 10);
    const fast = verticalFor(opts({ action: "fall", fastFalling: true }), fox, 10);
    expect(normal, "a fall is not downward").toBeLessThan(0);
    expect(fast, "fast-falling is not faster").toBeLessThan(normal);
  });

  it("leaves a grounded state at rest", () => {
    expect(verticalFor(opts({ action: "stand" }), getFighter("fox")!.attributes, 5)).toBe(0);
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
