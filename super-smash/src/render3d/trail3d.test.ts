import { describe, expect, it } from "vitest";
import { DoubleSide, Vector3, type BufferAttribute, type MeshBasicMaterial } from "three";

import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { runScript, scheduleOf } from "@/engine/acmd/interpreter";
import { THROW_SLOTS, gameScriptFor } from "@/engine/acmd/legacy";
import type { AttackParams } from "@/engine/acmd/types";
import { activeHitboxes, actionFrameOf } from "@/engine/hitbox";
import { fx, toFloat } from "@/engine/fixed";
import type { FighterDef, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeFighter } from "@/render/testFixtures";
import { fighterPoser } from "./bake/bake";
import { createFighter3D, type Fighter3D } from "./fighter3d";
import { SKELETONS } from "./skeletons";
import { TRAIL_MIN_OFFSET, TRAIL_SAMPLES, createTrails3D, trailBoxesOf, trailSample, type TrailSample } from "./trail3d";

const bake = readBakeFromDisk();
/** The game's own fighter: its limb-bone moves run their scripts, through the bake's bones. */
const def = (id: string) => withLimbScripts(FIGHTERS.find((f) => f.id === id)!, bake.bones);
/** The bone a move's trail runs from on its game frame `g`; undefined for none. */
const boneAt = (id: string, slot: MoveSlot, g: number) => trailBoxesOf(def(id), slot, bake.bones)?.[g]?.bone;
const standIn = (d: FighterDef): Fighter3D =>
  createFighter3D({ def: d, port: 0, poser: fighterPoser(d, SKELETONS[d.id]), bake, model: { kind: "standIn", reason: "test" } });
/** Drawn as the sim has it on the move's game frame `g`, facing right at (10, 0). */
function drawAt(fighter: Fighter3D, d: FighterDef, slot: MoveSlot, g: number) {
  const f = makeFighter({ defId: d.id, x: fx(10), y: 0, facing: 1, grounded: true, action: "attack", move: slot, actionFrame: actionFrameOf(g) });
  fighter.update({ f, x: toFloat(f.x), y: toFloat(f.y), frame: 100, blends: null, hitFlash: 0, hidden: false });
  return f;
}

/**
 * A live script box's reach from its own bone, as the review's ruling defines it: its far
 * end's offset (bone-local) plus its radius; null for a box on the root or on its bone.
 */
function reachOf(a: AttackParams): { reach: number; second: boolean } | null {
  if (a.bone === "top" || a.bone === "trans" || a.bone === "rot") return null;
  const near = Math.hypot(toFloat(a.x), toFloat(a.y), toFloat(a.z));
  const end = a.x2 === undefined && a.y2 === undefined && a.z2 === undefined ? -1 : Math.hypot(toFloat(a.x2 ?? a.x), toFloat(a.y2 ?? a.y), toFloat(a.z2 ?? a.z));
  const far = Math.max(near, end);
  return far < TRAIL_MIN_OFFSET ? null : { reach: far + toFloat(a.size), second: end > near };
}

describe("sword and kick trails (Plan 6, Task 34)", () => {
  it("runs each frame from the bone of its farthest-reaching live box, and none for a root-bone move or a grab (fix round 1)", () => {
    expect(boneAt("link", "ftilt", 16)).toBe("sword2");
    expect(boneAt("marth", "fsmash", 10)).toBe("sword1");
    expect(boneAt("kirby", "ftilt", 5)).toBe("footl");
    // Marth's jab and down air list an `armr` box first; the blade reaches farther.
    expect(boneAt("marth", "jab1", 5)).toBe("sword1");
    expect(boneAt("marth", "jab2", 4)).toBe("sword1");
    expect(boneAt("marth", "dair", 9)).toBe("sword1");
    // Link's back air reuses its ids: the right leg's kick, then the left's.
    expect(boneAt("link", "bair", 6)).toBe("kneer");
    expect(boneAt("link", "bair", 15)).toBe("kneel");
    // Boxes on the body's root (`top`): Link's jab 1, Mario's pummel. A grab's boxes are catches.
    expect(trailBoxesOf(def("link"), "jab1", bake.bones)).toBeNull();
    expect(trailBoxesOf(def("mario"), "pummel", bake.bones)).toBeNull();
    expect(trailBoxesOf(def("marth"), "grab", bake.bones)).toBeNull();
  });

  /**
   * The final wave (final review item 37; Task 34's ruling): trails are for sword and kick
   * attacks, and a throw draws none. Mario's back throw trailed a constant ribbon off his hip
   * for its 27 live frames; Link's throws trailed his knee and his sword.
   */
  it("draws no trail for any throw", () => {
    expect(trailBoxesOf(def("mario"), "bthrow", bake.bones)).toBeNull();
    expect(trailBoxesOf(def("link"), "uthrow", bake.bones)).toBeNull();
    const trailed = FIGHTERS.flatMap((base) => {
      const d = def(base.id);
      return [...THROW_SLOTS].filter((slot) => d.moves[slot] !== undefined && trailBoxesOf(d, slot, bake.bones) !== null).map((slot) => `${d.id} ${slot}`);
    });
    expect(trailed).toEqual([]);
  });

  /**
   * The look, as numbers (ruling R-P6-6): on the tipper's first live frame the ribbon's
   * sample runs from Marth's hand, where the drawn `sword1` bone is, out to the tipper box's
   * far edge, the farthest of the blade's live boxes: the blade's length, not a smear at the hilt.
   */
  it("spans Marth's blade on his forward smash: from the drawn hand to the tipper's edge", () => {
    const marth = def("marth");
    const move = marth.moves.fsmash!;
    const first = Math.min(...move.hitboxes.map((h) => h.startFrame));
    const box = trailBoxesOf(marth, "fsmash", bake.bones)![first]!;
    const fighter = standIn(marth);
    const f = drawAt(fighter, marth, "fsmash", first);
    const hand = new Vector3();
    expect(fighter.bonePosition(box.bone, hand)).toBe(true);
    const sample = trailSample(box, toFloat(f.x), toFloat(f.y), f.facing, hand);
    expect(sample.inner).toEqual({ x: hand.x, y: hand.y, z: hand.z });
    const length = Math.hypot(sample.outer.x - sample.inner.x, sample.outer.y - sample.inner.y);
    expect(length).toBeGreaterThan(6);
    // The outer edge is on the strongest box: the tipper.
    const tipper = activeHitboxes(move, first).reduce((a, b) => (b.damage > a.damage ? b : a));
    const off = Math.hypot(sample.outer.x - (toFloat(f.x) + toFloat(tipper.x)), sample.outer.y - (toFloat(f.y) + toFloat(tipper.y)));
    expect(off).toBeCloseTo(toFloat(tipper.radius), 6);
    fighter.dispose();
  });

  /**
   * Every move that draws a trail, every fighter, frame by frame (fix round 1, ruling on I2):
   * the ribbon's outer point lies in the frame's farthest-reaching live box, it has a length
   * wherever such a box is live, and it does not leave a bone while that box lives.
   */
  it("sweeps every trailed move: its outer edge in the farthest-reaching live box, never of no length, never jumping bones within a box's life", () => {
    const outside: string[] = [];
    const missing: string[] = [];
    const short: string[] = [];
    const jumps: string[] = [];
    let trailed = 0;
    for (const base of FIGHTERS) {
      const d = def(base.id);
      const fighter = standIn(d);
      for (const slot of Object.keys(d.moves) as MoveSlot[]) {
        const script = gameScriptFor(d, slot);
        const table = trailBoxesOf(d, slot, bake.bones);
        // A throw draws none, whatever its boxes ride (the test above).
        if (script === null || THROW_SLOTS.has(slot)) continue;
        if (table !== null) trailed++;
        let last = 0;
        for (const e of scheduleOf(script).fire) if (e > last) last = e;
        let was: { key: string; bone: string } | null = null;
        for (let g = 1; g <= last; g++) {
          const state = runScript(script, g);
          let far: { i: number; reach: number; second: boolean } | null = null;
          for (let k = 0; k < state.attacks.length; k++) {
            const r = reachOf(state.attacks[k]);
            if (r !== null && (far === null || r.reach > far.reach)) far = { i: k, ...r };
          }
          const at = `${d.id} ${slot} g${g}`;
          const box = table?.[g] ?? null;
          if (far === null) {
            if (box !== null) missing.push(`${at}: a trail with no limb box live`);
            was = null;
            continue;
          }
          const { i, second } = far;
          if (box === null) {
            missing.push(`${at}: no trail with a limb box live`);
            continue;
          }
          const a = state.attacks[i];
          const hb = scriptHitboxes(state, d.id, script.motion, g, bake.bones)[i];
          const f = drawAt(fighter, d, slot, g);
          const hand = new Vector3();
          if (!fighter.bonePosition(box.bone, hand)) {
            missing.push(`${at}: no drawn ${box.bone}`);
            continue;
          }
          const s = trailSample(box, toFloat(f.x), toFloat(f.y), f.facing, hand);
          const cx = toFloat(f.x) + toFloat(second && hb.x2 !== undefined ? hb.x2 : hb.x);
          const cy = toFloat(f.y) + toFloat(second && hb.y2 !== undefined ? hb.y2 : hb.y);
          if (box.bone !== a.bone || Math.hypot(s.outer.x - cx, s.outer.y - cy) > toFloat(hb.radius) + 1e-6) outside.push(`${at}: ${box.bone} vs ${a.bone} id ${a.id}`);
          if (Math.hypot(s.outer.x - s.inner.x, s.outer.y - s.inner.y) < 1) short.push(at);
          const key = `${a.id}:${a.bone}:${a.x}:${a.y}:${a.z}:${a.size}`;
          const stillLive = was !== null && state.attacks.some((b) => `${b.id}:${b.bone}:${b.x}:${b.y}:${b.z}:${b.size}` === was!.key);
          if (was !== null && stillLive && was.bone !== box.bone) jumps.push(`${at}: ${was.bone} -> ${box.bone}`);
          was = { key, bone: box.bone };
        }
      }
      fighter.dispose();
    }
    expect(trailed).toBeGreaterThan(50);
    expect({ outside, missing, short, jumps }).toEqual({ outside: [], missing: [], short: [], jumps: [] });
  });

  it("keeps the last TRAIL_SAMPLES samples, fading to the oldest, and draws in from its tail a sample a step once the boxes end", () => {
    const trails = createTrails3D(4);
    const sample = (i: number): TrailSample => ({ inner: { x: i, y: 0, z: 0 }, outer: { x: i, y: 5, z: 0 } });
    for (let i = 0; i < TRAIL_SAMPLES + 3; i++) trails.push(0, sample(i));
    trails.update();
    expect(trails.samplesOf(0).map((s) => s.inner.x)).toEqual(Array.from({ length: TRAIL_SAMPLES }, (_, i) => i + 3));
    const alpha = trails.alphasOf(0);
    expect(alpha[alpha.length - 1]).toBeGreaterThan(alpha[0]);
    expect(trails.mesh.visible).toBe(true);
    trails.push(0, null);
    expect(trails.samplesOf(0).map((s) => s.inner.x)).toEqual(Array.from({ length: TRAIL_SAMPLES - 1 }, (_, i) => i + 4));
    for (let i = 0; i < TRAIL_SAMPLES; i++) trails.push(0, null);
    trails.update();
    expect(trails.samplesOf(0)).toEqual([]);
    expect(trails.mesh.visible).toBe(false);
    trails.dispose();
  });

  it("writes nothing while no trail is out, and clears the ribbon once when the last one goes (fix round 1)", () => {
    const trails = createTrails3D(4);
    const colour = trails.mesh.geometry.getAttribute("color") as BufferAttribute;
    const at = colour.version;
    trails.update();
    trails.update();
    expect(colour.version).toBe(at);
    trails.push(1, { inner: { x: 0, y: 0, z: 0 }, outer: { x: 0, y: 5, z: 0 } });
    trails.update();
    expect(colour.version).toBe(at + 1);
    trails.push(1, null);
    trails.update();
    expect(colour.version).toBe(at + 2);
    expect([...Array(colour.count).keys()].every((i) => colour.getW(i) === 0)).toBe(true);
    trails.update();
    expect(colour.version).toBe(at + 2);
    trails.dispose();
  });

  it("is one ribbon for every fighter, drawn in one pass: one draw call", () => {
    const trails = createTrails3D(4);
    const material = trails.mesh.material as MeshBasicMaterial;
    expect(trails.mesh.isMesh).toBe(true);
    // three draws a transparent double-sided material twice, back faces then front, unless single-pass.
    expect(material.transparent && material.side === DoubleSide).toBe(true);
    expect(material.forceSinglePass).toBe(true);
    trails.dispose();
  });
});
