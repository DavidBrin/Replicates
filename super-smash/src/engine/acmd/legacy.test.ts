import { describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { ONE } from "../fixed";
import { activeHitboxes } from "../hitbox";
import { projectilesDueOnFrame } from "../projectile";
import type { Hitbox, MoveDef, MoveSlot } from "../types";
import { LEGACY_BONE_TABLE } from "./bones";
import { scriptHitboxes } from "./hitboxes";
import { runScript } from "./interpreter";
import { SLOT_MOTION, attackFromHitbox, gameScriptFor, legacyGameScript } from "./legacy";
import type { AcmdScript } from "./types";

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

/** The legacy momentum rule (`applyMoveMomentum` before Task 15): first entry whose window holds. */
function legacyMomentum(move: MoveDef, frame: number) {
  for (const m of move.momentum ?? []) {
    const until = m.frame + (m.hold ?? 0);
    if (frame >= m.frame && frame <= until) return { x: m.x, y: m.y, until };
  }
  return null;
}

describe("legacy moves compiled to game_ scripts", () => {
  it("covers the whole roster", () => {
    expect(MOVES.length).toBeGreaterThan(150);
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

  it.each(MOVES)("%s %s: the same hitboxes, in the same order, on every frame", (fighterId, _slot, move) => {
    const script = legacyGameScript(move);
    for (let g = 1; g <= move.totalFrames + 10; g++) {
      const want = activeHitboxes(move, g).map(canonical);
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

// Plan 3, Task 17 fix round 1: a legacy hitbox is a sphere, and a far end on one would be
// dropped without a word and the move quietly shrunk. A capsule is scripted (`ATTACK(..., X2, Y2, Z2)`).
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
    ["x2", { x2: ONE }],
    ["y2", { y2: ONE }],
  ])("is refused loudly for %s, naming the box", (_, far) => {
    expect(() => attackFromHitbox({ ...sphere, ...far })).toThrow(/hitbox 3.*far end \(x2\/y2\)/);
  });

  it("compiles a sphere as it always did", () => {
    expect(attackFromHitbox(sphere)).toMatchObject({ id: 3, size: ONE });
  });
});

// Plan 5, Task 6: a windbox is smash-script `Flinchless=true, DisableHitlag=true`
// (rubendal Data Viewer 13.0.1, `mario_pumpwater` `Regular`), both ways.
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

  it("needs both: `DisableHitlag` alone (Donkey Kong's, Kirby's imported boxes) or `Flinchless` alone is a hit", () => {
    for (const flags of [{ flinchless: false, noHitlag: true }, { flinchless: true, noHitlag: false }]) {
      const script: AcmdScript = { name: "game_test", motion: "attack_11", commands: [{ op: "frame", frame: 1 }, { op: "attack", params: { ...attackFromHitbox(box), ...flags } }] };
      expect(scriptHitboxes(runScript(script, 1), "mario", "attack_11", 1, LEGACY_BONE_TABLE)[0].windbox, JSON.stringify(flags)).toBeUndefined();
    }
  });
});
