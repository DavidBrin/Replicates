/**
 * Sword and kick trails (Plan 6, Task 34; the final review's Declined #2: "Ultimate draws
 * trails"). A move whose boxes ride a limb bone sweeps a ribbon across its blade. Each
 * step of the fighter's own clock gives one sample. It runs from the bone of that frame's
 * farthest-reaching live box (the hand, the knee) out to that box's far edge (the blade's
 * tip, the toe), so it covers what the sim hits with. The last `TRAIL_SAMPLES` samples are
 * joined, fading toward the oldest. When the boxes end, the ribbon draws in from its tail,
 * a sample a step. One mesh for every fighter, drawn in one pass: one draw call while a
 * trail is out, none otherwise. Render only.
 *
 * Fix round 1 (ruling on review I2): each frame's box is keyed to its bone through the
 * move's script, box by box, and not by its id. One script can reuse an id on another bone
 * (Link's back air, Fox's down air), and its first limb box need not be its blade (Marth's
 * jab and down air list an `armr` box first). So the trail's bone is that frame's
 * farthest-reaching box's own bone.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial } from "three";

import type { BoneTable } from "@/engine/acmd/bones";
import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { runScript, scheduleOf } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import type { AttackParams } from "@/engine/acmd/types";
import { toFloat } from "@/engine/fixed";
import type { FighterDef, MoveSlot } from "@/engine/types";

/** Samples kept per trail: a tenth of a second. UNVERIFIED (cosmetic). */
export const TRAIL_SAMPLES = 6;
/** The ribbon's opacity at its newest sample, on its outer edge. UNVERIFIED (cosmetic). */
const TRAIL_OPACITY = 0.55;
/** The inner (hand) edge's share of that: the ribbon fades toward the grip. UNVERIFIED (cosmetic). */
const INNER_OPACITY = 0.35;
/**
 * A box whose centre is closer than this to its bone (bone-local units) sits on the bone:
 * there is no blade between the two to sweep, and the drawn bone's 0.01 from the sim's
 * would turn the ribbon at random. UNVERIFIED (cosmetic).
 */
export const TRAIL_MIN_OFFSET = 0.5;

/** The root bones: a box on one hangs on the body, and there is no limb to trail. */
const ROOT_BONES: ReadonlySet<string> = new Set(["top", "trans", "rot"]);

/** A frame's trailed box: its bone, and the centre of its far end and its radius, facing-relative, in world units. */
export interface TrailBox {
  readonly bone: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** How far a script box's far end sits from its own bone, bone-local, and which end that is. */
function boxOffset(a: AttackParams): { far: number; second: boolean } {
  const near = Math.hypot(toFloat(a.x), toFloat(a.y), toFloat(a.z));
  if (a.x2 === undefined && a.y2 === undefined && a.z2 === undefined) return { far: near, second: false };
  const end = Math.hypot(toFloat(a.x2 ?? a.x), toFloat(a.y2 ?? a.y), toFloat(a.z2 ?? a.z));
  return end > near ? { far: end, second: true } : { far: near, second: false };
}

/**
 * A move's trail, frame by frame. The index is the move's game frame (`moveFrameOf`), and
 * each entry is that frame's farthest-reaching live `ATTACK` (its far end's offset from its
 * own bone, plus its radius), placed as the sim places it (`scriptHitboxes`, through
 * `bones`). Only boxes on a limb count, so not the root and not a box on its bone; a grab's
 * `CATCH`es are not attacks. An entry is null on a frame with no such box. The result is
 * null for a move that never has one: a root-bone move, a grab, or a pummel.
 */
export function trailBoxesOf(def: FighterDef, slot: MoveSlot, bones: BoneTable): readonly (TrailBox | null)[] | null {
  const script = gameScriptFor(def, slot);
  if (script === null) return null;
  let last = 0;
  for (const e of scheduleOf(script).fire) if (e > last) last = e;
  const out: (TrailBox | null)[] = [null];
  let any = false;
  for (let g = 1; g <= last; g++) {
    const state = runScript(script, g);
    let best = -1;
    let reach = -1;
    let second = false;
    for (let i = 0; i < state.attacks.length; i++) {
      const a = state.attacks[i];
      if (ROOT_BONES.has(a.bone)) continue;
      const o = boxOffset(a);
      if (o.far < TRAIL_MIN_OFFSET) continue;
      const r = o.far + toFloat(a.size);
      if (r > reach) {
        reach = r;
        best = i;
        second = o.second;
      }
    }
    if (best < 0) {
      out.push(null);
      continue;
    }
    // `scriptHitboxes` lists the live attacks first, in `state.attacks`' order.
    const hb = scriptHitboxes(state, def.id, script.motion, g, bones)[best];
    const x = second && hb.x2 !== undefined ? hb.x2 : hb.x;
    const y = second && hb.y2 !== undefined ? hb.y2 : hb.y;
    out.push({ bone: state.attacks[best].bone, x: toFloat(x), y: toFloat(y), radius: toFloat(hb.radius) });
    any = true;
  }
  return any ? out : null;
}

export interface TrailPoint {
  x: number;
  y: number;
  z: number;
}

/** One frame of a trail: the blade, from the bone (`inner`) to its box's far edge (`outer`). */
export interface TrailSample {
  readonly inner: TrailPoint;
  readonly outer: TrailPoint;
}

export const newTrailSample = (): TrailSample => ({ inner: { x: 0, y: 0, z: 0 }, outer: { x: 0, y: 0, z: 0 } });

/**
 * This frame's sample, written into `out`. It runs from `at`, the box's bone where it is
 * drawn, to the edge of `box` farthest from it, at the bone's depth. The box is placed from
 * where the fighter is drawn (`x`, `y`, with the hitlag shake the model has) and turned to
 * `facing`. A box centred exactly on the drawn bone reaches forward.
 */
export function trailSample(box: TrailBox, x: number, y: number, facing: number, at: Readonly<TrailPoint>, out: TrailSample = newTrailSample()): TrailSample {
  const cx = x + (facing >= 0 ? box.x : -box.x);
  const cy = y + box.y;
  const dx = cx - at.x;
  const dy = cy - at.y;
  const d = Math.hypot(dx, dy);
  const ux = d > 0 ? dx / d : facing >= 0 ? 1 : -1;
  const uy = d > 0 ? dy / d : 0;
  out.inner.x = at.x;
  out.inner.y = at.y;
  out.inner.z = at.z;
  out.outer.x = cx + ux * box.radius;
  out.outer.y = cy + uy * box.radius;
  out.outer.z = at.z;
  return out;
}

export interface Trails3D {
  readonly mesh: Mesh;
  /** A step of `port`'s clock: its sample, or null, which draws the ribbon in a sample from its tail. The sample is copied. */
  push(port: number, sample: TrailSample | null): void;
  /** Rebuild the ribbon from every trail, and show the mesh only while one is out. Writes nothing while none is or was. */
  update(): void;
  samplesOf(port: number): readonly TrailSample[];
  alphasOf(port: number): readonly number[];
  dispose(): void;
}

/** Numbers a sample holds in a trail's store: inner x, y, z, then outer x, y, z. */
const STRIDE = 6;

export function createTrails3D(maxFighters: number): Trails3D {
  // Each fighter's samples, oldest first, in a store made once: pushing and drawing make nothing.
  const store: Float64Array[] = Array.from({ length: maxFighters }, () => new Float64Array(TRAIL_SAMPLES * STRIDE));
  const lengths: number[] = Array.from({ length: maxFighters }, () => 0);
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
  /** The `i`th of `n` samples' opacity, oldest first. */
  const alphaOf = (i: number, n: number): number => ((i + 1) / n) * TRAIL_OPACITY;
  /** Whether the last update drew anything, so the one after a trail goes still clears it. */
  let drawn = false;
  return {
    mesh,
    push(port, sample) {
      const s = store[port];
      if (s === undefined) return;
      const n = lengths[port];
      if (sample === null || n === TRAIL_SAMPLES) {
        // Drop the oldest.
        if (n > 0) s.copyWithin(0, STRIDE, n * STRIDE);
        lengths[port] = Math.max(0, n - 1);
      }
      if (sample === null) return;
      const at = lengths[port] * STRIDE;
      s[at] = sample.inner.x;
      s[at + 1] = sample.inner.y;
      s[at + 2] = sample.inner.z;
      s[at + 3] = sample.outer.x;
      s[at + 4] = sample.outer.y;
      s[at + 5] = sample.outer.z;
      lengths[port] += 1;
    },
    update() {
      let out = false;
      let any = false;
      for (let f = 0; f < maxFighters; f++) {
        if (lengths[f] >= 2) out = true;
        if (lengths[f] > 0) any = true;
      }
      if (!any && !drawn) return;
      for (let f = 0; f < maxFighters; f++) {
        const s = store[f];
        const n = lengths[f];
        for (let i = 0; i < TRAIL_SAMPLES; i++) {
          // Past the trail's end, its last sample again, unseen: a quad of no area.
          const k = Math.max(0, Math.min(i, n - 1)) * STRIDE;
          const shown = i < n;
          const v = (f * TRAIL_SAMPLES + i) * 2;
          position.setXYZ(v, s[k], s[k + 1], s[k + 2]);
          position.setXYZ(v + 1, s[k + 3], s[k + 4], s[k + 5]);
          const a = shown ? alphaOf(i, n) : 0;
          colour.setXYZW(v, 1, 1, 1, a * INNER_OPACITY);
          colour.setXYZW(v + 1, 1, 1, 1, a);
        }
      }
      position.needsUpdate = true;
      colour.needsUpdate = true;
      mesh.visible = out;
      drawn = any;
    },
    samplesOf(port) {
      const s = store[port];
      if (s === undefined) return [];
      return Array.from({ length: lengths[port] }, (_, i) => ({
        inner: { x: s[i * STRIDE], y: s[i * STRIDE + 1], z: s[i * STRIDE + 2] },
        outer: { x: s[i * STRIDE + 3], y: s[i * STRIDE + 4], z: s[i * STRIDE + 5] },
      }));
    },
    alphasOf(port) {
      const n = lengths[port] ?? 0;
      return Array.from({ length: n }, (_, i) => alphaOf(i, n));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
