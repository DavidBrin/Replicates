/**
 * Sword and kick trails (Plan 6, Task 34; the final review's Declined #2: "Ultimate draws
 * trails"). A move whose boxes ride a limb bone sweeps a ribbon across its blade: once a
 * sim frame a sample runs from the bone (the hand, the ankle) out to the farthest of its
 * live boxes (the blade's tip, the toe), the boxes the sim hits with; the last
 * `TRAIL_SAMPLES` of them are joined, fading toward the oldest. When the boxes end the
 * ribbon draws in from its tail, a sample a frame. One mesh for every fighter, drawn in
 * one pass: one draw call while a trail is out, none otherwise. Render only.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial } from "three";

import type { AttackParams } from "@/engine/acmd/types";
import { toFloat } from "@/engine/fixed";
import type { FighterDef, Hitbox, MoveSlot } from "@/engine/types";

/** Samples kept per trail: a tenth of a second. UNVERIFIED (cosmetic). */
export const TRAIL_SAMPLES = 6;
/** The ribbon's opacity at its newest sample, on its outer edge. UNVERIFIED (cosmetic). */
const TRAIL_OPACITY = 0.55;
/** The inner (hand) edge's share of that: the ribbon fades toward the grip. UNVERIFIED (cosmetic). */
const INNER_OPACITY = 0.35;

/** The root bones: a box on one hangs on the body, and there is no limb to trail. */
const ROOT_BONES: ReadonlySet<string> = new Set(["top", "trans", "rot"]);

/** The bone a move's trail follows, and the ids of the script's boxes on it. */
export interface TrailBone {
  readonly bone: string;
  readonly ids: ReadonlySet<number>;
}

/**
 * The bone of the first `ATTACK` in the move's script that is not a root bone, and every
 * attack id on it; null for a root-bone move, a grab (its boxes are `CATCH`es), or a move
 * with no script (its boxes hang on no bone). A throw's collateral slash on a limb, Link's
 * up throw's sword, is a swing like any other.
 */
export function trailBoneOf(def: FighterDef, slot: MoveSlot): TrailBone | null {
  const script = def.scripts?.[slot];
  if (script === undefined) return null;
  const attacks: AttackParams[] = [];
  const walk = (cmds: typeof script.commands): void => {
    for (const c of cmds) {
      if (c.op === "attack") attacks.push(c.params);
      else if (c.op === "loop") walk(c.body);
    }
  };
  walk(script.commands);
  const bone = attacks.find((a) => !ROOT_BONES.has(a.bone))?.bone;
  if (bone === undefined) return null;
  return { bone, ids: new Set(attacks.filter((a) => a.bone === bone).map((a) => a.id)) };
}

export interface TrailPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One frame of a trail: the blade, from the bone (`inner`) to its farthest live box (`outer`). */
export interface TrailSample {
  readonly inner: TrailPoint;
  readonly outer: TrailPoint;
}

/**
 * This frame's sample: from `at`, the trail bone's world position, out to the centre of the
 * farthest of the move's live boxes on that bone (`boxes`, the move's `activeHitboxes`
 * this frame, facing-relative, from where the fighter is drawn, `x` and `y`), at the
 * bone's depth; null when none of the bone's boxes is live.
 */
export function trailSample(bone: TrailBone, boxes: readonly Hitbox[], x: number, y: number, facing: number, at: TrailPoint): TrailSample | null {
  let outer: TrailPoint | null = null;
  let far = -1;
  for (const hb of boxes) {
    if (hb.grabbing === true || !bone.ids.has(hb.id)) continue;
    const ox = x + (facing >= 0 ? toFloat(hb.x) : -toFloat(hb.x));
    const oy = y + toFloat(hb.y);
    const d = (ox - at.x) * (ox - at.x) + (oy - at.y) * (oy - at.y);
    if (d > far) {
      far = d;
      outer = { x: ox, y: oy, z: at.z };
    }
  }
  return outer === null ? null : { inner: at, outer };
}

export interface Trails3D {
  readonly mesh: Mesh;
  /** This sim frame's sample for `port`; null, when it has none, draws the ribbon in a sample from its tail. Once a sim frame. */
  push(port: number, sample: TrailSample | null): void;
  /** Rebuild the ribbon from every trail, and show the mesh only while one is out. */
  update(): void;
  samplesOf(port: number): readonly TrailSample[];
  alphasOf(port: number): readonly number[];
  dispose(): void;
}

export function createTrails3D(maxFighters: number): Trails3D {
  const trails: TrailSample[][] = Array.from({ length: maxFighters }, () => []);
  const verts = maxFighters * TRAIL_SAMPLES * 2;
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(new Float32Array(verts * 3), 3);
  const colour = new BufferAttribute(new Float32Array(verts * 4), 4);
  geometry.setAttribute("position", position);
  geometry.setAttribute("color", colour);
  const index: number[] = [];
  for (let f = 0; f < maxFighters; f++) {
    for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
      const a = (f * TRAIL_SAMPLES + i) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setIndex(index);
  // One pass: a ribbon has no back to sort, and three draws a transparent double-sided
  // material twice (back faces, then front) unless it is single-pass.
  const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true });
  const mesh = new Mesh(geometry, material);
  mesh.name = "trails";
  mesh.frustumCulled = false;
  mesh.visible = false;
  const alphas = (n: number): number[] => Array.from({ length: n }, (_, i) => ((i + 1) / n) * TRAIL_OPACITY);
  return {
    mesh,
    push(port, sample) {
      const list = trails[port];
      if (list === undefined) return;
      if (sample === null) {
        list.shift();
        return;
      }
      list.push(sample);
      if (list.length > TRAIL_SAMPLES) list.shift();
    },
    update() {
      let out = false;
      for (let f = 0; f < maxFighters; f++) {
        const list = trails[f];
        if (list.length >= 2) out = true;
        const a = alphas(list.length);
        for (let i = 0; i < TRAIL_SAMPLES; i++) {
          // Past the trail's end, its last sample again, unseen: a quad of no area.
          const s = list[Math.min(i, list.length - 1)];
          const shown = s !== undefined && i < list.length;
          const v = (f * TRAIL_SAMPLES + i) * 2;
          position.setXYZ(v, s?.inner.x ?? 0, s?.inner.y ?? 0, s?.inner.z ?? 0);
          position.setXYZ(v + 1, s?.outer.x ?? 0, s?.outer.y ?? 0, s?.outer.z ?? 0);
          colour.setXYZW(v, 1, 1, 1, shown ? a[i] * INNER_OPACITY : 0);
          colour.setXYZW(v + 1, 1, 1, 1, shown ? a[i] : 0);
        }
      }
      position.needsUpdate = true;
      colour.needsUpdate = true;
      mesh.visible = out;
    },
    samplesOf: (port) => trails[port] ?? [],
    alphasOf: (port) => alphas((trails[port] ?? []).length),
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
