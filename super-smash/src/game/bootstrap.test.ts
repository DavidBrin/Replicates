/**
 * The seam between the menus' idea of a control scheme and the input layer's.
 *
 * Two vocabularies for the same nine actions meet here, and the join is a
 * spread rather than a translation — which is fast and readable right up until
 * one side gains an action and the other does not, at which point a binding is
 * silently dropped and one button stops working in matches while continuing to
 * look bound on the controls screen.
 */

import { describe, expect, it } from "vitest";
import { CONTROL_ACTIONS, DEFAULT_BINDINGS, type Bindings } from "@/lib/matchConfig";
import { GAME_ACTIONS } from "@/input/schemes";
import { schemeForMenuId } from "./bootstrap";

describe("the two action vocabularies", () => {
  it("name the same nine things", () => {
    expect([...CONTROL_ACTIONS].sort()).toEqual([...GAME_ACTIONS].sort());
  });
});

describe("a player's own bindings", () => {
  it("reach the match, rather than the factory preset", () => {
    // The bug this pins down: `schemeForMenuId` used to return the preset and
    // nothing else, so the controls screen recorded a rebind, redrew its
    // diagram, and the match went on using the original keys.
    const rebound: Bindings = { ...DEFAULT_BINDINGS.arrows, attack: "Semicolon", jump: "KeyM" };
    const scheme = schemeForMenuId("arrows", rebound);

    expect(scheme.bindings.attack).toBe("Semicolon");
    expect(scheme.bindings.jump).toBe("KeyM");
    // And the untouched ones are still the player's, not the preset's.
    expect(scheme.bindings.left).toBe(DEFAULT_BINDINGS.arrows.left);
  });

  it("carries every action across, not only the ones that changed", () => {
    const scheme = schemeForMenuId("rightCluster", DEFAULT_BINDINGS.rightCluster);
    for (const action of CONTROL_ACTIONS) {
      expect(scheme.bindings[action], action).toBe(DEFAULT_BINDINGS.rightCluster[action]);
    }
  });

  it("falls back to the preset when there are no bindings to apply", () => {
    // The netplay lobby and the tests both construct schemes without a store.
    const scheme = schemeForMenuId("mirrored");
    expect(scheme.bindings.left).toBe(DEFAULT_BINDINGS.mirrored.left);
    expect(scheme.id).toBe("wasd");
  });

  it("keeps the scheme's identity, so conflict detection still knows who is who", () => {
    // `conflictFreeSelection` rejects by comparing scheme objects; a rebind that
    // changed the id would make two live schemes look like strangers.
    const preset = schemeForMenuId("arrows");
    const rebound = schemeForMenuId("arrows", { ...DEFAULT_BINDINGS.arrows, grab: "KeyZ" });
    expect(rebound.id).toBe(preset.id);
    expect(rebound.name).toBe(preset.name);
  });
});
