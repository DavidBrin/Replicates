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
import { moveFor, usesMoveFor, type Options } from "./page";

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
