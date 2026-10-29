/**
 * The bake's file format: every fighter's baked bones, motion clocks and
 * hurtboxes in one little-endian binary (Plan 4). The ECB is not stored: it is
 * read off the baked hurt capsules (Task 12).
 *
 * Committed gzipped as `public/bake/roster.bin.gz` (1.84 MB on the committed skeletons); its fingerprint
 * is the SHA-256 of the *uncompressed* bytes (`src/fighters/bake/digest.ts`),
 * so it does not depend on the compressor, and two peers whose fingerprints
 * differ refuse to start an online match together. Derived numbers only — the
 * bone transforms of our own clips on SSBU's skeleton proportions.
 *
 * Layout (integers little-endian):
 *   "DSB2"  u16 fighterCount
 *   per fighter:
 *     str id   u8 boneCount  str[boneCount] bone names (lower case)
 *     u8 hurtCount  { u8 boneIndex, i32 x1, i32 x2, i32 r }[hurtCount]   (Q12)
 *     u16 motionCount
 *     per motion: str name  u8 clockKind  u16 frames (at least 1)
 *                 i16[frames · bones · 8]: pose values in BAKE_QUANTUM units,
 *                 frame 1 absolute, every later frame the difference from the
 *                 same value one frame earlier (they compress ~3× better).
 *   str = u8 length + printable ASCII.
 *
 * Integers only, so decoding is identical on every engine — which is why it may
 * live in `engine/`.
 */

import type { BakedFighterBones, BakedMotion } from "./bones";
import { BONE_POSE_STRIDE } from "./bones";
import type { ClockKind, MotionClock } from "./poseClock";
import type { BoneName, MotionKind } from "./types";

/** Baked pose values are multiples of this many Q12 units (1/256 of a unit). */
export const BAKE_QUANTUM = 16;

export interface BoneHurtbox {
  readonly bone: BoneName;
  /** Bone-local segment along +X, and radius, Q12. UNVERIFIED: derived from mesh weights. */
  readonly x1: number;
  readonly x2: number;
  readonly r: number;
}

export interface BakedFighter {
  readonly bones: BakedFighterBones;
  readonly clocks: Readonly<Record<MotionKind, MotionClock>>;
  readonly hurt: readonly BoneHurtbox[];
}

const MAGIC = "DSB2";
const KINDS: readonly ClockKind[] = ["script", "once", "scaled", "loop", "idle", "paced"];

function check(ok: boolean, why: string): void {
  if (!ok) throw new Error(`bake: ${why}`);
}

export function encodeBake(fighters: readonly BakedFighter[]): Uint8Array {
  let size = 6;
  for (const f of fighters) {
    size += 1 + f.bones.fighter.length + 1 + f.bones.bones.reduce((s, b) => s + 1 + b.length, 0);
    size += 1 + f.hurt.length * 13 + 2;
    for (const [name, m] of Object.entries(f.bones.motions)) size += 1 + name.length + 3 + m.data.length * 2;
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const u8 = (v: number) => {
    check(Number.isInteger(v) && v >= 0 && v <= 0xff, `${v} does not fit a u8`);
    out[at++] = v;
  };
  const u16 = (v: number) => {
    check(Number.isInteger(v) && v >= 0 && v <= 0xffff, `${v} does not fit a u16`);
    view.setUint16(at, v, true);
    at += 2;
  };
  const i32 = (v: number) => {
    check(Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff, `${v} does not fit an i32`);
    view.setInt32(at, v, true);
    at += 4;
  };
  const str = (s: string) => {
    check(/^[\x20-\x7e]*$/.test(s) && s.length <= 0xff, `"${s}" is not a short printable ASCII name`);
    u8(s.length);
    for (let i = 0; i < s.length; i++) out[at++] = s.charCodeAt(i);
  };

  for (const c of MAGIC) u8(c.charCodeAt(0));
  u16(fighters.length);
  for (const f of fighters) {
    const id = f.bones.fighter;
    const bones = f.bones.bones;
    str(id);
    u8(bones.length);
    for (const b of bones) str(b);
    u8(f.hurt.length);
    for (const h of f.hurt) {
      const i = bones.indexOf(h.bone);
      check(i >= 0, `${id}: hurtbox on unbaked bone ${h.bone}`);
      u8(i);
      i32(h.x1);
      i32(h.x2);
      i32(h.r);
    }
    const motions = Object.keys(f.bones.motions).sort();
    u16(motions.length);
    for (const name of motions) {
      const m = f.bones.motions[name];
      const clock = f.clocks[name];
      check(Number.isInteger(m.frames) && m.frames >= 1, `${id}/${name} has ${m.frames} frames; a motion needs at least 1`);
      check(clock !== undefined && clock.frames === m.frames, `${id}/${name} has no matching clock`);
      const stride = bones.length * BONE_POSE_STRIDE;
      check(m.data.length === m.frames * stride, `${id}/${name} has ${m.data.length} values for ${m.frames} frames`);
      str(name);
      u8(KINDS.indexOf(clock.kind));
      u16(m.frames);
      for (let i = 0; i < m.data.length; i++) {
        const v = m.data[i];
        check(v % BAKE_QUANTUM === 0, `${id}/${name} value ${v} is not on the ${BAKE_QUANTUM}-unit grid`);
        const d = (i < stride ? v : v - m.data[i - stride]) / BAKE_QUANTUM;
        check(d >= -0x8000 && d <= 0x7fff, `${id}/${name} step ${d} does not fit an i16`);
        view.setInt16(at, d, true);
        at += 2;
      }
    }
  }
  check(at === size, `wrote ${at} of ${size} bytes`);
  return out;
}

export function decodeBake(bytes: Uint8Array): BakedFighter[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = (n: number) => check(at + n <= bytes.length, `truncated at byte ${at}`);
  const u8 = () => (need(1), bytes[at++]);
  const u16 = () => {
    need(2);
    const v = view.getUint16(at, true);
    at += 2;
    return v;
  };
  const i32 = () => {
    need(4);
    const v = view.getInt32(at, true);
    at += 4;
    return v;
  };
  const str = () => {
    const n = u8();
    need(n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[at + i]);
    at += n;
    return s;
  };

  let magic = "";
  for (let i = 0; i < 4; i++) magic += String.fromCharCode(u8());
  check(magic === MAGIC, `not a David-Smash bake (magic "${magic}")`);
  const out: BakedFighter[] = [];
  const count = u16();
  for (let fi = 0; fi < count; fi++) {
    const fighter = str();
    const nb = u8();
    const bones: string[] = [];
    for (let i = 0; i < nb; i++) bones.push(str());
    const nh = u8();
    const hurt: BoneHurtbox[] = [];
    for (let i = 0; i < nh; i++) {
      const bone = bones[u8()];
      check(bone !== undefined, `${fighter}: hurtbox bone index out of range`);
      hurt.push({ bone, x1: i32(), x2: i32(), r: i32() });
    }
    const motions: Record<MotionKind, BakedMotion> = {};
    const clocks: Record<MotionKind, MotionClock> = {};
    const nm = u16();
    const stride = nb * BONE_POSE_STRIDE;
    for (let mi = 0; mi < nm; mi++) {
      const name = str();
      const kind = KINDS[u8()];
      check(kind !== undefined, `${fighter}/${name}: unknown clock kind`);
      const frames = u16();
      check(frames >= 1, `${fighter}/${name} has ${frames} frames; a motion needs at least 1`);
      const n = frames * stride;
      need(n * 2);
      const data = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const d = view.getInt16(at + i * 2, true) * BAKE_QUANTUM;
        data[i] = i < stride ? d : data[i - stride] + d;
      }
      at += n * 2;
      motions[name] = { frames, data };
      clocks[name] = { kind, frames };
    }
    out.push({ bones: { fighter, bones, motions }, clocks, hurt });
  }
  check(at === bytes.length, `${bytes.length - at} trailing bytes`);
  return out;
}
