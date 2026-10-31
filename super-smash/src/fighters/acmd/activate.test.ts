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
 *   DENGEKIDAMA on frame 19; Mario's runs `FT_MOTION_RATE(1.15)` before its first
 *   frame and generates FIREBALL on motion frame 14, game frame ⌈14 × 1.15⌉ = 17
 *   (fix round 1, R-T13d: UltimateFrameData, https://ultimateframedata.com/mario,
 *   startup 17; SmashWiki "Mario (SSBU)/Neutral special",
 *   https://www.ssbwiki.com/Mario_(SSBU)/Neutral_special, revision 1699768,
 *   "Clean hit 17-21"); a smash's script raises START_SMASH_HOLD on the frame
 *   after the one it charges on (R-T13e; the SmashWiki pages in `RELEASES`);
 * - Link's Spin Attack: SmashWiki "Link (SSBU)/Up special"
 *   (https://www.ssbwiki.com/Link_(SSBU)/Up_special, revision 1987976), grounded,
 *   "Charges between 3-4", hits "7-8, 9-13 ... 14-23, 24-39 (from release 4-5,
 *   6-10 ... 11-20, 21-36)", "Interruptible (from release) 77 (74)": the imported
 *   `game_specialhi` is the from-release timeline (R-T13f). It keeps its legacy
 *   rise, `{ frame: 6, x: 0.35, y: 2.5, hold: 13 }` (`link.ts`), which no script
 *   publishes;
 * - Kirby's Stone (SmashWiki "Kirby (SSBU)/Down special",
 *   https://www.ssbwiki.com/Kirby_(SSBU)/Down_special, revision 2041256): the
 *   aerial falling hit 29-46; the landing hit, two boxes of 14%, 25°, BKB 86,
 *   KBG 30, radius 6.0 at y 4.0, z ±6.0, grounded opponents only, `clang=f`
 *   (R-T13h); grounded, "Landing hit 11"; and "The stone transformation ... lasts
 *   a minimum of 18 frames and a maximum of 150 frames, depending on when the
 *   special move button is pressed again": a landing does not end it.
 * - `ATTACK_SETOFF_KIND_OFF` is the no-clank setting: SmashWiki "Priority"
 *   (https://www.ssbwiki.com/Priority, revision 2049993), "Transcendent
 *   priority ... refers to hitboxes that cannot clank with other hitboxes"; its
 *   Ultimate list names Mario's "Forward smash (sweetspot only)", whose
 *   `game_attacks4` sweetspot alone is `ATTACK_SETOFF_KIND_OFF`.
 *   `ATTACK_SETOFF_KIND_THRU` is "cannot rebound" (R-T13g): the same page's
 *   "Moves that cannot rebound" ("they will continue their animations as if they
 *   did not collide at all, but the hitbox will count as blocked for other
 *   clanking character") lists Fox's Ultimate forward smash, THRU in its script.
 */

import { describe, expect, it } from "vitest";

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { ATTACK, clearAll, frame, setFlag, wait } from "@/engine/acmd/dsl";
import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { flatten, runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import { moveMomentum, moveScriptFrame, moveSpawns, moveSuperArmour, smashHoldFrame } from "@/engine/acmd/run";
import type { AcmdScript } from "@/engine/acmd/types";
import { fx } from "@/engine/fixed";
import { chargeHoldFrame } from "@/engine/hitbox";
import { COPY_DAMAGE } from "@/engine/inhale";
import { hashState } from "@/engine/hash";
import { cloneState, createInitialState, step } from "@/engine/simulate";
import { hasSuperArmour, onLanded } from "@/engine/states";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterDef, GameState, InputFrame, MatchRules, MoveDef, MoveSlot } from "@/engine/types";
import { readBakeFromDisk } from "@/game/bakeNode";
import { moveTimingFor } from "@/render/poses/timing";
import { STAGES } from "@/stages";
import { FIGHTERS, donkeyKong, kirby, link, mario, marth, pikachu } from "../index";
import { ACTIVE_SCRIPT_SLOTS, PLAN5_BEHAVIOUR, activatable, gameScriptOf } from "./active";
import { REFERENCE_SCRIPTS } from "./index";
import { ARTICLE_PROJECTILES, liftScript } from "./lift";
import { bakedContext } from "@/game/bake";
import { boneRole, placeableBone } from "@/render3d/retarget/placeable";
import { SKELETONS } from "@/render3d/skeletons";
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

  // Ruling P5-R15: one rule, START_SMASH_HOLD where the script raises it, else
  // `chargeHoldFrame`; R-T13e: the frame before the one raising it. SmashWiki
  // "Pikachu (SSBU)/Forward smash" (https://www.ssbwiki.com/Pikachu_(SSBU)/Forward_smash,
  // revision 1659944): "Charges between 9-10"; `game_attacks4` raises it on 10.
  it("hold a smash charge on the frame before the script raises START_SMASH_HOLD (Pikachu's forward smash: charges between 9 and 10)", () => {
    // actionFrame 8 is game frame 9.
    expect(smashHoldFrame(pikachu, { move: "fsmash" })).toBe(8);
    // A smash on its compiled legacy script raises nothing: its published hold (R-T13i,
    // Donkey Kong's "Charges between 14-15"), and with none, one short of its earliest box.
    const dk = donkeyKong.moves.fsmash!;
    expect(donkeyKong.scripts?.fsmash).toBeUndefined();
    expect(smashHoldFrame(donkeyKong, { move: "fsmash" })).toBe(13);
    const unpublished = { ...donkeyKong, moves: { ...donkeyKong.moves, fsmash: { ...dk, smashHold: undefined } } };
    expect(smashHoldFrame(unpublished, { move: "fsmash" })).toBe(chargeHoldFrame(dk));
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
    expect(Math.max(...frames)).toBe(8);
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
  it("keep a legacy move's momentum when its imported script publishes none (Link's Spin Attack, forged)", () => {
    // Link's grounded Spin Attack has had no window since Plan 5, Task 13b (the page
    // gives it no movement): this one is the old rise, put back on a copy.
    const rising: FighterDef = { ...link, moves: { ...link.moves, upB: { ...link.moves.upB!, momentum: [{ frame: 6, x: fx(0.35), y: fx(2.5), hold: 13 }] } } };
    const game = withLimbScripts(rising, BONES);
    expect(LIMB_SCRIPT_SLOTS.link).toContain("upB");
    expect(game.scripts?.upB).toBe(gameScriptOf(link.moves.upB, REFERENCE_SCRIPTS.link.scripts.game_specialhi));
    const run = (g: number) => moveScriptFrame(game, at("upB", g - 1))!;
    expect(run(6).state.momentum).toBeNull();
    expect(moveMomentum(game, { move: "upB" }, run(5))).toBeNull();
    expect(moveMomentum(game, { move: "upB" }, run(6))).toEqual({ x: fx(0.35), y: fx(2.5), until: 19, order: 0 });
    expect(moveMomentum(game, { move: "upB" }, run(19))).toEqual({ x: fx(0.35), y: fx(2.5), until: 19, order: 0 });
    expect(moveMomentum(game, { move: "upB" }, run(20))).toBeNull();
  });

  it("keep a legacy move's super armour when the script says nothing of armour", () => {
    // A down special with `superArmourFrames` [10, 48] (the Stone's before Task 13 fix round 2), on a script that sets none.
    const bare: AcmdScript = { name: "game_speciallw", motion: "special_lw", commands: [frame(1)] };
    const def: FighterDef = { ...kirby, scripts: { ...kirby.scripts, downB: bare }, moves: { ...kirby.moves, downB: { ...kirby.moves.downB!, superArmourFrames: [10, 48] } } };
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
    expect(moveMomentum(def, { move: "cargoDthrow" }, moveScriptFrame(def, at("cargoDthrow", m.frame - 1))!)).toEqual({ x: m.x, y: m.y, until: m.frame + (m.hold ?? 0), order: 0, airOnly: true });
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

  it("take a script's own commands over the legacy move's (a compiled Stone with super armour)", () => {
    const armoured: FighterDef = { ...kirby, moves: { ...kirby.moves, downB: { ...kirby.moves.downB!, superArmourFrames: [10, 48] } } };
    expect(armoured.scripts?.downB).toBeUndefined();
    const run = moveScriptFrame(armoured, at("downB", 29))!;
    expect(run.state.momentum).not.toBeNull();
    expect(moveMomentum(armoured, { move: "downB" }, run)).toEqual(run.state.momentum);
    expect(moveSuperArmour(armoured, { move: "downB" }, run)).toBe(true);
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
    // game_specialn: FT_MOTION_RATE 1.15 before frame(14), generate_article on game frame 17 (R-T13d).
    expect(spawnedOn).toBe(17);
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
    expect(spawnedOn).toBe(17);
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
        "final",
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
    // ...but a charge that loops inside the script's lead, before its first command
    // (Plan 5, Task 13b: Link's Spin Attack, "Charges between 3-4" in its 3-frame
    // start), times nothing the script runs.
    const inLead = (move: MoveDef, k: keyof MoveDef) => k === "specialCharge" && move.specialCharge!.loopFrame <= (move.scriptLead ?? 0);
    for (const def of FIGHTERS) {
      const running = [...(ACTIVE_SCRIPT_SLOTS[def.id] ?? []), ...(LIMB_SCRIPT_SLOTS[def.id] ?? [])];
      for (const slot of running) {
        const move = def.moves[slot]!;
        expect(PLAN5_BEHAVIOUR.filter((k) => move[k] !== undefined && !inLead(move, k)), `${def.id} ${slot}`).toEqual([]);
      }
    }
    expect(LIMB_SCRIPT_SLOTS.link).toContain("upB");
    expect(link.moves.upB!.specialCharge?.loopFrame).toBe(3);
    expect(kirby.scripts?.neutralB).toBeUndefined();
    expect(withLimbScripts(donkeyKong, BONES).scripts?.cargoFthrow).toBeUndefined();
  });
});

/*
 * Plan 5, Task 13 (the Task 5 review's carry): a script's `ATTACK_SETOFF_KIND_OFF`
 * cannot clank, for every move that runs a script. Fix round 1 (R-T13g): THRU
 * clanks, and its user never rebounds (`noRebound`).
 */
describe("a box that cannot clank, and one that cannot rebound", () => {
  const box = (id: number, clang: "ATTACK_SETOFF_KIND_ON" | "ATTACK_SETOFF_KIND_OFF" | "ATTACK_SETOFF_KIND_THRU") =>
    ATTACK({ id, bone: "top", damage: 5, angle: 45, kbg: 100, bkb: 40, size: 4, x: 0, y: 6, z: 6 + id, clang });
  const script: AcmdScript = {
    name: "game_attack11",
    motion: "attack_11",
    commands: [frame(2), box(0, "ATTACK_SETOFF_KIND_ON"), box(1, "ATTACK_SETOFF_KIND_OFF"), box(2, "ATTACK_SETOFF_KIND_THRU")],
  };

  it("is transcendent for OFF, no-rebound for THRU, and plain for ON", () => {
    const boxes = scriptHitboxes(runScript(script, 2), "mario", "attack_11", 2, LEGACY_BONE_TABLE);
    expect(boxes.map((hb) => [hb.id, hb.transcendent === true, hb.noRebound === true])).toEqual([
      [0, false, false],
      [1, true, false],
      [2, false, true],
    ]);
  });

  // R-T13g. Fox's forward smash (game_attacks4, all six boxes THRU; 14% clean) meets
  // Mario's (legacy): within 9%, so both would rebound. Fox's cannot: he swings on,
  // Mario rebounds, and the hit Fox's box met is blocked. Mario's box that clanks is
  // his 14.7% close one: his 17.8% sweetspot is OFF, as its script has it (Task 13c).
  it("clanks with Fox's forward smash, which swings on while Mario rebounds and is not hit by it", () => {
    const GAME = bakedContext(ctx, readBakeFromDisk());
    const ALONE: MatchRules = { ...RULES, oneOnOne: false };
    expect(GAME.fighter("fox").scripts?.fsmash).toBeDefined();
    let s = createInitialState("finalDestination", [{ defId: "fox" }, { defId: "mario" }], ALONE, 3, GAME);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? -7 : 7), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
    let prev: InputFrame[] = [0, 0];
    let clankAt = -1;
    const foxHits: number[] = [];
    for (let i = 0; i < 40; i++) {
      // Mario's box comes out on 15, Fox's on 13: Fox presses two frames later.
      const now = [i === 2 ? Btn.Right | Btn.Attack : 0, i === 0 ? Btn.Left | Btn.Attack : 0];
      const out = step(s, now, { prevInputs: prev, ctx: GAME });
      s = out.state;
      prev = now;
      if (clankAt < 0 && out.events.clanks.length > 0) {
        clankAt = i;
        expect([s.fighters[0].action, s.fighters[0].move]).toEqual(["attack", "fsmash"]);
        // Mario rebounds (Task 13c fix round 1: freeze, then the rebound status).
        expect([s.fighters[1].action, s.fighters[1].move]).toEqual(["rebound", null]);
      }
      for (const h of out.events.hits) if (h.attacker === 0) foxHits.push(i);
    }
    expect(clankAt).toBe(14);
    expect(foxHits).toEqual([]);
  });

  // Fix round 2: SmashWiki "Pikachu (SSBU)/Forward smash"
  // (https://www.ssbwiki.com/Pikachu_(SSBU)/Forward_smash, revision 1659944) marks the
  // early and clean hits `clang=f rebound=f` and the late ones `rebound=f` alone, as
  // `game_attacks4` sets them OFF and THRU.
  it("tramples on Pikachu's forward-smash late hits (20-29), and passes through on its earlier ones (15-19)", () => {
    const script = gameScriptFor(pikachu, "fsmash")!;
    const kinds = new Map<number, string>();
    for (let g = 15; g <= 29; g++) {
      for (const hb of scriptHitboxes(runScript(script, g), "pikachu", script.motion, g, LEGACY_BONE_TABLE)) {
        kinds.set(g, hb.transcendent === true ? "OFF" : hb.noRebound === true ? "THRU" : "ON");
      }
    }
    expect([...kinds.entries()].filter(([g]) => g < 20).every(([, k]) => k === "OFF")).toBe(true);
    expect([...kinds.entries()].filter(([g]) => g >= 20).map(([, k]) => k)).toEqual(Array<string>(10).fill("THRU"));
  });

  // Fix round 2: a trampling box that meets a projectile blocks nothing, as no
  // fighter met it (the guard in `loseOrTrample`). Pikachu's forward smash, late hit
  // (12%, THRU), meets Mario's Fireball (5%, ON) within 9% as the ball is thrown; the
  // ball is gone, and the smash goes on to hit Mario on its next frame.
  it("blocks nothing when it meets a projectile: Pikachu's smash goes through Mario's Fireball and hits Mario", () => {
    let s = standing("pikachu", "mario", 0, 30);
    s = { ...s, rules: { ...s.rules, oneOnOne: false } };
    let prev: InputFrame[] = [0, 0];
    let clankAt = -1;
    let hitAt = -1;
    let freeze = -1;
    for (let i = 0; i < 70; i++) {
      const now = [i === 0 ? Btn.Right | Btn.Attack : 0, i === 3 ? Btn.Special : 0];
      const out = step(s, now, { prevInputs: prev, ctx });
      s = out.state;
      prev = now;
      if (clankAt < 0 && out.events.clanks.length > 0) {
        clankAt = i;
        freeze = s.fighters[0].hitlag;
      }
      if (hitAt < 0 && out.events.hits.some((h) => h.attacker === 0 && h.victim === 1)) hitAt = i;
    }
    expect(clankAt).toBe(19);
    // Within 9% of the Fireball, Pikachu's smash freezes and goes on (Task 13c fix
    // round 1, R-T13c-a: a side that cannot rebound freezes but never rebounds), and
    // hits Mario on its first frame after the freeze.
    expect(freeze).toBeGreaterThan(0);
    expect(hitAt).toBe(clankAt + freeze + 1);
  });

  it("is what the legacy compile writes for a box that cannot rebound: THRU", () => {
    const box = { id: 0, startFrame: 2, endFrame: 3, x: fx(6), y: fx(6), radius: fx(4), damage: fx(10), angle: fx(45), baseKnockback: fx(40), knockbackGrowth: fx(100), noRebound: true };
    const script = gameScriptFor({ moves: { jab1: { slot: "jab1", name: "test", totalFrames: 10, hitboxes: [box] } } }, "jab1")!;
    const clangs = flatten(script).flatMap((c) => (c.op === "attack" ? [c.params.clang] : []));
    expect(clangs).toEqual(["ATTACK_SETOFF_KIND_THRU"]);
    expect(scriptHitboxes(runScript(script, 2), "mario", script.motion, 2, LEGACY_BONE_TABLE)[0]).toMatchObject({ noRebound: true });
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
 * units up, lands long before its falling box comes out on frame 29. The landing
 * does not end it: it lands as a stone. Fix round 1 (R-T13h): it lands with the
 * published landing hit, and the falling box never comes out on the ground.
 */
describe("Kirby's Stone", () => {
  /** SmashWiki's landing hit: 14% fresh-staled ×1.05, no 1v1 bonus here. */
  const LANDING = 14 * 1.05;
  const ALONE: MatchRules = { ...RULES, oneOnOne: false };
  const kirbyFirst = (a: number, b: number, kirbyY: number): GameState => {
    const s = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "mario" }], ALONE, 3, ctx);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? a : b), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
    if (kirbyY > 0) Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, y: fx(kirbyY), vy: 0 });
    return s;
  };
  const toF = (n: number) => n / 4096;
  /** Down special on the first step, then `steps` steps; Kirby's hits, with the move frame each landed on. */
  function stone(s0: GameState, steps: number, each?: (s: GameState, i: number) => void, cancelAt = -1) {
    let s = s0;
    let prev: InputFrame[] = [0, 0];
    let landed = -1;
    const hits: { frame: number; damage: number; step: number; angle: number }[] = [];
    for (let i = 0; i < steps; i++) {
      each?.(s, i);
      // Down special on the first step; the special button again on `cancelAt`, ending the stone.
      const now = [i === 0 ? Btn.Down | Btn.Special : i === cancelAt ? Btn.Special : 0, 0];
      const out = step(s, now, { prevInputs: prev, ctx });
      s = out.state;
      prev = now;
      const k = s.fighters[0];
      if (landed < 0 && k.grounded) landed = i;
      for (const h of out.events.hits) if (h.attacker === 0) hits.push({ frame: k.actionFrame + 1, damage: h.damage / 4096, step: i, angle: h.angle / 4096 });
      if (i > 0 && i < 50) expect([k.action, k.move], `step ${i}`).toEqual(["special", "downB"]);
    }
    return { hits, landed };
  }

  it("has the published landing hit: two boxes on frame 11, of the ground alone", () => {
    const boxes = kirby.moves.downB!.hitboxes.filter((hb) => hb.whileGrounded === true);
    expect(boxes.map((hb) => [toF(hb.x), toF(hb.y), toF(hb.radius)])).toEqual([
      [6, 4, 6],
      [-6, 4, 6],
    ]);
    for (const hb of boxes) {
      expect(hb).toMatchObject({ startFrame: 11, endFrame: 11, damage: fx(14), angle: fx(25), baseKnockback: fx(86), knockbackGrowth: fx(30), transcendent: true, situation: "ground", lr: "position" });
      expect(hb.fixedKnockback ?? 0).toBe(0);
      expect(hb.hitlagMultiplier ?? fx(1)).toBe(fx(1));
    }
    expect(kirby.moves.downB!.hitboxes.filter((hb) => hb.whileGrounded === false).map((hb) => [hb.startFrame, hb.endFrame])).toEqual([[29, 46]]);
    expect(kirby.moves.downB!.landing).toEqual({ at: 11, through: 46 });
  });

  it("starts its landing again on landing: the hit record of the fall is the fall's", () => {
    const s = kirbyFirst(0, 60, 30);
    const k = s.fighters[0];
    Object.assign(k, { action: "special", move: "downB", actionFrame: 20, hitThisMove: [1] });
    onLanded(k, { def: kirby, stage: ctx.stage("finalDestination"), frame: 1, fighters: s.fighters });
    expect([k.action, k.move, k.actionFrame, k.hitThisMove]).toEqual(["special", "downB", 10, []]);
  });

  // ATTACK_LR_CHECK_POS: 25° away from him, so 155° in the world for one behind him.
  it("launches whoever is behind it away from it too", () => {
    const behind = stone(kirbyFirst(0, -6, 0), 14).hits;
    const ahead = stone(kirbyFirst(0, 6, 0), 14).hits;
    expect([behind.map((h) => h.frame), ahead.map((h) => h.frame)]).toEqual([[11], [11]]);
    expect(behind[0].angle).toBeCloseTo(155, 0);
    expect(ahead[0].angle).toBeCloseTo(25, 0);
  });

  it("used on the ground, hits with its landing hit on frame 11, and with nothing else", () => {
    const { hits } = stone(kirbyFirst(0, 6, 0), 60);
    expect(hits.map((h) => h.frame)).toEqual([11]);
    expect(hits[0].damage).toBeCloseTo(LANDING, 2);
  });

  it("dropped from 30, lands as a stone with its landing hit on the frame it lands", () => {
    // Mario beside him, past the falling box (radius 6.5), inside the landing hit's (6 out, radius 6).
    const { hits, landed } = stone(kirbyFirst(0, 11, 30), 60);
    // It falls as he would until its stone forms on 29 (fix round 2), and lands in it.
    expect(landed).toBeGreaterThan(27);
    expect(hits).toHaveLength(1);
    expect(hits[0].step).toBe(landed);
    expect(hits[0].damage).toBeCloseTo(LANDING, 2);
  });

  it("keeps no falling box live once it has landed: Mario walking up to it is not hit, the stone held or ended", () => {
    // Mario far off for the landing (step 29); then beside the stone, standing, as it
    // holds and, ended by the button on step 52, as it plays its frames 29-59 out.
    const { hits } = stone(
      kirbyFirst(0, 60, 30),
      100,
      (s, i) => {
        if (i === 34) Object.assign(s.fighters[1], { x: fx(2), action: "stand", actionFrame: 0, vx: 0 });
      },
      52,
    );
    expect(hits).toEqual([]);
  });
});

/*
 * Fix round 1 (R-T13f): Link's Spin Attack runs its published timeline: the
 * imported `game_specialhi` is the from-release part, after a 3-frame start the
 * import lacks (`MoveDef.scriptLead`).
 */
describe("Link's Spin Attack in the game", () => {
  it("leads a script by moving its timeline on: commands before its first frame() too", () => {
    const raw: AcmdScript = {
      name: "game_test",
      motion: "test",
      commands: [setFlag("FIRST"), frame(2), ATTACK({ id: 0, bone: "top", damage: 5, angle: 45, kbg: 100, bkb: 40, size: 4, x: 0, y: 6, z: 6 }), wait(2), clearAll()],
    };
    const led = gameScriptOf({ scriptLead: 3 }, raw);
    expect(gameScriptOf({ scriptLead: 3 }, raw)).toBe(led);
    expect(gameScriptOf(undefined, raw)).toBe(liftScript(raw));
    const flagOn = [1, 2, 3, 4].map((g) => runScript(led, g).flags.includes("FIRST"));
    expect(flagOn).toEqual([false, false, false, true]);
    expect([4, 5, 6, 7, 8].map((g) => runScript(led, g).attacks.length)).toEqual([0, 1, 1, 0, 0]);
  });

  it("hits on 7-39 and is interruptible on 77, and does not rise (Plan 5, Task 13b)", () => {
    const game = withLimbScripts(link, BONES);
    const move = game.moves.upB!;
    expect(move.totalFrames).toBe(76);
    const live: number[] = [];
    for (let g = 1; g <= move.totalFrames; g++) if (runScript(gameScriptFor(game, "upB")!, g).attacks.length > 0) live.push(g);
    expect([live[0], live[live.length - 1], live.length]).toEqual([7, 39, 33]);
    expect(Math.min(...move.hitboxes.map((hb) => hb.startFrame))).toBe(7);
    expect(Math.max(...move.hitboxes.map((hb) => hb.endFrame))).toBe(39);
    const rise = (g: number) => moveMomentum(game, { move: "upB" }, moveScriptFrame(game, at("upB", g - 1))!);
    expect([1, 5, 6, 19, 20, 76].map(rise)).toEqual([null, null, null, null, null, null]);
  });
});

/*
 * Fix round 1 (the review's M3, required): from the release of a held smash to its
 * first box, every smash the game runs from its imported script. It holds on the
 * frame SmashWiki's "Charges between" starts, and after the release its first box
 * comes on the frame SmashWiki publishes: the charge freezes the timeline, it
 * neither skips nor repeats a frame of it. Fix round 2 (ruling R-T13i): every
 * legacy smash too, held on its published frame (`MoveDef.smashHold`), Mario's and
 * Kirby's forward smashes and Pikachu's up smash (held by P5-R16) among them.
 */
const RELEASES: readonly (readonly [string, MoveSlot, number, number, string])[] = [
  // Legacy, `smashHold` (R-T13i).
  ["mario", "fsmash", 5, 15, "Mario_(SSBU)/Forward_smash, revision 1956447"],
  ["mario", "usmash", 6, 9, "Mario_(SSBU)/Up_smash, revision 2046199"],
  ["donkeyKong", "fsmash", 14, 22, "Donkey_Kong_(SSBU)/Forward_smash, revision 1789698"],
  ["donkeyKong", "usmash", 6, 14, "Donkey_Kong_(SSBU)/Up_smash, revision 1789530"],
  ["donkeyKong", "dsmash", 2, 11, "Donkey_Kong_(SSBU)/Down_smash, revision 1789987"],
  ["link", "fsmash", 9, 17, "Link_(SSBU)/Forward_smash/Hit_1, revision 1706143"],
  ["link", "usmash", 5, 10, "Link_(SSBU)/Up_smash, revision 1657166"],
  ["samus", "usmash", 6, 11, "Samus_(SSBU)/Up_smash, revision 1705188"],
  ["kirby", "fsmash", 4, 13, "Kirby_(SSBU)/Forward_smash, revision 1978772"],
  ["kirby", "usmash", 8, 12, "Kirby_(SSBU)/Up_smash, revision 1978773"],
  ["kirby", "dsmash", 2, 7, "Kirby_(SSBU)/Down_smash, revision 1884636"],
  ["fox", "dsmash", 2, 6, "Fox_(SSBU)/Down_smash, revision 1686405"],
  ["pikachu", "usmash", 2, 10, "Pikachu_(SSBU)/Up_smash, revision 1686470"],
  // Script-run, START_SMASH_HOLD − 1 (R-T13e).
  ["mario", "dsmash", 2, 5, "Mario_(SSBU)/Down_smash, revision 1693143"],
  ["pikachu", "fsmash", 9, 15, "Pikachu_(SSBU)/Forward_smash, revision 1659944"],
  ["pikachu", "dsmash", 2, 8, "Pikachu_(SSBU)/Down_smash, revision 1686473"],
  ["link", "dsmash", 4, 12, "Link_(SSBU)/Down_smash, revision 1686097"],
  ["samus", "fsmash", 3, 10, "Samus_(SSBU)/Forward_smash, revision 1655099"],
  ["samus", "dsmash", 3, 9, "Samus_(SSBU)/Down_smash, revision 1696110"],
  ["fox", "fsmash", 4, 13, "Fox_(SSBU)/Forward_smash, revision 1686307"],
  ["fox", "usmash", 2, 8, "Fox_(SSBU)/Up_smash, revision 1659473"],
  ["marth", "fsmash", 2, 10, "Marth_(SSBU)/Forward_smash, revision 1700429"],
  ["marth", "usmash", 4, 13, "Marth_(SSBU)/Up_smash, revision 1700443"],
  ["marth", "dsmash", 3, 6, "Marth_(SSBU)/Down_smash, revision 1700449"],
];

describe("a held smash, from its release to its first box (https://www.ssbwiki.com/<page>)", () => {
  const GAME = bakedContext(ctx, readBakeFromDisk());
  const DIR: Partial<Record<MoveSlot, Btn>> = { fsmash: Btn.Right, usmash: Btn.Up, dsmash: Btn.Down };

  it("covers every smash the game runs, from its imported script or its legacy move", () => {
    const all = FIGHTERS.flatMap((d) => (["fsmash", "usmash", "dsmash"] as const).filter((slot) => d.moves[slot]?.chargeable === true).map((slot) => `${d.id} ${slot}`));
    expect(all).toHaveLength(24);
    expect(all.sort()).toEqual(RELEASES.map(([id, slot]) => `${id} ${slot}`).sort());
    // A legacy smash holds on its published frame; one that runs its script by its flag.
    for (const [id, slot] of RELEASES) {
      const game = GAME.fighter(id);
      expect(game.moves[slot]!.smashHold !== undefined, `${id} ${slot}`).toBe(game.scripts?.[slot] === undefined);
    }
  });

  it.each(RELEASES)("%s %s charges between %i and the next frame, and its first box comes on %i (%s)", (id, slot, chargeOn, firstBox) => {
    const def = GAME.fighter(id);
    const script = gameScriptFor(def, slot)!;
    let s = createInitialState("finalDestination", [{ defId: id }, { defId: "mario" }], RULES, 3, GAME);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? -60 : 60), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
    const HELD = 20;
    let prev: InputFrame[] = [0, 0];
    const charged: number[] = [];
    let released = -1;
    let firstLive = -1;
    for (let i = 0; i < HELD + 40 && firstLive < 0; i++) {
      const now = [i === 0 ? DIR[slot]! | Btn.Attack : i < HELD ? Btn.Attack : 0, 0];
      const before = s.fighters[0].charge;
      s = step(s, now, { prevInputs: prev, ctx: GAME }).state;
      prev = now;
      const f = s.fighters[0];
      expect(f.move, `step ${i}`).toBe(slot);
      const g = f.actionFrame + 1;
      if (f.charge > before) charged.push(g);
      else if (charged.length > 0 && released < 0) released = i;
      if (released >= 0 && runScript(script, g).attacks.length > 0) firstLive = i;
    }
    expect(charged.length).toBeGreaterThan(5);
    expect(new Set(charged)).toEqual(new Set([chargeOn]));
    // Released, the move goes on from the frame after the hold, one a step, to the published first box.
    expect(firstLive - released).toBe(firstBox - chargeOn - 1);
    expect(s.fighters[0].actionFrame + 1).toBe(firstBox);
  });
});

/**
 * Plan 5, Task 13 fix round 3 (ruling R-T13l): once let go, Attack does not touch
 * the move again. The Task 13 tail (ruling R-T13n): whether it charges at all is
 * decided on its hold frame, by Attack held there; then it charges while held, up to
 * the full hold, and a release closes it. SmashWiki "Smash attack"
 * (https://www.ssbwiki.com/Smash_attack, revision 2062630): "they can be charged
 * by holding the buttons down"; "the move's script calling for a command on a
 * certain frame to determine whether the attack will be charged or not".
 */
describe("a smash, once let go, never charges again (R-T13l)", () => {
  const GAME = bakedContext(ctx, readBakeFromDisk());
  const DIR: Partial<Record<MoveSlot, Btn>> = { fsmash: Btn.Right, usmash: Btn.Up, dsmash: Btn.Down };

  interface SwingStep {
    readonly inMove: boolean;
    readonly frame: number;
    readonly charge: number;
  }

  /** `slot` from a stand, the attack button held on the steps `held(i)` says (the press on step 0 with the direction). */
  function swing(id: string, slot: MoveSlot, held: (i: number) => boolean): SwingStep[] {
    let s = createInitialState("finalDestination", [{ defId: id }, { defId: "mario" }], RULES, 3, GAME);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? -60 : 60), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
    let prev: InputFrame[] = [0, 0];
    const out: SwingStep[] = [];
    for (let i = 0; i < 200; i++) {
      const now = [i === 0 ? DIR[slot]! | Btn.Attack : held(i) ? Btn.Attack : 0, 0];
      s = step(s, now, { prevInputs: prev, ctx: GAME }).state;
      prev = now;
      const f = s.fighters[0];
      const inMove = f.action === "attack" && f.move === slot;
      out.push({ inMove, frame: f.actionFrame, charge: f.charge });
      if (!inMove) break;
    }
    return out;
  }

  /** The step the fighter leaves the move on. */
  const endOf = (run: SwingStep[]) => run.findIndex((x) => !x.inMove);
  /** Each step in the move from `from` on is the frame after the step before it: no hold, no rewind. */
  function stepsOn(run: SwingStep[], from: number): void {
    for (let i = Math.max(1, from); i < endOf(run); i++) expect(run[i].frame, `step ${i}`).toBe(run[i - 1].frame + 1);
  }

  it.each(RELEASES)("%s %s: tapped, then Attack pressed again past its hold frame, it neither charges nor rewinds, and ends on its FAF", (id, slot, chargeOn) => {
    const tapped = swing(id, slot, () => false);
    // Pressed again two frames past the hold frame, and held for five.
    const again = swing(id, slot, (i) => i >= chargeOn + 1 && i < chargeOn + 6);
    expect(again.every((x) => x.charge === 0)).toBe(true);
    stepsOn(again, 1);
    expect(endOf(again)).toBe(endOf(tapped));
    expect(endOf(tapped)).toBeGreaterThan(chargeOn + 6);
  });

  it.each(RELEASES.filter(([, , chargeOn]) => chargeOn >= 3))("%s %s: let go before its hold frame and held again on it, it charges: decided on the hold frame (R-T13n)", (id, slot, chargeOn) => {
    // Up on step 1; down again from the step the move reaches its hold frame (game frame
    // `chargeOn`, step chargeOn − 1) for 21 steps: held on the hold frame, so it charges,
    // a frame a step. The first is the hold frame's own step, so the swing ends the
    // other 20 steps later than a tap's.
    const run = swing(id, slot, (i) => i >= chargeOn - 1 && i < chargeOn + 20);
    const charge = Math.max(...run.map((x) => x.charge));
    expect(charge).toBe(21);
    expect(endOf(run)).toBe(endOf(swing(id, slot, () => false)) + charge - 1);
  });

  it.each(RELEASES.filter(([, , chargeOn]) => chargeOn >= 3))("%s %s: held from its start but let go on its hold frame, it does not charge (R-T13n)", (id, slot, chargeOn) => {
    // Held on steps 0 to chargeOn − 3, up on step chargeOn − 2 and the hold frame's step, then held again.
    const run = swing(id, slot, (i) => i < chargeOn - 2 || i >= chargeOn);
    expect(run.every((x) => x.charge === 0)).toBe(true);
    stepsOn(run, 1);
    expect(endOf(run)).toBe(endOf(swing(id, slot, () => false)));
  });

  it.each(RELEASES)("%s %s: let go mid-charge and pressed again, it keeps the charge it had and goes on", (id, slot, chargeOn) => {
    // Held through ten frames of charge, up for two steps, then held again for ten.
    const letGo = chargeOn - 1 + 10;
    const run = swing(id, slot, (i) => i < letGo || (i >= letGo + 2 && i < letGo + 12));
    const kept = run[letGo].charge;
    expect(kept).toBeGreaterThan(5);
    expect(run.slice(letGo).every((x) => !x.inMove || x.charge === kept)).toBe(true);
    stepsOn(run, letGo);
    // It ends as a swing let go on the same step without the second press does.
    expect(endOf(run)).toBe(endOf(swing(id, slot, (i) => i < letGo)));
  });

  it("charges the next smash held from its start, after one let go", () => {
    let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 3, GAME);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? -60 : 60), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
    let prev: InputFrame[] = [0, 0];
    // A tapped forward smash; then, once it has ended, a down smash held for 30 steps.
    let second = -1;
    let charged = 0;
    for (let i = 0; i < 160; i++) {
      const f0 = s.fighters[0];
      const free = f0.action === "stand" && i > 5;
      if (free && second < 0) second = i;
      const now = [i === 0 ? Btn.Right | Btn.Attack : second >= 0 && i === second ? Btn.Down | Btn.Attack : second >= 0 && i < second + 30 ? Btn.Attack : 0, 0];
      s = step(s, now, { prevInputs: prev, ctx: GAME }).state;
      prev = now;
      if (s.fighters[0].move === "dsmash") charged = Math.max(charged, s.fighters[0].charge);
    }
    expect(second).toBeGreaterThan(0);
    expect(charged).toBeGreaterThan(20);
  });

  it("re-simulates identically from any frame of a tapped smash pressed again (rollback)", () => {
    let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 3, GAME);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? -60 : 60), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
    const inputs = (i: number): InputFrame[] => [i === 0 ? Btn.Right | Btn.Attack : i >= 8 && i < 14 ? Btn.Attack : 0, 0];
    const states: GameState[] = [];
    for (let i = 0; i < 40; i++) {
      s = step(s, inputs(i), { prevInputs: i === 0 ? [0, 0] : inputs(i - 1), ctx: GAME }).state;
      states.push(s);
    }
    for (const at of [1, 3, 7, 9]) {
      let replay = cloneState(states[at]);
      expect(hashState(replay)).toBe(hashState(states[at]));
      for (let i = at + 1; i < 40; i++) replay = step(replay, inputs(i), { prevInputs: inputs(i - 1), ctx: GAME }).state;
      expect(hashState(replay), `rolled back to ${at}`).toBe(hashState(states[39]));
    }
  });
});

describe("a Final Smash's cutscene script (Plan 5, Task 14)", () => {
  it("stays off its script even where a bone table could place `virtualfinalattack`", () => {
    // A script whose every box hangs off the cutscene bone, as `game_finalattack`'s do.
    const ref = REFERENCE_SCRIPTS.mario;
    const jab = ref.scripts[ref.slots.jab1!];
    const virtual = {
      ...jab,
      commands: jab.commands.map((c) => (c.op === "attack" ? { ...c, params: { ...c.params, bone: "virtualfinalattack" } } : c)),
    };
    const everyBone = () => true;
    const scene = { ...mario.moves.jab1!, slot: "finalAttack" as const, final: { phase: "attack" as const } };
    expect(activatable("finalAttack", { ...scene, final: undefined }, virtual, everyBone)).toBe(true);
    expect(activatable("finalAttack", scene, virtual, everyBone)).toBe(false);
    // And no committed skeleton has the bone, so the limb rule could not place it anyway.
    expect(activatable("finalAttack", { ...scene, final: undefined }, virtual)).toBe(false);
    for (const id of Object.keys(SKELETONS)) {
      expect(boneRole(SKELETONS[id], "virtualfinalattack").kind, id).toBe("missing");
      expect(activatable("finalAttack", { ...scene, final: undefined }, virtual, (bone) => placeableBone(SKELETONS[id], bone)), id).toBe(false);
    }
  });
});
