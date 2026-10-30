import { describe, expect, it } from "vitest";

import { flatten } from "@/engine/acmd/interpreter";
import type { AcmdCommand } from "@/engine/acmd/types";
import { fx } from "@/engine/fixed";
import { REFERENCE_SCRIPTS } from "./index";
import { liftScript, parseAbs } from "./lift";

/**
 * The importer's `unknown` commands Plan 5 Task 7 runs, lifted at activation.
 * The strings are rubendal's SSBU Data Viewer (patch 13.0.1), as
 * `scripts/import-acmd.mjs` kept them in `generated/`.
 */
describe("lifting a throw's ATTACK_ABS, ATK_HIT_ABS and set_catch_only_all", () => {
  // Mario's `game_throwf` (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Mario/data.json).
  const MARIO_FTHROW =
    'ATTACK_ABS(Kind=FIGHTER_ATTACK_ABSOLUTE_KIND_THROW, ID=0, Damage=8.0, Angle=45, KBG=65, FKB=0, BKB=60, Hitlag=0.0, Unk=1.0, FacingRestrict=ATTACK_LR_CHECK_F, Unk=0.0, Unk=true, Effect=hash40("collision_attr_normal"), SFXLevel=ATTACK_SOUND_LEVEL_S, SFXType=COLLISION_SOUND_ATTR_NONE, Type=ATTACK_REGION_THROW)';

  it("reads a throw's launch", () => {
    expect(parseAbs(MARIO_FTHROW)).toEqual({
      kind: "throw",
      damage: fx(8),
      angle: fx(45),
      kbg: fx(65),
      fkb: 0,
      bkb: fx(60),
      hitlag: 0,
      collisionAttr: "collision_attr_normal",
    });
  });

  it("reads the CATCH kind, and refuses anything else", () => {
    expect(parseAbs(MARIO_FTHROW.replace("KIND_THROW", "KIND_CATCH"))?.kind).toBe("catch");
    expect(parseAbs(MARIO_FTHROW.replace("KIND_THROW", "KIND_NONE"))).toBeNull();
    expect(parseAbs("ATK_HIT_ABS(FIGHTER_ATTACK_ABSOLUTE_KIND_THROW)")).toBeNull();
  });

  // Pikachu's `game_throwlw` is the one throw with a non-zero Hitlag; Samus's carry
  // `collision_attr_elec_whip`.
  it("keeps the hitlag and the effect as written", () => {
    const pika = flatten(liftScript(REFERENCE_SCRIPTS.pikachu.scripts.game_throwlw)).find((c) => c.op === "attackAbs" && c.params.kind === "throw");
    expect(pika?.op === "attackAbs" && pika.params.hitlag).toBe(fx(1));
    const samus = flatten(liftScript(REFERENCE_SCRIPTS.samus.scripts.game_throwf)).find((c) => c.op === "attackAbs");
    expect(samus?.op === "attackAbs" && samus.params.collisionAttr).toBe("collision_attr_elec_whip");
  });

  it("lifts inside loops (Kirby's down throw), and leaves every other command as it was", () => {
    const raw = REFERENCE_SCRIPTS.kirby.scripts.game_throwlw;
    const lifted = liftScript(raw);
    const ops = (cmds: readonly AcmdCommand[]) => cmds.map((c) => c.op);
    const flat = flatten(lifted);
    expect(flat.filter((c) => c.op === "catchOnly")).toHaveLength(10);
    expect(flat.filter((c) => c.op === "hitAbs")).toHaveLength(1);
    expect(flat.filter((c) => c.op === "attackAbs")).toHaveLength(2);
    // One for one: a lifted command takes its unknown's place.
    expect(lifted.commands).toHaveLength(raw.commands.length);
    expect(ops(flatten(raw)).filter((op) => op !== "unknown")).toEqual(ops(flat).filter((op) => !["unknown", "catchOnly", "hitAbs", "attackAbs"].includes(op)));
    expect(flat.some((c) => c.op === "unknown" && c.raw.startsWith("CHECK_FINISH_CAMERA"))).toBe(true);
  });

  it("hands back the same object for the same script, and never touches the import", () => {
    const raw = REFERENCE_SCRIPTS.mario.scripts.game_throwf;
    expect(liftScript(raw)).toBe(liftScript(raw));
    expect(raw.commands.some((c) => c.op === "unknown" && c.raw.startsWith("ATTACK_ABS"))).toBe(true);
    // A script with nothing to lift is handed back as it is.
    const plain = REFERENCE_SCRIPTS.mario.scripts.game_attack11;
    expect(liftScript(plain)).toBe(plain);
  });
});
