// @vitest-environment node
/**
 * Moves freed by Plan 5, Task 13: a move with momentum, projectiles, armour or
 * a smash charge may now run its imported script, because the engine reads
 * those from the script, or from the legacy move where the script publishes
 * nothing (`engine/acmd/run.ts`). What a script cannot carry on its legacy
 * frames still keeps a move off it (`PLAN5_BEHAVIOUR`).
 *
 * Sources for the numbers pinned here:
 * - the imported scripts (rubendal SSBU Data Viewer 13.0.1,
 *   https://rubendal.github.io/ssbu/data/patch/13.0.1/character/<Fighter>/data.json,
 *   `src/fighters/acmd/generated/`): Pikachu's `game_specialn` generates
 *   DENGEKIDAMA on frame 19; Mario's runs `FT_MOTION_RATE(1.15)` from its first
 *   frame and generates FIREBALL on motion frame 14 (game frame 16 by the
 *   engine's motion-rate rule, `gameFrameOfMotion`; see the Task 13 report: UFD
 *   and SmashWiki publish 17 as its first live frame); Pikachu's `game_attacks4`
 *   raises START_SMASH_HOLD on frame 10;
 * - Link's Spin Attack keeps its legacy rise, `{ frame: 6, x: 0.35, y: 2.5,
 *   hold: 13 }` (`link.ts`), which no script publishes;
 * - Kirby's Stone (SmashWiki "Kirby (SSBU)/Down special",
 *   https://www.ssbwiki.com/Kirby_(SSBU)/Down_special, revision 2041256): the
 *   aerial falling hit 29-46, and "The stone transformation ... lasts a minimum
 *   of 18 frames and a maximum of 150 frames, depending on when the special move
 *   button is pressed again": a landing does not end it.
 * - `ATTACK_SETOFF_KIND_OFF` is the no-clank setting: SmashWiki "Priority"
 *   (https://www.ssbwiki.com/Priority, revision 2049993), "Transcendent
 *   priority ... refers to hitboxes that cannot clank with other hitboxes"; its
 *   Ultimate list names Mario's "Forward smash (sweetspot only)", whose
 *   `game_attacks4` sweetspot alone is `ATTACK_SETOFF_KIND_OFF`.
 */

import { describe, expect, it } from "vitest";

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { ATTACK, frame } from "@/engine/acmd/dsl";
import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { flatten, runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import { moveMomentum, moveScriptFrame, moveSpawns, moveSuperArmour, smashHoldFrame } from "@/engine/acmd/run";
import type { AcmdScript } from "@/engine/acmd/types";
import { fx } from "@/engine/fixed";
import { chargeHoldFrame } from "@/engine/hitbox";
import { COPY_DAMAGE } from "@/engine/inhale";
import { createInitialState, step } from "@/engine/simulate";
import { hasSuperArmour } from "@/engine/states";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterDef, GameState, InputFrame, MatchRules, MoveSlot } from "@/engine/types";
import { readBakeFromDisk } from "@/game/bakeNode";
import { moveTimingFor } from "@/render/poses/timing";
import { STAGES } from "@/stages";
import { FIGHTERS, donkeyKong, kirby, link, mario, marth, pikachu } from "../index";
import { ACTIVE_SCRIPT_SLOTS, PLAN5_BEHAVIOUR, activatable } from "./active";
import { REFERENCE_SCRIPTS } from "./index";
import { ARTICLE_PROJECTILES, liftScript } from "./lift";
import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "./limb";

const BONES = readBakeFromDisk().bones;
const ctx: SimContext = { fighter: (id) => FIGHTERS.find((f) => f.id === id)!, stage: (id) => STAGES.find((s) => s.id === id)! };
const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

const at = (move: MoveSlot, actionFrame: number) => ({ move, actionFrame });

/** `a` and `b` standing on Final Destination at `ax` and `bx`, facing each other. */
function standing(a: string, b: string, ax: number, bx: number): GameState {
  const s = createInitialState("finalDestination", [{ defId: a }, { defId: b }], RULES, 3, ctx);
  s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? ax : bx), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
  return s;
}

describe("the freed moves", () => {
  it("now include Mario's Fireball and down smash, Pikachu's Thunder Jolt and smashes", () => {
    expect(ACTIVE_SCRIPT_SLOTS.mario).toEqual(expect.arrayContaining(["neutralB", "dsmash"]));
    expect(ACTIVE_SCRIPT_SLOTS.pikachu).toEqual(expect.arrayContaining(["neutralB", "fsmash", "dsmash"]));
  });

  it("launch a mapped article on the script's own frame (Pikachu: frame 19)", () => {
    expect(ARTICLE_PROJECTILES.FIGHTER_PIKACHU_GENERATE_ARTICLE_DENGEKIDAMA).toBe("thunderJolt");
    expect(ARTICLE_PROJECTILES.FIGHTER_MARIO_GENERATE_ARTICLE_FIREBALL).toBe("fireball");
    expect(pikachu.scripts?.neutralB).toBe(liftScript(REFERENCE_SCRIPTS.pikachu.scripts.game_specialn));
    const spawnsAt = (g: number) => moveSpawns(pikachu, { move: "neutralB" }, moveScriptFrame(pikachu, at("neutralB", g - 1))!);
    expect(spawnsAt(18)).toEqual([]);
    expect(spawnsAt(19)).toEqual(["thunderJolt"]);
    expect(spawnsAt(20)).toEqual([]);
  });

  // Ruling P5-R15: one rule, START_SMASH_HOLD where the script raises it, else `chargeHoldFrame`.
  it("hold a smash charge where the script raises START_SMASH_HOLD (Pikachu's forward smash: frame 10)", () => {
    expect(smashHoldFrame(pikachu, { move: "fsmash" })).toBe(9);
    // A smash on its compiled legacy script raises nothing: one short of its earliest box.
    const dk = donkeyKong.moves.fsmash!;
    expect(donkeyKong.scripts?.fsmash).toBeUndefined();
    expect(smashHoldFrame(donkeyKong, { move: "fsmash" })).toBe(chargeHoldFrame(dk));
  });

  it("hold there in a match while the attack is held", () => {
    let s = standing("pikachu", "mario", -40, 40);
    let prev: InputFrame[] = [0, 0];
    const frames: number[] = [];
    for (let i = 0; i < 20; i++) {
      // A side smash, held: the press with a side, then the attack alone.
      const now = [i === 0 ? Btn.Right | Btn.Attack : Btn.Attack, 0];
      s = step(s, now, { prevInputs: prev, ctx }).state;
      prev = now;
      frames.push(s.fighters[0].actionFrame);
    }
    expect(s.fighters[0].move).toBe("fsmash");
    expect(Math.max(...frames)).toBe(9);
    expect(s.fighters[0].charge).toBeGreaterThan(0);
  });

  it("time the render's charge pose by the same rule, for every smash the game runs", () => {
    for (const legacy of FIGHTERS) {
      const def = withLimbScripts(legacy, BONES);
      for (const slot of ["fsmash", "usmash", "dsmash"] as const) {
        if (def.moves[slot]?.chargeable !== true) continue;
        expect(moveTimingFor(def, slot)?.chargeHold, `${def.id} ${slot}`).toBe(smashHoldFrame(def, { move: slot }));
      }
    }
  });
});

describe("the legacy move's fallbacks", () => {
  it("keep a legacy move's momentum when its imported script publishes none (Link's Spin Attack)", () => {
    const game = withLimbScripts(link, BONES);
    expect(LIMB_SCRIPT_SLOTS.link).toContain("upB");
    expect(game.scripts?.upB).toBe(liftScript(REFERENCE_SCRIPTS.link.scripts.game_specialhi));
    const run = (g: number) => moveScriptFrame(game, at("upB", g - 1))!;
    expect(run(6).state.momentum).toBeNull();
    expect(moveMomentum(game, { move: "upB" }, run(5))).toBeNull();
    expect(moveMomentum(game, { move: "upB" }, run(6))).toEqual({ x: fx(0.35), y: fx(2.5), until: 19 });
    expect(moveMomentum(game, { move: "upB" }, run(19))).toEqual({ x: fx(0.35), y: fx(2.5), until: 19 });
    expect(moveMomentum(game, { move: "upB" }, run(20))).toBeNull();
  });

  it("keep a legacy move's super armour when the script says nothing of armour", () => {
    // Kirby's Stone carries `superArmourFrames` [10, 48]; give it a script that sets none.
    const bare: AcmdScript = { name: "game_speciallw", motion: "special_lw", commands: [frame(1)] };
    const def: FighterDef = { ...kirby, scripts: { ...kirby.scripts, downB: bare } };
    const armoured = (g: number) => moveSuperArmour(def, { move: "downB" }, moveScriptFrame(def, at("downB", g - 1))!);
    expect([9, 10, 48, 49].map(armoured)).toEqual([false, true, true, false]);
    // …and the sim's own question reads the same answer.
    const stone = (g: number) => hasSuperArmour({ ...createInitialState("finalDestination", [{ defId: "kirby" }], RULES, 3, ctx).fighters[0], action: "special", move: "downB", actionFrame: g - 1 }, def);
    expect([9, 10, 48, 49].map(stone)).toEqual([false, true, true, false]);
  });

  it("carry a legacy window's air-only rise with it", () => {
    // Donkey Kong's cargo down throw rises only in the air (`airOnly`); on a bare script the fallback keeps that.
    const bare: AcmdScript = { name: "game_throwlw", motion: "throw_lw", commands: [frame(1)] };
    const move = donkeyKong.moves.cargoDthrow!;
    expect(move.momentum?.[0].airOnly).toBe(true);
    const def: FighterDef = { ...donkeyKong, scripts: { ...donkeyKong.scripts, cargoDthrow: bare } };
    const m = move.momentum![0];
    expect(moveMomentum(def, { move: "cargoDthrow" }, moveScriptFrame(def, at("cargoDthrow", m.frame - 1))!)).toEqual({ x: m.x, y: m.y, until: m.frame + (m.hold ?? 0), airOnly: true });
  });

  it("launch a legacy move's projectile on its own frame when the script launches nothing", () => {
    // Mario's Fireball with a script that never generates it: the legacy `spawnFrame`, 17.
    const bare: AcmdScript = { name: "game_specialn", motion: "special_n", commands: [frame(1)] };
    const def: FighterDef = { ...mario, id: "bareMario", scripts: { ...mario.scripts, neutralB: bare } };
    const local: SimContext = { fighter: (id) => (id === "bareMario" ? def : ctx.fighter(id)), stage: ctx.stage };
    let s = createInitialState("finalDestination", [{ defId: "bareMario" }, { defId: "fox" }], RULES, 3, local);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? -40 : 40), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
    let prev: InputFrame[] = [0, 0];
    let spawnedOn = -1;
    for (let i = 0; i < 30 && spawnedOn < 0; i++) {
      const now = [i === 0 ? Btn.Special : 0, 0];
      s = step(s, now, { prevInputs: prev, ctx: local }).state;
      prev = now;
      if (s.projectiles.length > 0) spawnedOn = i + 1;
    }
    expect(spawnedOn).toBe(mario.moves.neutralB!.projectiles![0].spawnFrame);
  });

  it("take a script's own commands over the legacy move's (the compiled Stone)", () => {
    expect(kirby.scripts?.downB).toBeUndefined();
    const run = moveScriptFrame(kirby, at("downB", 11))!;
    expect(moveMomentum(kirby, { move: "downB" }, run)).toEqual(run.state.momentum);
    expect(moveSuperArmour(kirby, { move: "downB" }, run)).toBe(true);
  });
});

describe("a freed move in a match", () => {
  it("throws Mario's Fireball from its imported script", () => {
    let s = standing("mario", "fox", -40, 40);
    let prev: InputFrame[] = [0, 0];
    let spawnedOn = -1;
    for (let i = 0; i < 30 && spawnedOn < 0; i++) {
      const now = [i === 0 ? Btn.Special : 0, 0];
      s = step(s, now, { prevInputs: prev, ctx }).state;
      prev = now;
      if (s.projectiles.length > 0) spawnedOn = i + 1;
    }
    // game_specialn: FT_MOTION_RATE 1.15, generate_article on motion frame 14 → game frame 16.
    expect(spawnedOn).toBe(16);
    expect(s.projectiles[0].defId).toBe("fireball");
  });

  // Copy Ability moves keep their ×1.2 (Plan 5, Task 9) on the script the copied fighter runs.
  it("throws a Copy Ability Fireball from Mario's script, at the copy's ×1.2", () => {
    let s = standing("kirby", "fox", -40, 40);
    s.fighters[0].combat.copy = "mario";
    let prev: InputFrame[] = [0, 0];
    let spawnedOn = -1;
    for (let i = 0; i < 30 && spawnedOn < 0; i++) {
      const now = [i === 0 ? Btn.Special : 0, 0];
      s = step(s, now, { prevInputs: prev, ctx }).state;
      prev = now;
      if (s.projectiles.length > 0) spawnedOn = i + 1;
    }
    expect(spawnedOn).toBe(16);
    expect(s.projectiles[0]).toMatchObject({ defId: "fireball", source: "mario", damageMul: COPY_DAMAGE });
  });
});

describe("what keeps a move on its legacy frames (Plan 5 review)", () => {
  it("lists every Plan 5 field the script cannot carry", () => {
    expect([...PLAN5_BEHAVIOUR].sort()).toEqual(
      [
        "aerialTotalFrames",
        "airTotalFrames",
        "cargo",
        "copyDamage",
        "counter",
        "counterDamage",
        "heavyArmour",
        "holdLoop",
        "inhale",
        "intangible",
        "reflector",
        "release",
        "specialCharge",
        "stall",
      ].sort(),
    );
  });

  it("keeps a move with any of them off its script, even one whose script would run", () => {
    // Mario's jab runs its script (ACTIVE_SCRIPT_SLOTS); with a Plan 5 field it must not.
    const jab = mario.moves.jab1!;
    const script = REFERENCE_SCRIPTS.mario.scripts[REFERENCE_SCRIPTS.mario.slots.jab1!];
    expect(activatable("jab1", jab, script)).toBe(true);
    expect(activatable("jab1", { ...jab, intangible: [1, 3] }, script)).toBe(false);
    expect(activatable("jab1", { ...jab, copyDamage: fx(1.2) }, script)).toBe(false);
    expect(activatable("jab1", { ...jab, heavyArmour: fx(16) }, script)).toBe(false);
    expect(activatable("jab1", { ...jab, holdLoop: { from: 2, to: 4 } }, script)).toBe(false);
  });

  // A throw's turn is the script's own REVERSE_LR (Plan 5, Task 7, P5-R7); `turnAt`
  // only places it in the compiled legacy script, so it keeps no throw off its script.
  it("leaves a back throw that turns by its script's REVERSE_LR on it", () => {
    expect(mario.moves.bthrow?.turnAt).toBe(40);
    expect(LIMB_SCRIPT_SLOTS.mario).toContain("bthrow");
    expect(ACTIVE_SCRIPT_SLOTS.samus).toContain("bthrow");
  });

  it("keeps Inhale, the Counter, the cargo throws and every charging special on their legacy frames", () => {
    for (const def of FIGHTERS) {
      const running = [...(ACTIVE_SCRIPT_SLOTS[def.id] ?? []), ...(LIMB_SCRIPT_SLOTS[def.id] ?? [])];
      for (const slot of running) {
        const move = def.moves[slot]!;
        expect(PLAN5_BEHAVIOUR.filter((k) => move[k] !== undefined), `${def.id} ${slot}`).toEqual([]);
      }
    }
    expect(kirby.scripts?.neutralB).toBeUndefined();
    expect(withLimbScripts(donkeyKong, BONES).scripts?.cargoFthrow).toBeUndefined();
  });
});

/*
 * Plan 5, Task 13 (the Task 5 review's carry): a script's `ATTACK_SETOFF_KIND_OFF`
 * cannot clank, as THRU already could not, for every move that runs a script.
 */
describe("a box that cannot clank", () => {
  const box = (id: number, clang: "ATTACK_SETOFF_KIND_ON" | "ATTACK_SETOFF_KIND_OFF" | "ATTACK_SETOFF_KIND_THRU") =>
    ATTACK({ id, bone: "top", damage: 5, angle: 45, kbg: 100, bkb: 40, size: 4, x: 0, y: 6, z: 6 + id, clang });
  const script: AcmdScript = {
    name: "game_attack11",
    motion: "attack_11",
    commands: [frame(2), box(0, "ATTACK_SETOFF_KIND_ON"), box(1, "ATTACK_SETOFF_KIND_OFF"), box(2, "ATTACK_SETOFF_KIND_THRU")],
  };

  it("is transcendent for OFF and THRU, and clanks for ON", () => {
    const boxes = scriptHitboxes(runScript(script, 2), "mario", "attack_11", 2, LEGACY_BONE_TABLE);
    expect(boxes.map((hb) => [hb.id, hb.transcendent === true])).toEqual([
      [0, false],
      [1, true],
      [2, true],
    ]);
  });

  it("is what the legacy compile writes for a transcendent box: OFF (Marth's counterattack)", () => {
    expect(marth.moves.counterAttack!.hitboxes.every((hb) => hb.transcendent === true)).toBe(true);
    const clangs = flatten(gameScriptFor(marth, "counterAttack")!).flatMap((c) => (c.op === "attack" ? [c.params.clang] : []));
    expect(clangs.length).toBeGreaterThan(0);
    expect(new Set(clangs)).toEqual(new Set(["ATTACK_SETOFF_KIND_OFF"]));
  });

  it("passes through a jab it would have clanked with: Pikachu's jab (OFF) trades with Mario's", () => {
    // Pikachu's game_attack11 is all ATTACK_SETOFF_KIND_OFF; Mario's is ON. Close
    // enough that the boxes overlap: before Task 13 the two clanked and nobody was hit.
    let s = standing("pikachu", "mario", -6, 6);
    let prev: InputFrame[] = [0, 0];
    const hit: number[] = [];
    let clanks = 0;
    for (let i = 0; i < 8; i++) {
      const now = [i === 0 ? Btn.Attack : 0, i === 0 ? Btn.Attack : 0];
      const out = step(s, now, { prevInputs: prev, ctx });
      s = out.state;
      prev = now;
      for (const h of out.events.hits) hit.push(h.victim);
      clanks += out.events.clanks.length;
    }
    expect(clanks).toBe(0);
    expect([...new Set(hit)].sort()).toEqual([0, 1]);
  });
});

/*
 * Plan 5, Task 13 (the Task 5 review's carry): Kirby's Stone, dropped from 30
 * units up, lands long before its boxes come out on frame 29. The landing does
 * not end it: it lands as a stone and its box comes out on its frame.
 */
describe("Kirby's Stone dropped from 30", () => {
  it("lands as a stone and stays one, its box out on frame 29", () => {
    let s = standing("kirby", "mario", 0, 4);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, y: fx(30), vy: 0 });
    let prev: InputFrame[] = [0, 0];
    let landed = -1;
    let firstHit = -1;
    for (let i = 0; i < 40 && firstHit < 0; i++) {
      const now = [i === 0 ? Btn.Down | Btn.Special : 0, 0];
      const out = step(s, now, { prevInputs: prev, ctx });
      s = out.state;
      prev = now;
      const k = s.fighters[0];
      if (landed < 0 && k.grounded) landed = k.actionFrame + 1;
      if (out.events.hits.some((h) => h.attacker === 0)) firstHit = k.actionFrame + 1;
      if (i > 0) expect([k.action, k.move], `step ${i}`).toEqual(["special", "downB"]);
    }
    expect(landed).toBeGreaterThan(0);
    expect(landed).toBeLessThan(29);
    expect(firstHit).toBe(29);
  });
});
