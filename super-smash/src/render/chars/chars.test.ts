/**
 * The per-character layer has to actually be reached.
 *
 * Every failure this file guards against is silent. A fighter's own clip that
 * the sampler never asks for, an effect keyed to a move that was renamed, a
 * projectile painter nobody calls — none of them throw. The symptom is that the
 * character goes on looking like the shared default, which is indistinguishable
 * from the override simply not being good enough yet, and that is the worst
 * possible thing to be unable to tell apart while eight people are iterating on
 * exactly that.
 */

import { describe, expect, it } from "vitest";
import { FIGHTERS, FIGHTER_IDS } from "@/fighters";
import type { MoveSlot } from "@/engine/types";
import { CHARACTER_POSES, CHARACTER_RIGS, MOVE_FX_KEYS, PROJECTILE_PAINTER_KEYS } from ".";
import { charKey, clipFor, overrides } from "./poses";
import { getCharacterRig } from ".";
import { POSE_LIBRARY, type PoseName } from "../poses/library";
import { samplePoseForFighter } from "../poses";
import { makeFighter } from "../testFixtures";

const byKey = new Map(FIGHTERS.map((f) => [charKey(f.id), f]));

describe("every fighter is reachable by their own id", () => {
  it("has a rig that is not the fallback", () => {
    for (const id of FIGHTER_IDS) {
      expect(getCharacterRig(id).id, `${id} fell back to the default rig`).not.toBe("default");
    }
  });

  it("has a pose-override table, even an empty one", () => {
    for (const id of FIGHTER_IDS) {
      expect(CHARACTER_POSES[charKey(id)], `${id} has no override table`).toBeDefined();
    }
  });

  // The lab's fighter dropdown was once built from the rig keys while its speed
  // lookup used the roster ids, so `donkeykong` resolved a rig and no fighter.
  // Donkey Kong's walk and run then showed a motionless drawing under a
  // plausible-looking frame count, and several passes of verification went
  // through that before anyone noticed.
  it("spells every fighter the same way in both tables", () => {
    for (const id of FIGHTER_IDS) {
      const key = charKey(id);
      expect(CHARACTER_RIGS[key], `no rig for ${id} (key ${key})`).toBeDefined();
      expect(byKey.get(key), `no fighter for key ${key}`).toBeDefined();
    }
  });
});

describe("a fighter's own clip wins", () => {
  const NAMES = Object.keys(POSE_LIBRARY) as PoseName[];

  it("falls through to the shared library where nothing is declared", () => {
    for (const id of FIGHTER_IDS) {
      for (const name of NAMES) {
        if (overrides(id, name)) continue;
        expect(clipFor(id, name), `${id}.${name}`).toBe(POSE_LIBRARY[name]);
      }
    }
  });

  it("hands back the fighter's own clip where one is declared", () => {
    for (const id of FIGHTER_IDS) {
      for (const name of NAMES) {
        if (!overrides(id, name)) continue;
        expect(clipFor(id, name), `${id}.${name}`).not.toBe(POSE_LIBRARY[name]);
        expect(clipFor(id, name)).toBe(CHARACTER_POSES[charKey(id)][name]);
      }
    }
  });

  // The whole mechanism hangs on `defId` reaching the sampler. If a caller ever
  // drops it the fighter reverts to the shared animation, which looks like the
  // animation being wrong rather than the plumbing being wrong.
  it("is reached through the sampler the renderer actually calls", () => {
    for (const id of FIGHTER_IDS) {
      for (const name of NAMES) {
        if (!overrides(id, name)) continue;
        const slot = SLOT_FOR[name];
        if (!slot) continue;
        const mine = samplePoseForFighter(
          makeFighter({ defId: id, action: actionFor(slot), move: slot, actionFrame: 0 }),
          0,
        );
        const shared = samplePoseForFighter(
          makeFighter({ defId: "no-such-fighter", action: actionFor(slot), move: slot, actionFrame: 0 }),
          0,
        );
        expect(JSON.stringify(mine), `${id}.${name} sampled as the shared clip`).not.toBe(
          JSON.stringify(shared),
        );
      }
    }
  });

  it("declares no clip the library does not know about", () => {
    for (const id of FIGHTER_IDS) {
      for (const name of Object.keys(CHARACTER_POSES[charKey(id)] ?? {})) {
        expect(POSE_LIBRARY[name as PoseName], `${id} declares unknown clip ${name}`).toBeDefined();
      }
    }
  });
});

/** A move slot that reaches each pose, for the poses an attack can be in. */
const SLOT_FOR: Partial<Record<PoseName, MoveSlot>> = {
  grab: "grab",
  jab: "jab1",
  ftilt: "ftilt",
  utilt: "utilt",
  dtilt: "dtilt",
  dashAttack: "dashAttack",
  fsmash: "fsmash",
  usmash: "usmash",
  dsmash: "dsmash",
  nair: "nair",
  fair: "fair",
  bair: "bair",
  uair: "uair",
  dair: "dair",
  neutralB: "neutralB",
  sideB: "sideB",
  upB: "upB",
  downB: "downB",
  fthrow: "fthrow",
  bthrow: "bthrow",
  uthrow: "uthrow",
  dthrow: "dthrow",
};

function actionFor(slot: MoveSlot): "attack" | "special" | "throw" {
  if (slot === "neutralB" || slot === "sideB" || slot === "upB" || slot === "downB") return "special";
  if (slot.endsWith("throw")) return "throw";
  return "attack";
}

describe("the effect tables name real moves", () => {
  it("keys every effect to a move the fighter has", () => {
    for (const key of MOVE_FX_KEYS) {
      const [id, slot] = key.split(".");
      const def = byKey.get(id);
      expect(def, `${key}: no such fighter`).toBeDefined();
      expect(def?.moves[slot as MoveSlot], `${key}: no such move`).toBeDefined();
    }
  });

  it("keys every projectile painter to a projectile the fighter launches", () => {
    for (const key of PROJECTILE_PAINTER_KEYS) {
      const [id, projectile] = key.split(".");
      const def = byKey.get(id);
      expect(def, `${key}: no such fighter`).toBeDefined();
      const launched = new Set(
        Object.values(def?.moves ?? {}).flatMap((m) => (m?.projectiles ?? []).map((p) => p.id)),
      );
      expect(launched.has(projectile), `${key}: ${id} launches no such projectile`).toBe(true);
    }
  });

  it("covers at least half the roster, so specials are not all one look", () => {
    const covered = new Set(MOVE_FX_KEYS.map((k) => k.split(".")[0]));
    expect(covered.size).toBeGreaterThanOrEqual(FIGHTERS.length / 2);
  });
});
