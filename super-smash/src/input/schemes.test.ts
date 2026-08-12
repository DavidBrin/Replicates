import { describe, expect, it } from "vitest";

import { Btn } from "@/engine/types";
import {
  ACTION_BUTTON,
  CONFIG_ARROWS,
  CONFIG_LOCAL_P2,
  CONFIG_WASD,
  GAME_ACTIONS,
  SCHEMES,
  SchemeConflictError,
  assertSchemesCompatible,
  conflictFreeSelection,
  detectConflicts,
  isCodeAvailable,
  rebind,
  schemeCodes,
  schemeById,
  schemesConflict,
} from "./schemes";

/** The six keys Configs 1 and 2 fight over, because they are mirror images. */
const MIRROR_COLLISIONS = ["ArrowLeft", "ArrowRight", "ArrowUp", "KeyA", "KeyD", "KeyW"];

describe("preset integrity", () => {
  it("binds every action in every preset", () => {
    for (const scheme of SCHEMES) {
      for (const action of GAME_ACTIONS) {
        expect(scheme.bindings[action], `${scheme.id}.${action}`).toBeTruthy();
      }
    }
  });

  it("gives each action its own key within a preset", () => {
    for (const scheme of SCHEMES) {
      const codes = schemeCodes(scheme);
      expect(new Set(codes).size, `${scheme.id} has a duplicate binding`).toBe(codes.length);
      expect(detectConflicts([scheme])).toEqual([]);
    }
  });

  it("maps each action to a distinct input bit", () => {
    const bits = GAME_ACTIONS.map((a) => ACTION_BUTTON[a]);
    expect(new Set(bits).size).toBe(GAME_ACTIONS.length);
    expect(ACTION_BUTTON.jump).toBe(Btn.Jump);
    expect(ACTION_BUTTON.left).toBe(Btn.Left);
  });

  it("looks presets up by id", () => {
    expect(schemeById("arrows")).toBe(CONFIG_ARROWS);
    expect(schemeById("nope")).toBeUndefined();
  });
});

describe("the mirrored presets collide, by construction", () => {
  it("finds exactly the six shared physical keys", () => {
    const conflicts = detectConflicts([CONFIG_ARROWS, CONFIG_WASD]);
    expect(conflicts.map((c) => c.code)).toEqual(MIRROR_COLLISIONS);
  });

  it("reports which action each side wanted the key for", () => {
    const conflicts = detectConflicts([CONFIG_ARROWS, CONFIG_WASD]);
    const byCode = new Map(conflicts.map((c) => [c.code, c.claims]));

    // KeyW is Config 1's jump and Config 2's up; ArrowLeft is Config 1's left
    // and Config 2's special. A keydown cannot say which was meant.
    expect(byCode.get("KeyW")).toEqual([
      { schemeId: "arrows", action: "jump" },
      { schemeId: "wasd", action: "up" },
    ]);
    expect(byCode.get("ArrowLeft")).toEqual([
      { schemeId: "arrows", action: "left" },
      { schemeId: "wasd", action: "special" },
    ]);
  });

  it("says so via schemesConflict", () => {
    expect(schemesConflict(CONFIG_ARROWS, CONFIG_WASD)).toBe(true);
  });

  it("refuses to activate both", () => {
    expect(() => assertSchemesCompatible([CONFIG_ARROWS, CONFIG_WASD])).toThrow(SchemeConflictError);
    try {
      assertSchemesCompatible([CONFIG_ARROWS, CONFIG_WASD]);
    } catch (error) {
      const err = error as SchemeConflictError;
      expect(err.conflicts).toHaveLength(6);
      expect(err.message).toContain("Local P2");
    }
  });
});

describe("Config 3 is the second seat", () => {
  it("collides with neither of the other two", () => {
    expect(detectConflicts([CONFIG_ARROWS, CONFIG_LOCAL_P2])).toEqual([]);
    expect(detectConflicts([CONFIG_WASD, CONFIG_LOCAL_P2])).toEqual([]);
    expect(schemesConflict(CONFIG_ARROWS, CONFIG_LOCAL_P2)).toBe(false);
    expect(schemesConflict(CONFIG_WASD, CONFIG_LOCAL_P2)).toBe(false);
  });

  it("still reports only the mirror pair when all three are checked together", () => {
    const conflicts = detectConflicts(SCHEMES);
    expect(conflicts.map((c) => c.code)).toEqual(MIRROR_COLLISIONS);
    for (const conflict of conflicts) {
      expect(conflict.claims.some((c) => c.schemeId === CONFIG_LOCAL_P2.id)).toBe(false);
    }
  });

  it("anchors on no modifier, and on nothing the browser or OS owns", () => {
    const forbidden = [
      "ShiftLeft",
      "ShiftRight",
      "ControlLeft",
      "ControlRight",
      "AltLeft",
      "AltRight",
      "MetaLeft",
      "MetaRight",
      "Space",
      "Enter",
      "Tab",
      "Escape",
      "Backspace",
    ];
    for (const code of schemeCodes(CONFIG_LOCAL_P2)) {
      expect(forbidden).not.toContain(code);
      expect(code.startsWith("Numpad"), `${code} is not on a laptop`).toBe(false);
    }
  });

  it("keeps movement and actions in different regions of the matrix", () => {
    const movement = ["up", "down", "left", "right"] as const;
    const actions = ["attack", "special", "shield", "jump", "grab"] as const;
    const movementKeys = movement.map((a) => CONFIG_LOCAL_P2.bindings[a]);
    const actionKeys = actions.map((a) => CONFIG_LOCAL_P2.bindings[a]);

    // Left-centre inverted-T versus right-centre cluster: no key appears in
    // both halves, so a direction and an action are never matrix neighbours.
    expect(movementKeys.sort()).toEqual(["KeyF", "KeyG", "KeyH", "KeyT"]);
    expect(actionKeys.sort()).toEqual(["KeyI", "KeyJ", "KeyL", "KeyO", "KeyU"]);
    expect(movementKeys.some((k) => actionKeys.includes(k))).toBe(false);
  });
});

describe("selection and rebinding", () => {
  it("drops the later of two colliding schemes and says why", () => {
    const { active, rejected } = conflictFreeSelection([CONFIG_ARROWS, CONFIG_WASD, CONFIG_LOCAL_P2]);
    expect(active.map((s) => s.id)).toEqual(["arrows", "localP2"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].scheme.id).toBe("wasd");
    expect(rejected[0].conflicts.map((c) => c.code)).toEqual(MIRROR_COLLISIONS);
  });

  it("keeps whichever preset was chosen first", () => {
    const { active } = conflictFreeSelection([CONFIG_WASD, CONFIG_ARROWS]);
    expect(active.map((s) => s.id)).toEqual(["wasd"]);
  });

  it("reports which keys are still free", () => {
    expect(isCodeAvailable("KeyZ", [CONFIG_ARROWS, CONFIG_LOCAL_P2])).toBe(true);
    expect(isCodeAvailable("KeyT", [CONFIG_ARROWS, CONFIG_LOCAL_P2])).toBe(false);
  });

  it("refuses a rebind onto a key another live player holds", () => {
    expect(() => rebind(CONFIG_LOCAL_P2, "shield", "KeyE", [CONFIG_ARROWS])).toThrow(
      SchemeConflictError,
    );
  });

  it("accepts a rebind onto a free key, without mutating the preset", () => {
    const next = rebind(CONFIG_LOCAL_P2, "shield", "KeyM", [CONFIG_ARROWS]);
    expect(next.bindings.shield).toBe("KeyM");
    expect(CONFIG_LOCAL_P2.bindings.shield).toBe("KeyO");
    expect(detectConflicts([CONFIG_ARROWS, next])).toEqual([]);
  });

  it("refuses a rebind that would collide inside its own preset", () => {
    expect(() => rebind(CONFIG_LOCAL_P2, "shield", "KeyI")).toThrow(SchemeConflictError);
  });
});
