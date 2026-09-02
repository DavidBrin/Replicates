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
import { FIGHTERS, STAGES, resolveFighterId, resolveMatchStage, schemeForMenuId } from "./bootstrap";

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

describe("random picks", () => {
  const seed = 0x5eed1e55;

  it("turns the Random stage token into one of the six legal stages", () => {
    const stage = resolveMatchStage("random", "normal", seed);

    expect(STAGES.map((s) => s.id)).toContain(stage.id);
    expect(stage.id).not.toBe("random");
  });

  it("picks the same stage for the same seed, so two peers agree", () => {
    expect(resolveMatchStage("random", "normal", seed).id).toBe(
      resolveMatchStage("random", "normal", seed).id,
    );
  });

  it("can land on different stages when the seed changes", () => {
    const ids = new Set(
      [1, 2, 3, 7, 11, 99, 12345].map((s) => resolveMatchStage("random", "normal", s).id),
    );
    expect(ids.size).toBeGreaterThan(1);
  });

  it("still applies the selected form after the pick", () => {
    const stage = resolveMatchStage("random", "omega", seed);

    expect(stage.id.endsWith("-omega")).toBe(true);
    expect(stage.id.startsWith("random")).toBe(false);
    expect(stage.platforms.filter((p) => p.soft)).toHaveLength(0);
  });

  it("leaves a chosen stage alone", () => {
    expect(resolveMatchStage("smashville", "normal", seed).id).toBe("smashville");
    expect(resolveMatchStage("smashville", "omega", seed).id).toBe("smashville-omega");
  });

  it("still rejects a stage nobody defined", () => {
    expect(() => resolveMatchStage("hyrule-temple", "normal", seed)).toThrow(/Unknown stage "hyrule-temple"/);
  });

  it("turns the Random fighter token into a roster id", () => {
    const id = resolveFighterId("random", seed, 0);
    expect(FIGHTERS.map((f) => f.id)).toContain(id);
    expect(id).not.toBe("random");
  });

  it("leaves a chosen fighter alone", () => {
    expect(resolveFighterId("mario", seed, 0)).toBe("mario");
  });
});
