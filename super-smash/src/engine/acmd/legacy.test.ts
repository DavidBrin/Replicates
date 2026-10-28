import { describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { ONE } from "../fixed";
import { activeHitboxes } from "../hitbox";
import { projectilesDueOnFrame } from "../projectile";
import type { Hitbox, MoveDef, MoveSlot } from "../types";
import { LEGACY_BONE_TABLE } from "./bones";
import { scriptHitboxes } from "./hitboxes";
import { runScript } from "./interpreter";
import { SLOT_MOTION, gameScriptFor, legacyGameScript } from "./legacy";

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
    setKnockback: hb.setKnockback === true,
    transcendent: hb.transcendent === true,
    hitlagMultiplier: hb.hitlagMultiplier ?? ONE,
    shieldstunMultiplier: hb.shieldstunMultiplier ?? ONE,
    meteor: hb.meteor === true,
    grabbing: hb.grabbing === true,
  };
}

const MOVES: [string, MoveSlot, MoveDef][] = FIGHTERS.flatMap((f) =>
  (Object.keys(f.moves) as MoveSlot[]).map((slot): [string, MoveSlot, MoveDef] => [f.id, slot, f.moves[slot]!]),
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
    // No sampling: every defined move of every fighter is a case below, filed under its own slot.
    expect(MOVES.length).toBe(FIGHTERS.reduce((n, f) => n + Object.values(f.moves).length, 0));
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
