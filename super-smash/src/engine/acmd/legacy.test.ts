import { describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { ONE } from "../fixed";
import { activeHitboxes } from "../hitbox";
import { projectilesDueOnFrame } from "../projectile";
import type { Hitbox, MoveDef, MoveSlot } from "../types";
import { LEGACY_BONE_TABLE } from "./bones";
import { scriptHitboxes } from "./hitboxes";
import { runScript } from "./interpreter";
import { SLOT_MOTION, THROW_SLOTS as THROWS, absFromHitbox, attackFromHitbox, gameScriptFor, legacyGameScript } from "./legacy";
import type { AcmdScript } from "./types";

/** The box a legacy throw launches with: the last to open. */
function lastToOpen(move: MoveDef): Hitbox | null {
  let last: Hitbox | null = null;
  for (const hb of move.hitboxes) if (!hb.grabbing && (last === null || hb.startFrame >= last.startFrame)) last = hb;
  return last;
}

/** A hitbox with its defaults spelled out, so "absent" and "explicitly the default" compare equal. */
function canonical(hb: Hitbox) {
  return {
    id: hb.id,
    x: hb.x,
    y: hb.y,
    radius: hb.radius,
    damage: hb.damage,
    angle: hb.angle,
    baseKnockback: hb.baseKnockback,
    knockbackGrowth: hb.knockbackGrowth,
    effect: hb.effect ?? "normal",
    fixedKnockback: hb.fixedKnockback ?? 0,
    setWeight: hb.setWeight === true,
    transcendent: hb.transcendent === true,
    hitlagMultiplier: hb.hitlagMultiplier ?? ONE,
    shieldstunMultiplier: hb.shieldstunMultiplier ?? ONE,
    meteor: hb.meteor === true,
    grabbing: hb.grabbing === true,
    windbox: hb.windbox === true,
    // A capsule's far end (ruling P5-R19), an axis it leaves out being the near end's.
    farEnd: hb.x2 === undefined && hb.y2 === undefined ? null : { x: hb.x2 ?? hb.x, y: hb.y2 ?? hb.y },
  };
}

/**
 * Every move the compiled legacy script runs: every defined move but those an
 * imported script overrides (Plan 3, Task 18). An overridden slot's table is
 * the script's own boxes, proven against the script in `acmd/active.test.ts`,
 * and nothing compiles it.
 */
const MOVES: [string, MoveSlot, MoveDef][] = FIGHTERS.flatMap((f) =>
  (Object.keys(f.moves) as MoveSlot[])
    .filter((slot) => f.scripts?.[slot] === undefined)
    .map((slot): [string, MoveSlot, MoveDef] => [f.id, slot, f.moves[slot]!]),
);

/**
 * The legacy momentum rule (`applyMoveMomentum` before Task 15): first entry whose
 * window holds, and its place in the list (Plan 5, Task 13b: what the move says of
 * that window, its aim and its hand-off, is read by it).
 */
function legacyMomentum(move: MoveDef, frame: number) {
  const windows = move.momentum ?? [];
  for (let order = 0; order < windows.length; order++) {
    const m = windows[order];
    const until = m.frame + (m.hold ?? 0);
    if (frame >= m.frame && frame <= until) return { x: m.x, y: m.y, until, order, ...(m.airOnly === true ? { airOnly: true } : {}) };
  }
  return null;
}

describe("legacy moves compiled to game_ scripts", () => {
  it("covers the whole roster", () => {
    // 166 before Plan 5 Task 7 ran 28 throws and pummels from their scripts.
    expect(MOVES.length).toBeGreaterThan(130);
    // No sampling: every defined move of every fighter is a case below, filed under its own
    // slot, or runs a script of its own.
    const overridden = FIGHTERS.reduce((n, f) => n + Object.keys(f.scripts ?? {}).length, 0);
    expect(MOVES.length + overridden).toBe(FIGHTERS.reduce((n, f) => n + Object.values(f.moves).length, 0));
    for (const [id, slot, move] of MOVES) {
      expect(move.slot, `${id} ${slot}`).toBe(slot);
      // ...and the frames the cases below walk (1 to totalFrames + 10) hold every frame the move mentions.
      const mentioned = [
        ...move.hitboxes.flatMap((h) => [h.startFrame, h.endFrame + 1]),
        ...(move.projectiles ?? []).map((p) => p.spawnFrame),
        ...(move.momentum ?? []).flatMap((m) => [m.frame, m.frame + (m.hold ?? 0) + 1]),
        ...(move.superArmourFrames === undefined ? [] : [move.superArmourFrames[0], move.superArmourFrames[1] + 1]),
      ];
      expect(Math.max(0, ...mentioned), `${id} ${slot}`).toBeLessThanOrEqual(move.totalFrames + 10);
    }
  });

  it.each(MOVES)("%s %s: the same hitboxes, in the same order, on every frame", (fighterId, slot, move) => {
    const script = legacyGameScript(move);
    // Plan 5: a throw's launch is an ATTACK_ABS, not a box in the world.
    const launch = THROWS.has(slot) ? lastToOpen(move) : null;
    for (let g = 1; g <= move.totalFrames + 10; g++) {
      const want = activeHitboxes(move, g)
        .filter((hb) => hb !== launch)
        .map(canonical);
      const got = scriptHitboxes(runScript(script, g), fighterId, script.motion, g, LEGACY_BONE_TABLE).map(canonical);
      expect(got, `frame ${g}`).toEqual(want);
    }
  });

  it.each(MOVES)("%s %s: the same projectiles, armour and momentum on every frame", (_id, _slot, move) => {
    const script = legacyGameScript(move);
    for (let g = 1; g <= move.totalFrames + 10; g++) {
      const st = runScript(script, g);
      const spawned = st.fired.flatMap((c) => (c.op === "spawnProjectile" ? [c.id] : []));
      expect(spawned, `spawns on frame ${g}`).toEqual(projectilesDueOnFrame(move, g).map((p) => p.id));
      const armour = move.superArmourFrames;
      expect(st.superArmour, `armour on frame ${g}`).toBe(armour !== undefined && g >= armour[0] && g <= armour[1]);
      expect(st.momentum, `momentum on frame ${g}`).toEqual(legacyMomentum(move, g));
    }
  });

  // Donkey Kong's forward throw only lifts (Plan 5, Task 8: the cargo): it has no launch.
  it.each(MOVES.filter(([, slot, move]) => THROWS.has(slot) && move.hitboxes.length > 0))("%s %s: lands its launch on the held fighter, on its frame (Plan 5)", (_id, _slot, move) => {
    const script = legacyGameScript(move);
    const launch = lastToOpen(move)!;
    for (let g = 1; g <= move.totalFrames + 10; g++) {
      const st = runScript(script, g);
      expect(st.catchOnly, `catch-only on frame ${g}`).toBe(true);
      expect(st.fired.some((c) => c.op === "hitAbs"), `ATK_HIT_ABS on frame ${g}`).toBe(g === launch.startFrame);
      if (g >= launch.startFrame) expect(st.throwAbs).toEqual(absFromHitbox(launch));
    }
  });

  it("lets a pummel hit only the fighter held (Plan 5)", () => {
    for (const [, slot, move] of MOVES) {
      if (slot === "pummel") expect(runScript(legacyGameScript(move), 1).catchOnly).toBe(true);
    }
  });

  // Ruling P5-R7: a legacy back throw authored pointing forward turns its thrower
  // on `turnAt`, the game's `REVERSE_LR()`; nothing else ever turns one.
  it.each(MOVES.filter(([, slot]) => THROWS.has(slot)))("%s %s: turns its thrower exactly on its turnAt, if it has one (Plan 5)", (_id, _slot, move) => {
    const script = legacyGameScript(move);
    for (let g = 1; g <= move.totalFrames + 10; g++) {
      const turns = runScript(script, g).fired.filter((c) => c.op === "reverseLr").length;
      expect(turns, `REVERSE_LR on frame ${g}`).toBe(g === move.turnAt ? 1 : 0);
    }
  });

  it("compiles turnAt only where it is set, and to nothing but a turn", () => {
    const plain: MoveDef = {
      slot: "bthrow",
      name: "stand-in",
      totalFrames: 20,
      hitboxes: [{ id: 0, startFrame: 6, endFrame: 6, x: 0, y: 0, radius: ONE, damage: ONE, angle: 45 * ONE, baseKnockback: 0, knockbackGrowth: 0 }],
    };
    const without = legacyGameScript(plain).commands;
    const turning = legacyGameScript({ ...plain, turnAt: 5 }).commands;
    expect(without.some((c) => c.op === "reverseLr")).toBe(false);
    expect(turning.filter((c) => !(c.op === "reverseLr" || (c.op === "frame" && c.frame === 5)))).toEqual(without);
    expect(runScript(legacyGameScript({ ...plain, turnAt: 5 }), 5).fired.map((c) => c.op)).toEqual(["reverseLr"]);
  });

  it("names each script after the motion its slot plays", () => {
    const mario = FIGHTERS.find((f) => f.id === "mario")!;
    expect(gameScriptFor(mario, "jab1")?.name).toBe("game_attack11");
    expect(gameScriptFor(mario, "nair")?.motion).toBe(SLOT_MOTION.nair);
  });

  it("compiles once per move and prefers a fighter's own script", () => {
    const mario = FIGHTERS.find((f) => f.id === "mario")!;
    expect(gameScriptFor(mario, "fair")).toBe(gameScriptFor(mario, "fair"));
    const own = { name: "game_attackairf", motion: "attack_air_f", commands: [] };
    expect(gameScriptFor({ ...mario, scripts: { fair: own } }, "fair")).toBe(own);
    expect(gameScriptFor(mario, "rapidJab")).toBeNull();
  });
});

// Plan 3, Task 17 fix round 1 refused a far end on a legacy hitbox, which the compile then
// dropped. Plan 5 (ruling P5-R19, Task 15: Jungle Rush's detection punch) compiles it: the
// far end goes into `ATTACK(..., X2, Y2, Z2)` on the root bone as the near end does,
// facing-relative x as the script's Z and y as its Y, so the move keeps its whole box.
describe("a legacy hitbox with a far end", () => {
  const sphere: Hitbox = {
    id: 3,
    startFrame: 4,
    endFrame: 6,
    x: 0,
    y: 0,
    radius: ONE,
    damage: ONE,
    angle: 0,
    baseKnockback: 0,
    knockbackGrowth: 0,
  };

  it.each([
    ["x2 alone", { x2: 7 * ONE }, { z2: 7 * ONE }],
    ["y2 alone", { y2: 5 * ONE }, { y2: 5 * ONE }],
    ["both", { x2: 7 * ONE, y2: 5 * ONE }, { y2: 5 * ONE, z2: 7 * ONE }],
  ])("compiles %s as the capsule's far end, the other axis staying the near end's", (_, far, params) => {
    const compiled = attackFromHitbox({ ...sphere, ...far });
    expect(compiled).toMatchObject({ id: 3, size: ONE, ...params });
    expect(compiled.x2).toBeUndefined();
    for (const k of ["y2", "z2"] as const) if (!(k in params)) expect(compiled[k], k).toBeUndefined();
  });

  it("compiles a sphere as it always did, with no far end", () => {
    const compiled = attackFromHitbox(sphere);
    expect(compiled).toMatchObject({ id: 3, size: ONE });
    for (const k of ["x2", "y2", "z2"] as const) expect(compiled[k], k).toBeUndefined();
  });

  it("puts the far end where the move's table has it", () => {
    const move: MoveDef = { slot: "jab1", name: "Jab", totalFrames: 10, hitboxes: [{ ...sphere, x: 2 * ONE, y: 4 * ONE, x2: 9 * ONE, y2: 6 * ONE }] };
    const script = legacyGameScript(move);
    const [got] = scriptHitboxes(runScript(script, 4), "t", script.motion, 4, LEGACY_BONE_TABLE);
    expect(got).toMatchObject({ x: 2 * ONE, y: 4 * ONE, x2: 9 * ONE, y2: 6 * ONE });
  });

  it("compiles a grab box's far end too, as a CATCH's", () => {
    const move: MoveDef = { slot: "grab", name: "Grab", totalFrames: 10, hitboxes: [{ ...sphere, grabbing: true, x2: 7 * ONE }] };
    const c = legacyGameScript(move).commands.find((cmd) => cmd.op === "catch");
    expect(c?.op === "catch" ? c.params : null).toMatchObject({ id: 3, z: 0, z2: 7 * ONE });
  });
});

// Plan 5, Task 6: a windbox is a smash-script `Flinchless=true` box (F.L.U.D.D.'s
// `mario_pumpwater` `Regular` sets `DisableHitlag=true` too), both ways.
describe("a windbox through the legacy compile", () => {
  const box: Hitbox = {
    id: 0,
    startFrame: 2,
    endFrame: 3,
    x: ONE,
    y: ONE,
    radius: ONE,
    damage: 0,
    angle: 55 * ONE,
    baseKnockback: 0,
    knockbackGrowth: 100 * ONE,
    fixedKnockback: 70 * ONE,
    windbox: true,
  };
  const move = (hb: Hitbox): MoveDef => ({ slot: "jab1", name: "stand-in", totalFrames: 10, hitboxes: [hb] });
  const live = (m: MoveDef) => {
    const script = legacyGameScript(m);
    return scriptHitboxes(runScript(script, 2), "mario", script.motion, 2, LEGACY_BONE_TABLE);
  };

  it("compiles to both flags, and reads back as a windbox", () => {
    expect(attackFromHitbox(box)).toMatchObject({ flinchless: true, noHitlag: true });
    expect(live(move(box))[0].windbox).toBe(true);
  });

  it("is neither flag for an ordinary box, and an ordinary box reads back as one", () => {
    const plain: Hitbox = { ...box, windbox: undefined };
    expect(attackFromHitbox(plain)).toMatchObject({ flinchless: false, noHitlag: false });
    expect(live(move(plain))[0].windbox).toBeUndefined();
  });

  // SmashWiki "Hitbox" (https://www.ssbwiki.com/Hitbox): `Flinchless` "prevents
  // the hitbox from inflicting hitstun or hitlag; any knockback coded for the
  // hitbox instead pushes or pulls opponents, which is commonly referred to as a
  // windbox" (Plan 5, Task 6 fix round 1).
  const scripted = (flags: { flinchless: boolean; noHitlag: boolean }) => {
    const script: AcmdScript = { name: "game_test", motion: "attack_11", commands: [{ op: "frame", frame: 1 }, { op: "attack", params: { ...attackFromHitbox(box), ...flags } }] };
    return scriptHitboxes(runScript(script, 1), "mario", "attack_11", 1, LEGACY_BONE_TABLE)[0];
  };

  it("is `Flinchless` alone, with or without `DisableHitlag`", () => {
    expect(scripted({ flinchless: true, noHitlag: false }).windbox).toBe(true);
    expect(scripted({ flinchless: true, noHitlag: true }).windbox).toBe(true);
  });

  it("is not `DisableHitlag` alone: Donkey Kong's and Kirby's imported boxes stay hits", () => {
    expect(scripted({ flinchless: false, noHitlag: true }).windbox).toBeUndefined();
  });
});
