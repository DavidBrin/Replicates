// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LEGACY_BONE_TABLE, type BoneTable } from "@/engine/acmd/bones";
import { restEcb } from "@/engine/acmd/hurtboxes";
import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import { ONE, fx, toFloat } from "@/engine/fixed";
import type { FighterDef, Hitbox, MoveSlot } from "@/engine/types";
import { readBakeFromDisk } from "@/game/bakeNode";
import { boneRole } from "@/render3d/retarget/placeable";
import { SKELETONS } from "@/render3d/skeletons";
import { FIGHTERS } from "../index";
import { withReferenceScripts } from "./active";
import { DIRECTION, along, dirOf, type Dir, type Klass } from "./hitDirection";
import { REFERENCE_SCRIPTS } from "./index";
import { LIMB_HOLD, LIMB_SCRIPT_SLOTS, withLimbScripts } from "./limb";

/**
 * A limb-bone hitbox goes where our clip puts the limb, not where Ultimate's
 * animation would (Plan 4 risk 1). This ratchet catches a clip that puts an
 * adopted move's reach somewhere a player would call wrong, frame by frame and
 * in the direction the move hits (Task 13 fix round 1):
 *
 * - every limb slot has a direction class (`DIRECTION`): forward, back, up,
 *   down, or a sweep — a spin or arc whose legacy box stands still;
 * - on every game frame both the legacy table and the limb one have a live hit
 *   or catch box, the limb's reach in that direction may not fall below 0.8× the
 *   legacy reach by more than a unit; a sweep compares its best reach over the
 *   whole move instead;
 * - a move that reaches further than it did, by over 3 units or 30% of its
 *   legacy reach over the move, or one whose loss is allowed, is listed in
 *   `reach.allow.json` with what was measured, a class and a reason, which the
 *   test checks against the measurement. A new one fails until a human looks:
 *
 *   UPDATE_REACH=1 pnpm vitest run src/fighters/acmd/reach.test.ts
 *
 * keeps every entry's class and reason, and marks a new entry "unreviewed".
 * Reach is from the fighter's origin, between the feet, in the facing frame: a
 * box on the wrong side of the fighter counts negative.
 */

const FILE = join(process.cwd(), "src", "fighters", "acmd", "reach.allow.json");
const bake = readBakeFromDisk();

/** A live box and the bone it hangs off. */
interface Live {
  readonly box: Hitbox;
  readonly bone: string;
}

/** How far a box reaches in direction `d`: the further of its ends along `d`, plus its radius (Q12). */
function reachOf(h: Hitbox, d: Dir): number {
  let best = -Infinity;
  for (const [x, y] of [
    [h.x, h.y],
    [h.x2 ?? h.x, h.y2 ?? h.y],
  ]) {
    best = Math.max(best, along(d, x, y) + h.radius);
  }
  return best;
}

/** The furthest of `live` along `d`, and the bone of the box that reaches it; null for no boxes. */
function furthest(live: readonly Live[], d: Dir): { reach: number; bone: string } | null {
  let best: { reach: number; bone: string } | null = null;
  for (const l of live) {
    const r = reachOf(l.box, d);
    if (best === null || r > best.reach) best = { reach: r, bone: l.bone };
  }
  return best;
}

/** The hit and catch boxes live on each game frame 1..`last` of `slot`, with their bones. */
function framesOf(def: FighterDef, slot: MoveSlot, bones: BoneTable, last: number): Live[][] {
  const script = gameScriptFor(def, slot)!;
  const out: Live[][] = [];
  for (let g = 1; g <= last; g++) {
    const st = runScript(script, g);
    const boxes = scriptHitboxes(st, def.id, script.motion, g, bones);
    // `scriptHitboxes` lists the attacks, then the catches, in the state's order.
    const named = [...st.attacks.map((a) => a.bone), ...st.catches.map((c) => c.bone)];
    out.push(boxes.map((box, i) => ({ box, bone: named[i] })));
  }
  return out;
}

interface Verdict {
  /** Shared frames on which the limb reach is below 0.8× the legacy one, and more than a unit below (not for a sweep). */
  readonly losses: readonly { g: number; legacy: number; limb: number; bone: string }[];
  readonly shared: number;
  /** The best reach along the class's direction over the move, each table, and the limb's box bone there. */
  readonly envelope: { legacy: number; limb: number; bone: string };
  /** A sweep whose best limb reach is below 0.8× the legacy one. */
  readonly sweepLoss: boolean;
  /** The limb reaches further than the legacy move by over 3 units or 30%. */
  readonly gain: boolean;
}

const below = (limb: number, legacy: number): boolean => limb * 5 < legacy * 4 && limb < legacy - ONE;

/** Judge a limb table against its legacy one, frame by frame (`frames[g - 1]`). */
function judge(legacy: readonly (readonly Live[])[], limb: readonly (readonly Live[])[], klass: Klass): Verdict {
  const d = dirOf(klass);
  const sweep = klass !== d;
  const losses: { g: number; legacy: number; limb: number; bone: string }[] = [];
  let shared = 0;
  let envLegacy = -Infinity;
  let envLimb: { reach: number; bone: string } = { reach: -Infinity, bone: "" };
  for (let i = 0; i < Math.max(legacy.length, limb.length); i++) {
    const l = furthest(legacy[i] ?? [], d);
    const g = furthest(limb[i] ?? [], d);
    if (l !== null) envLegacy = Math.max(envLegacy, l.reach);
    if (g !== null && g.reach > envLimb.reach) envLimb = g;
    if (l === null || g === null) continue;
    shared++;
    if (!sweep && below(g.reach, l.reach)) losses.push({ g: i + 1, legacy: l.reach, limb: g.reach, bone: g.bone });
  }
  const envelope = { legacy: envLegacy, limb: envLimb.reach, bone: envLimb.bone };
  return {
    losses,
    shared,
    envelope,
    sweepLoss: sweep && envelope.limb * 5 < envelope.legacy * 4,
    gain: envelope.limb - envelope.legacy > Math.max(fx(3), (Math.abs(envelope.legacy) * 3) / 10),
  };
}

const offends = (v: Verdict): boolean => v.losses.length > 0 || v.sweepLoss || v.gain;

const f1 = (n: number): string => toFloat(n).toFixed(1);
const ratio = (limb: number, legacy: number): number => (legacy > 0 ? limb / legacy : Infinity);

/** What was measured, as the allowlist records it. */
function measured(klass: Klass, v: Verdict): string {
  const r = ratio(v.envelope.limb, v.envelope.legacy);
  let s = `${klass}: best ${f1(v.envelope.legacy)} -> ${f1(v.envelope.limb)} (x${Number.isFinite(r) ? r.toFixed(2) : "-"})`;
  if (v.losses.length > 0) {
    const worst = v.losses.reduce((a, b) => (ratio(b.limb, b.legacy) < ratio(a.limb, a.legacy) ? b : a));
    s += `; below 0.8x on ${v.losses.length} of ${v.shared} shared frames, worst g${worst.g} ${f1(worst.legacy)} -> ${f1(worst.limb)}`;
  }
  return s;
}

/** The legacy fighter and its game form for `id`. */
const pair = (id: string): { legacy: FighterDef; game: FighterDef } => {
  const legacy = FIGHTERS.find((f) => f.id === id)!;
  return { legacy, game: withLimbScripts(legacy, bake.bones) };
};

/** `slot` of `legacy` judged with its limb form `game`. */
function verdictOf(legacy: FighterDef, game: FighterDef, slot: MoveSlot, klass: Klass): Verdict {
  const last = Math.max(legacy.moves[slot]!.totalFrames, game.moves[slot]!.totalFrames);
  return judge(framesOf(legacy, slot, LEGACY_BONE_TABLE, last), framesOf(game, slot, bake.bones, last), klass);
}

/** Every limb slot, judged. */
function survey(): Map<string, { klass: Klass; verdict: Verdict; id: string; slot: MoveSlot }> {
  const out = new Map<string, { klass: Klass; verdict: Verdict; id: string; slot: MoveSlot }>();
  for (const f of FIGHTERS) {
    const { legacy, game } = pair(f.id);
    for (const slot of LIMB_SCRIPT_SLOTS[f.id] ?? []) {
      const key = `${f.id} ${slot}`;
      const klass = DIRECTION[key];
      if (klass === undefined) continue;
      out.set(key, { klass, verdict: verdictOf(legacy, game, slot, klass), id: f.id, slot });
    }
  }
  return out;
}

/** The fighter's size ratio: its baked standing height over the legacy `attributes.height`. */
function sizeRatio(id: string): number {
  const def = FIGHTERS.find((f) => f.id === id)!;
  return restEcb(def, bake)!.top / def.attributes.height;
}

type AllowClass = "root-exact" | "sweep" | "size" | "clip-gain";
interface AllowEntry {
  readonly measured: string;
  readonly class: AllowClass | "unreviewed";
  readonly reason: string;
}

const readAllow = (): Record<string, AllowEntry> => JSON.parse(readFileSync(FILE, "utf8")) as Record<string, AllowEntry>;

const isRoot = (id: string, bone: string): boolean => boneRole(SKELETONS[id], bone).kind === "root";

/**
 * What the measurement must show for an entry's class to hold, or null:
 * - `root-exact`: the limb's reach, at its best and on every loss frame, comes
 *   from a box on the root (`top`, `trans`): on `top` at the script's own
 *   offset; on `trans`, the skeleton's root, at that offset as the clip's
 *   whole-body offset, turn and squash carry it;
 * - `sweep`: a sweep class whose best reach holds (no `sweepLoss`), or a loss
 *   on a single frame (an arc's first frame);
 * - `size`: a gain off a clip-placed bone, no loss, within 1.25× the size ratio;
 * - `clip-gain`: a gain off a clip-placed bone beyond 1.25× the size ratio.
 */
function classProblem(id: string, klass: Klass, v: Verdict, cls: AllowEntry["class"]): string | null {
  const r = ratio(v.envelope.limb, v.envelope.legacy);
  const cap = 1.25 * sizeRatio(id);
  switch (cls) {
    case "root-exact":
      if (!isRoot(id, v.envelope.bone) || v.losses.some((l) => !isRoot(id, l.bone))) return "its reach is not from a root box";
      return null;
    case "sweep":
      if (v.sweepLoss) return `its best reach ${f1(v.envelope.limb)} is below 0.8x the legacy ${f1(v.envelope.legacy)}`;
      return klass !== dirOf(klass) || v.losses.length === 1 ? null : "not a sweep, nor a single-frame loss";
    case "size":
      if (!v.gain || v.losses.length > 0 || isRoot(id, v.envelope.bone)) return "not a clip-placed gain without a loss";
      return r <= cap ? null : `x${r.toFixed(2)} is beyond 1.25 x the size ratio (${cap.toFixed(2)})`;
    case "clip-gain":
      if (!v.gain || v.losses.length > 0 || isRoot(id, v.envelope.bone)) return "not a clip-placed gain without a loss";
      return r > cap ? null : `x${r.toFixed(2)} is within 1.25 x the size ratio (${cap.toFixed(2)}): size`;
    default:
      return "unreviewed";
  }
}

describe("adopted moves reach about as far as they did, every frame, the way they hit (Plan 4)", () => {
  const now = survey();
  const offenders = [...now].filter(([, s]) => offends(s.verdict));

  if (process.env.UPDATE_REACH === "1") {
    it("writes reach.allow.json, keeping each entry's class and reason", () => {
      const before = readAllow();
      const out: Record<string, AllowEntry> = {};
      for (const [key, s] of offenders) {
        out[key] = { measured: measured(s.klass, s.verdict), class: before[key]?.class ?? "unreviewed", reason: before[key]?.reason ?? "" };
      }
      writeFileSync(FILE, JSON.stringify(out, null, 2) + "\n");
    });
    return;
  }

  it("classes every limb slot by the way it hits, and only slots the census admits or holds", () => {
    const limb = FIGHTERS.flatMap((f) => (LIMB_SCRIPT_SLOTS[f.id] ?? []).map((s) => `${f.id} ${s}`));
    const held = LIMB_HOLD.map((h) => `${h.fighter} ${h.move}`);
    expect(limb.filter((k) => DIRECTION[k] === undefined), "unclassified limb slots").toEqual([]);
    expect(Object.keys(DIRECTION).filter((k) => !limb.includes(k) && !held.includes(k)), "classes for slots that are neither").toEqual([]);
  });

  it("loses no reach on any shared frame, unless the loss is allowed", () => {
    const allow = readAllow();
    const lost = offenders
      .filter(([key, s]) => (s.verdict.losses.length > 0 || s.verdict.sweepLoss) && allow[key] === undefined)
      .map(([key, s]) => `${key} ${measured(s.klass, s.verdict)}`);
    expect(lost).toEqual([]);
  });

  it("differs only where the allowlist says, and by what it says", () => {
    const allow = readAllow();
    expect(Object.fromEntries(offenders.map(([key, s]) => [key, measured(s.klass, s.verdict)]))).toEqual(
      Object.fromEntries(Object.entries(allow).map(([key, e]) => [key, e.measured])),
    );
  });

  it("gives every allowed entry a class its measurement supports, and a reason", () => {
    const problems: string[] = [];
    for (const [key, e] of Object.entries(readAllow())) {
      const s = now.get(key);
      if (s === undefined) continue; // the test above names it
      const p = classProblem(s.id, s.klass, s.verdict, e.class);
      if (p !== null) problems.push(`${key} (${e.class}): ${p}`);
      if (e.reason.trim().length < 20) problems.push(`${key}: no reason`);
    }
    expect(problems).toEqual([]);
  });

  it("allows no held slot: a held slot keeps its legacy table", () => {
    const held = new Set(LIMB_HOLD.map((h) => `${h.fighter} ${h.move}`));
    expect(Object.keys(readAllow()).filter((k) => held.has(k))).toEqual([]);
  });
});

/*
 * The ratchet's own cases. The held slot is a real one it must catch (Samus's
 * down air, the cannon at her chest), and so is Samus's grab as it would be with
 * its box on a bone no clip moves; the rest are made up. The slots Task 13b
 * freed (a back air swung to the front, a 37% loss) now pass, and their clips as
 * first drawn are pinned by `strike.test.ts`.
 */
describe("the ratchet", () => {
  it("still catches every held slot, so each hold is still needed (lift it when its clip is fixed)", () => {
    const passing: string[] = [];
    for (const h of LIMB_HOLD) {
      const { legacy } = pair(h.fighter);
      const forced = withReferenceScripts(legacy, REFERENCE_SCRIPTS[h.fighter], [h.move], bake.bones);
      const v = verdictOf(legacy, forced, h.move, DIRECTION[`${h.fighter} ${h.move}`]);
      if (!(v.losses.length > 0 || v.sweepLoss)) passing.push(`${h.fighter} ${h.move}`);
    }
    expect(passing).toEqual([]);
  });

  it("catches Samus's down air with the cannon at her chest, on every live frame", () => {
    const { legacy } = pair("samus");
    const forced = withReferenceScripts(legacy, REFERENCE_SCRIPTS.samus, ["dair"], bake.bones);
    const v = verdictOf(legacy, forced, "dair", "D");
    expect(v.losses.length).toBe(v.shared);
    expect(v.shared).toBe(7);
  });

  it.each(["grab", "dashGrab"] as const)("catches Samus's %s with its box on the never-animated `throw` bone, catches included", (slot) => {
    const { legacy } = pair("samus");
    const forced = withReferenceScripts(legacy, REFERENCE_SCRIPTS.samus, [slot], bake.bones);
    const v = verdictOf(legacy, forced, slot, "F");
    expect(v.losses.length).toBe(5);
    // Over the move as a whole it reaches about as far: only frame by frame shows the loss.
    expect(v.envelope.legacy - v.envelope.limb).toBeLessThan(fx(3));
  });

  /** A box `x` forward (`y` up) of the origin, radius 1, on `bone`. */
  const box = (x: number, y = 0, bone = "arml"): Live => ({
    box: { id: 0, startFrame: 1, endFrame: 1, x: fx(x), y: fx(y), radius: fx(1), damage: 0, angle: 0, baseKnockback: 0, knockbackGrowth: 0 },
    bone,
  });
  const frames = (n: number, b: (g: number) => Live[]): Live[][] => Array.from({ length: n }, (_, i) => b(i + 1));

  it("catches a box that collapses after its first live frame", () => {
    const v = judge(frames(5, () => [box(10)]), frames(5, (g) => [box(g === 1 ? 10 : 1)]), "F");
    expect(v.losses.map((l) => l.g)).toEqual([2, 3, 4, 5]);
  });

  it("catches a back move swung to the front", () => {
    expect(judge(frames(3, () => [box(-10)]), frames(3, () => [box(6)]), "B").losses).toHaveLength(3);
  });

  it("catches a 37% loss, and lets 15% or less than a unit through", () => {
    expect(judge(frames(2, () => [box(9)]), frames(2, () => [box(5.3)]), "F").losses).toHaveLength(2);
    expect(judge(frames(2, () => [box(9)]), frames(2, () => [box(7.5)]), "F").losses).toHaveLength(0);
    expect(judge(frames(2, () => [box(1)]), frames(2, () => [box(0.2)]), "F").losses).toHaveLength(0);
  });

  it("reads a down move below the feet, an up move above them", () => {
    expect(judge(frames(2, () => [box(0, -6)]), frames(2, () => [box(8, 7)]), "D").losses).toHaveLength(2);
    expect(judge(frames(2, () => [box(0, 15)]), frames(2, () => [box(0, 16)]), "U").losses).toHaveLength(0);
  });

  it("judges a sweep by its best reach over the move, not frame by frame", () => {
    const legacy = frames(4, () => [box(9)]);
    const spin = frames(4, (g) => [box(g === 2 ? 10 : -3)]);
    expect(judge(legacy, spin, "SWEEP F")).toMatchObject({ losses: [], sweepLoss: false });
    expect(judge(legacy, frames(4, () => [box(4)]), "SWEEP F").sweepLoss).toBe(true);
  });

  it("refuses the sweep class to a sweep whose best reach collapsed (Samus's nair, 9.5 -> 7.0)", () => {
    // The loss check leaves allowlisted slots to the class check, so the class
    // check is where a collapsed sweep has to fail, not only the `measured` text.
    const v = judge(frames(4, () => [box(8.5)]), frames(4, (g) => [box(g === 2 ? 6 : -3)]), "SWEEP F");
    expect(v.sweepLoss).toBe(true);
    expect(classProblem("samus", "SWEEP F", v, "sweep")).toMatch(/best reach .* below 0\.8x/);
    // The same spin at its committed best (16.0) still passes.
    expect(classProblem("samus", "SWEEP F", judge(frames(4, () => [box(8.5)]), frames(4, (g) => [box(g === 2 ? 15 : -3)]), "SWEEP F"), "sweep")).toBeNull();
  });

  it("measures a capsule to whichever end reaches further, whichever end is written first", () => {
    const capsule = (x: number, x2: number): Live => ({ ...box(x), box: { ...box(x).box, x2: fx(x2), y2: 0 } });
    expect(furthest([capsule(2, 9)], "F")!.reach).toBe(fx(10));
    expect(furthest([capsule(9, 2)], "F")!.reach).toBe(fx(10));
    expect(furthest([capsule(9, 2)], "B")!.reach).toBe(fx(-1));
  });
});
