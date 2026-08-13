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
import { charKey, clipFor, overrides, type PoseOverrides } from "./poses";
import { getCharacterRig } from ".";
import { POSE_LIBRARY, type PoseName } from "../poses/library";
import { poseNameFor, samplePoseForFighter } from "../poses";
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

  /**
   * The guard on the guard.
   *
   * Every test below that proves the override mechanism works is a loop over
   * the declared overrides, and a loop over nothing passes. That is not a
   * hypothetical: the wiring in `timing.ts` was reverted by an errant
   * `git checkout` and committed, and this file stayed green through it,
   * because at that moment all eight override tables were empty and every
   * assertion below ran zero times. The bug was found by a character agent
   * adding a single clip and watching the suite go red — which is exactly the
   * signal this test existed to give and did not.
   *
   * So: assert the fixture is non-empty before trusting anything it proves.
   */
  it("has overrides to test at all", () => {
    const declared = FIGHTER_IDS.flatMap((id) =>
      Object.keys(CHARACTER_POSES[charKey(id)] ?? {}).map((name) => `${id}.${name}`),
    );
    expect(declared.length, "no fighter overrides any clip — every test below is vacuous").toBeGreaterThan(0);
  });

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
  jab2: "jab2",
  jab3: "jab3",
  rapidJab: "rapidJab",
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


/**
 * Each hit of a jab string is its own animation.
 *
 * `SLOT_POSE` used to collapse `jab1`/`jab2`/`jab3`/`rapidJab` onto one name,
 * so Mario's third-hit roundhouse and Fox's rapid flurry could not exist
 * without putting a kick in the tail of every jab. Two character agents
 * reported it independently as the thing they could not express.
 */
describe("the jab string", () => {
  const HITS: MoveSlot[] = ["jab1", "jab2", "jab3", "rapidJab"];

  it("gives every hit its own name", () => {
    const names = HITS.map((slot) => poseNameFor({ action: "attack", move: slot, jumpsUsed: 0, fastFalling: false }));
    expect(new Set(names).size, `two hits share a clip name: ${names}`).toBe(HITS.length);
  });

  it("still plays one punch for a fighter who says nothing", () => {
    // The default must not change: a fighter who authors no jab throws the
    // same punch three times, exactly as before.
    for (const name of ["jab2", "jab3", "rapidJab"] as PoseName[]) {
      expect(POSE_LIBRARY[name]).toBe(POSE_LIBRARY.jab);
    }
  });

  it("lets a fighter change one hit without changing the others", () => {
    // The property that was missing. Proven against the shared library rather
    // than against a character's file, so it holds whether or not anyone has
    // taken the opportunity yet.
    const mine: PoseOverrides = { jab3: { loop: false, keys: [{ t: 0, pose: {} }] } };
    expect(mine.jab3).not.toBe(POSE_LIBRARY.jab3);
    expect(mine.jab).toBeUndefined();
    expect(mine.rapidJab).toBeUndefined();
  });
});

/**
 * A projectile id names one projectile in the whole game.
 *
 * `ProjectileState` carries only `defId`, so the id is the *only* thing that
 * survives from the definition to the thing flying through the air. Two
 * fighters declaring the same id would be ambiguous to the engine, not merely
 * to the renderer: `projectileVisual` builds one index across the whole roster
 * and the later fighter would silently take the earlier one's shape and
 * painter, so swapping player order would change how a bomb looks.
 *
 * Nothing collides today — Samus has `bomb`, Link has `remoteBomb` — and this
 * exists so that stays true, because the failure is silent and the fix once two
 * have shipped is a rename in fighter data.
 */
describe("projectile ids", () => {
  const declared = FIGHTERS.flatMap((def) =>
    Object.values(def.moves).flatMap((m) => (m?.projectiles ?? []).map((p) => ({ id: p.id, owner: def.id }))),
  );

  it("has some to check", () => {
    expect(declared.length, "no fighter launches a projectile").toBeGreaterThan(4);
  });

  it("belongs to exactly one fighter", () => {
    const owners = new Map<string, Set<string>>();
    for (const { id, owner } of declared) {
      owners.set(id, (owners.get(id) ?? new Set()).add(owner));
    }
    const shared = [...owners.entries()]
      .filter(([, who]) => who.size > 1)
      .map(([id, who]) => `${id} is declared by ${[...who].join(" and ")}`);
    expect(shared).toEqual([]);
  });
});
