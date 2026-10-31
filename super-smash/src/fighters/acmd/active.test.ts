import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { moveReach } from "@/ai/behaviours";
import { decodeBake } from "@/engine/acmd/bakeCodec";
import { LEGACY_BONE_TABLE, TOP_POSE, newBonePose } from "@/engine/acmd/bones";
import { ATTACK, clearAll, frame, loop, reverseLr, unknown } from "@/engine/acmd/dsl";
import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { gameFrameOfMotion, runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import { prepareFighterScripts, smashHoldFrame } from "@/engine/acmd/run";
import { fx } from "@/engine/fixed";
import { activeHitboxes, chargeHoldFrame } from "@/engine/hitbox";
import { createInitialState, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { AcmdCommand, AcmdScript } from "@/engine/acmd/types";
import type { FighterDef, GameState, Hitbox, InputFrame, MoveSlot } from "@/engine/types";
import { armourWindow } from "@/render/fxKit";
import { moveTimingFor } from "@/render/poses/timing";
import { FIGHTERS } from "../index";
import { STAGES } from "@/stages";
import { ACTIVE_SCRIPT_SLOTS, activatable } from "./active";
import { REFERENCE_SCRIPTS } from "./index";
import { liftScript } from "./lift";
import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "./limb";
import { readBakeFromDisk } from "@/game/bakeNode";

/**
 * The bone table the installed game places every script box through: the bake's
 * (Plan 4; `installBake`). The per-frame proofs below run against it, so what they
 * compare is what the game runs, for Plan 3's root-bone slots and Plan 4's limb-bone
 * slots alike.
 *
 * `withReferenceScripts` placed Plan 3's synced `MoveDef` tables through the
 * root-bone table (`LEGACY_BONE_TABLE`). They stay right under the bake only because
 * the bake places `top` exactly as that table does: it never bakes the root, so `top`
 * falls through the bake's layered table to `TOP_POSE`. The first describe proves that; it fails the day the bake animates the root, when those
 * tables must be placed through the bake too, as the limb-bone ones are.
 */
const BAKE = readBakeFromDisk();
const BONES = BAKE.bones;

describe("the root bone under the bake, which Plan 3's synced tables rely on", () => {
  const baked = decodeBake(new Uint8Array(gunzipSync(readFileSync(join(process.cwd(), "public", "bake", "roster.bin.gz")))));

  it("is never baked: no fighter's baked bones name it", () => {
    expect(baked).toHaveLength(FIGHTERS.length);
    for (const f of baked) expect(f.bones.bones, f.bones.fighter).not.toContain("top");
  });

  it("is placed exactly where the root-bone table places it, on every frame of every baked motion", () => {
    const pose = newBonePose();
    const KEYS = ["tx", "ty", "m00", "m01", "m02", "m10", "m11", "m12"] as const;
    const off: string[] = [];
    let asked = 0;
    for (const f of baked) {
      for (const [motion, m] of Object.entries(f.bones.motions)) {
        for (let k = 1; k <= m.frames; k++, asked++) {
          const placed = BONES.pose(f.bones.fighter, motion, k, "top", pose);
          if (!placed || KEYS.some((key) => pose[key] !== TOP_POSE[key])) off.push(`${f.bones.fighter}/${motion} frame ${k}`);
        }
      }
    }
    expect(off).toEqual([]);
    expect(asked).toBeGreaterThan(10_000);
    // …which is the root-bone table's own answer.
    expect(LEGACY_BONE_TABLE.pose("mario", "attack_11", 1, "top", pose)).toBe(true);
    expect(pose).toEqual(TOP_POSE);
  });
});

/** Every bone a script hangs a box off. */
function bones(commands: readonly AcmdCommand[], out = new Set<string>()): Set<string> {
  for (const c of commands) {
    if (c.op === "attack" || c.op === "catch") out.add(c.params.bone);
    if (c.op === "loop") bones(c.body, out);
  }
  return out;
}

describe("which imported scripts run (Plan 3, Task 18)", () => {
  it("lists exactly the slots the root-bone rule admits", () => {
    for (const def of FIGHTERS) {
      const ref = REFERENCE_SCRIPTS[def.id];
      const admitted = (Object.keys(ref.slots) as MoveSlot[]).filter((slot) => {
        const key = ref.slots[slot] as string;
        return activatable(slot, def.moves[slot], ref.scripts[key]);
      });
      expect([...ACTIVE_SCRIPT_SLOTS[def.id]].sort(), def.id).toEqual(admitted.sort());
    }
  });

  it("runs the imported script itself for every listed slot, and nothing else", () => {
    for (const def of FIGHTERS) {
      const ref = REFERENCE_SCRIPTS[def.id];
      const active = ACTIVE_SCRIPT_SLOTS[def.id];
      expect(Object.keys(def.scripts ?? {}).sort(), def.id).toEqual([...active].sort());
      for (const slot of active) {
        const key = ref.slots[slot] as string;
        expect(def.scripts?.[slot], `${def.id} ${slot}`).toBe(liftScript(ref.scripts[key]));
        // The script's CancelFrame is a motion frame; the move ends on the game
        // frame its motion reaches it (fix round 1).
        const faf = ref.faf[key];
        if (faf !== undefined) expect(def.moves[slot]?.totalFrames, `${def.id} ${slot}`).toBe(gameFrameOfMotion(def.scripts![slot]!, faf) - 1);
      }
    }
  });

  // The boundary with Plan 4: a script that hangs a box off a limb bone needs
  // the bone bake to place it, so it stays on its compiled legacy script.
  it("activates no script with a box on any bone but the root", () => {
    for (const def of FIGHTERS) {
      for (const script of Object.values(def.scripts ?? {}) as AcmdScript[]) {
        // A throw that lands only by ATK_HIT_ABS hangs no box at all (Plan 5).
        const hung = [...bones(script.commands)];
        expect(hung.every((b) => b === "top"), `${def.id} ${script.name}: ${hung.join(",")}`).toBe(true);
      }
    }
  });

  // Plan 5: a throw lands through its ATTACK_ABS, so it may hang no box on a
  // bone; every active throw lands somewhere.
  it("runs a throw's script only when it has an ATK_HIT_ABS to land", () => {
    for (const def of FIGHTERS) {
      for (const slot of ["fthrow", "bthrow", "uthrow", "dthrow"] as const) {
        if (!ACTIVE_SCRIPT_SLOTS[def.id].includes(slot)) continue;
        expect(def.scripts?.[slot]?.commands.some((c) => c.op === "hitAbs"), `${def.id} ${slot}`).toBe(true);
      }
    }
  });
});

// Task 7 fix round 1: `FT_CATCH_STOP` is lifted into a stop only the throw status runs,
// as `REVERSE_LR` is; a script outside a throw that calls either stays on its legacy move.
describe("the throw-only commands", () => {
  const jab = FIGHTERS.find((f) => f.id === "mario")!.moves.jab1;
  const fthrow = FIGHTERS.find((f) => f.id === "mario")!.moves.fthrow;
  const box = ATTACK({ id: 0, bone: "top", damage: 2, angle: 45, kbg: 100, bkb: 40, size: 4, x: 0, y: 6, z: 6 });
  const withCall = (call: string, name: string, motion: string): AcmdScript => ({
    name,
    motion,
    commands: [unknown("ATTACK_ABS(Kind=FIGHTER_ATTACK_ABSOLUTE_KIND_THROW, ID=0, Damage=8.0, Angle=45, KBG=65, FKB=0, BKB=60, Hitlag=0.0)"), frame(3), unknown(call), frame(4), box, unknown("ATK_HIT_ABS(FIGHTER_ATTACK_ABSOLUTE_KIND_THROW, hash40(\"throw\"))"), frame(5), clearAll()],
  });

  it.each(["FT_CATCH_STOP(4, 1)", "REVERSE_LR()"])("admits %s in a throw and refuses it anywhere else", (call) => {
    const lifted = call === "REVERSE_LR()" ? "reverseLr" : "catchStop";
    const raw = withCall(call, "game_throwf", "throw_f");
    expect(liftScript(raw).commands.some((c) => c.op === lifted || (c.op === "unknown" && c.raw === call))).toBe(true);
    const asOp = { ...raw, commands: raw.commands.map((c) => (c.op === "unknown" && c.raw === "REVERSE_LR()" ? reverseLr() : c)) };
    expect(activatable("fthrow", fthrow, asOp)).toBe(true);
    expect(activatable("jab1", jab, { ...asOp, name: "game_attack11", motion: "attack_11" })).toBe(false);
  });
});

// Plan 3, Task 19 fix round 1: the engine models autolink angles 365 and 367 and no others
// (`AUTOLINK_UNMODELLED`: 363, 366, 368), so a script that carries one stays on its legacy move.
describe("autolink angles the engine does not model (Plan 3, Task 19)", () => {
  const jab = FIGHTERS.find((f) => f.id === "mario")!.moves.jab1;
  const scriptAt = (angle: number, inLoop = false): AcmdScript => {
    const box = ATTACK({ id: 0, bone: "top", damage: 2, angle, kbg: 100, bkb: 40, size: 4, x: 0, y: 6, z: 6 });
    return { name: "game_attack11", motion: "attack_11", commands: [frame(4), ...(inLoop ? [loop(2, [box])] : [box]), frame(7), clearAll()] };
  };

  it.each([365, 367, 361, 45])("admits a root-bone script with a box at %i, as the control", (angle) => {
    expect(activatable("jab1", jab, scriptAt(angle))).toBe(true);
  });

  it.each([363, 366, 368])("refuses a script with a box at %i, in a loop too", (angle) => {
    expect(activatable("jab1", jab, scriptAt(angle))).toBe(false);
    expect(activatable("jab1", jab, scriptAt(angle, true))).toBe(false);
  });

  // None is live today: every script the roster runs, and every compiled move and projectile,
  // loads through the same refusal registration applies — and so does every script the
  // installed game runs, limb-bone ones included, against the bake's bones.
  it("is met by no move the roster runs, nor any the installed game runs", () => {
    for (const def of FIGHTERS) {
      expect(() => prepareFighterScripts(def, LEGACY_BONE_TABLE), def.id).not.toThrow();
      expect(() => prepareFighterScripts(withLimbScripts(def, BONES), BONES), def.id).not.toThrow();
    }
  });
});

describe("an activated script in a real match", () => {
  const RULES = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false } as const;
  // The plain roster on the root bone: Plan 3's world, which is what this drill is about.
  const ctx: SimContext = {
    fighter: (id) => FIGHTERS.find((f) => f.id === id)!,
    stage: (id) => STAGES.find((s) => s.id === id)!,
    bones: LEGACY_BONE_TABLE,
  };

  /** Mario above Pikachu, both in the air, Mario down-airs. */
  function dair(): { hits: number; damages: number[]; mario: GameState["fighters"][number] } {
    let s: GameState = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "pikachu" }], RULES, 7, ctx);
    const [m, p] = s.fighters;
    for (const f of s.fighters) Object.assign(f, { action: "fall", actionFrame: 0, grounded: false, platform: -1, intangible: 0 });
    Object.assign(m, { x: 0, y: fx(40), facing: 1 });
    Object.assign(p, { x: 0, y: fx(33), facing: -1 });
    let prev: readonly InputFrame[] = [0, 0];
    let hits = 0;
    const damages: number[] = [];
    for (let i = 0; i < 40; i++) {
      // Both hang in place: the drill is about the hits, not the fall.
      s.fighters[0].y = fx(40);
      s.fighters[1].y = fx(33);
      const now = [i === 0 ? Btn.Down | Btn.Attack : 0, 0];
      const out = step(s, now, { prevInputs: prev, ctx });
      prev = now;
      s = out.state;
      hits += out.events.hits.length;
      for (const h of out.events.hits) damages.push(h.damage);
    }
    return { hits, damages, mario: s.fighters[0] };
  }

  // Mario's down air, game_attackairlw: five 1.4% set-weight hits two frames
  // apart (the legacy table had them as set knockback and landed only one).
  it("lands Mario's down air as a multi-hit", () => {
    expect(dair().hits).toBeGreaterThan(1);
  });

  // …and stales it once (Task 16): one queue entry, every hit as stale as the first.
  it("queues Mario's down air once, and does not stale its later hits", () => {
    const { damages, mario } = dair();
    expect(mario.staleQueue).toEqual(["dair"]);
    expect(new Set(damages).size).toBe(1);
  });
});

/*
 * Plan 3, Task 18 (carried from Plan 2 Task 15): the renderer (`fxKit.ts`, `poses/timing.ts`;
 * the 2D swing arc that read it too went in Plan 4), the CPU (`behaviours.ts`) and the charge
 * hold (`chargeHoldFrame`) read a move's `MoveDef`, and the sim reads its script. An activated slot's `MoveDef` table is the
 * script's own boxes (`withReferenceScripts`), so every reader sees what the sim runs.
 *
 * Every proof runs against the bake's bones, for the 71 root-bone slots (tables placed
 * through the root-bone table, the plain roster) and for Plan 4's limb-bone slots (tables
 * placed through the bake, `withLimbScripts(def, bake.bones)`).
 */
describe("what render, the CPU and the charge hold read of an activated move", () => {
  const ACTIVE: [string, MoveSlot, FighterDef][] = FIGHTERS.flatMap((def) =>
    ACTIVE_SCRIPT_SLOTS[def.id].map((slot): [string, MoveSlot, FighterDef] => [def.id, slot, def]),
  );
  const LIMB: [string, MoveSlot, FighterDef][] = FIGHTERS.flatMap((legacy) => {
    const def = withLimbScripts(legacy, BONES);
    return (LIMB_SCRIPT_SLOTS[def.id] ?? []).map((slot): [string, MoveSlot, FighterDef] => [`${def.id} (limb)`, slot, def]);
  });
  const SYNCED = [...ACTIVE, ...LIMB];

  /** A box with the frames it is live on blanked: what the two sides must agree on frame by frame. */
  const shape = (hb: Hitbox): Hitbox => ({ ...hb, startFrame: 0, endFrame: 0 });

  /** The boxes the sim builds for `slot` on game frame `g` (`gatherHitboxes`). */
  function simBoxes(def: FighterDef, slot: MoveSlot, g: number): Hitbox[] {
    const script = gameScriptFor(def, slot)!;
    return scriptHitboxes(runScript(script, g), def.id, script.motion, g, BONES);
  }

  /** The game frames the sim has a box live on, attack or grab, through the move's end. */
  function simLive(def: FighterDef, slot: MoveSlot): number[] {
    const out: number[] = [];
    for (let g = 1; g <= def.moves[slot]!.totalFrames; g++) if (simBoxes(def, slot, g).length > 0) out.push(g);
    return out;
  }

  // Plan 5 Task 7: +28 throws and pummels on the root bone, +6 on limbs. Task 13: +5 on
  // the root (Mario's down smash and Fireball, Pikachu's smashes and Thunder Jolt) and +9
  // on limbs, three more held (P5-R16).
  // The bake's 66th: Link's aerial Spin Attack (Plan 5, Task 13b).
  it("activates 71 slots, and the bake 66 more", () => {
    expect(ACTIVE).toHaveLength(71);
    expect(LIMB).toHaveLength(66);
  });

  it.each(SYNCED)("%s %s: the move's hitbox table is the script's boxes, on every frame", (_id, slot, def) => {
    const move = def.moves[slot]!;
    for (let g = 1; g <= move.totalFrames + 10; g++) {
      expect(activeHitboxes(move, g).map(shape), `frame ${g}`).toEqual(simBoxes(def, slot, g).map(shape));
    }
  });

  it.each(SYNCED)("%s %s: the CPU's reach is the furthest the sim's boxes reach, far ends included", (_id, slot, def) => {
    let furthest = 0;
    for (let g = 1; g <= def.moves[slot]!.totalFrames; g++) {
      for (const hb of simBoxes(def, slot, g)) furthest = Math.max(furthest, hb.x + hb.radius, (hb.x2 ?? hb.x) + hb.radius);
    }
    expect(moveReach(def.moves[slot]!)).toBe(furthest);
  });

  /** The game frame a throw's `ATK_HIT_ABS` lands on, or null for a move that lands none. */
  function strikeOf(def: FighterDef, slot: MoveSlot): number | null {
    const script = gameScriptFor(def, slot)!;
    for (let g = 1; g <= def.moves[slot]!.totalFrames; g++) if (runScript(script, g).fired.some((c) => c.op === "hitAbs")) return g;
    return null;
  }

  it.each(SYNCED)("%s %s: the charge hold and the animation timing start from the sim's first live frame", (_id, slot, def) => {
    const live = simLive(def, slot);
    const move = def.moves[slot]!;
    const timing = moveTimingFor(def, slot)!;
    // Ruling P5-R9: a throw strikes on its `ATK_HIT_ABS`, boxes or none (a box-less
    // throw would otherwise have no strike at all), and is live until its last box
    // or the launch, whichever is later. A throw never charges.
    const strike = strikeOf(def, slot);
    if (strike !== null) {
      expect(timing.firstActive).toBe(strike - 1);
      expect(timing.lastActive).toBe(Math.max(strike, ...live) - 1);
      expect(timing.chargeHold).toBeUndefined();
      return;
    }
    // A projectile special (Task 13) lands by its spawn and hangs no box: no live
    // frame to start from, and nothing to hold.
    if (live.length === 0) {
      expect(move.projectiles?.length ?? 0, "a move with no box launches something").toBeGreaterThan(0);
      expect(timing.firstActive).toBe(-1);
      expect(timing.chargeHold).toBeUndefined();
      return;
    }
    // `chargeHoldFrame`: one actionFrame before the earliest live one (`actionFrameOf(first) - 1`).
    expect(chargeHoldFrame(move)).toBe(Math.max(1, live[0] - 2));
    // A smash holds where its script raises START_SMASH_HOLD, before any box (P5-R15).
    if (move.chargeable === true) {
      expect(timing.chargeHold).toBe(smashHoldFrame(def, { move: slot }));
      expect(timing.chargeHold).toBeLessThan(live[0] - 1);
    }
    expect(timing.firstActive).toBe(live[0] - 1);
    expect(timing.lastActive).toBe(live[live.length - 1] - 1);
  });

  // Task 13: a script may launch its move's projectile, on its own frame, once; no
  // activated move carries armour, from its script or its legacy move.
  it.each(SYNCED)("%s %s: no armour on any frame of the script, and only its own projectiles, each once", (_id, slot, def) => {
    expect(armourWindow(def, slot)).toBeNull();
    const own = (def.moves[slot]!.projectiles ?? []).map((p) => p.id);
    const script = gameScriptFor(def, slot)!;
    const launched: string[] = [];
    for (let g = 1; g <= def.moves[slot]!.totalFrames + 10; g++) {
      const st = runScript(script, g);
      expect(st.superArmour, `frame ${g}`).toBe(false);
      for (const c of st.fired) if (c.op === "spawnProjectile") launched.push(c.id);
    }
    expect(launched).toEqual(own);
  });
});

// Plan 3, Task 18 (carried from Plan 2 Task 16): the imported Super Jump Punch's legacy move
// carries scripted momentum (`MoveDef.momentum`). Since Plan 5, Task 13 that keeps no move off its
// script (the engine keeps the legacy momentum, `moveMomentum`); it stays on its compiled legacy
// script because the script runs engine calls the replica does not (`SA_SET`,
// `notify_event_msc_cmd`, a costume-flag query).
describe("Mario's up special", () => {
  const mario = FIGHTERS.find((f) => f.id === "mario")!;
  const script = REFERENCE_SCRIPTS.mario.scripts.game_specialhi;

  it("stays on its legacy script: its script runs engine calls the replica does not", () => {
    expect(mario.moves.upB?.momentum).toBeDefined();
    expect(activatable("upB", mario.moves.upB, script)).toBe(false);
    expect(ACTIVE_SCRIPT_SLOTS.mario).not.toContain("upB");
    expect(mario.scripts?.upB).toBeUndefined();
  });

  it("and its momentum is not why (Task 13): with or without it, the same", () => {
    expect(activatable("upB", { ...mario.moves.upB!, momentum: undefined }, script)).toBe(false);
    const runnable = { ...script, commands: script.commands.filter((c) => c.op !== "unknown") };
    expect(activatable("upB", mario.moves.upB, runnable)).toBe(activatable("upB", { ...mario.moves.upB!, momentum: undefined }, runnable));
  });
});
