import { describe, expect, it } from "vitest";

import { parseArgs, parseLine, parseScript, unhash } from "./parse";

/**
 * Snippets quoted from rubendal's SSBU Data Viewer, patch 13.0.1
 * (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/<Name>/data.json),
 * trimmed to the lines each test is about.
 */

describe("parseArgs", () => {
  it("splits key=value pairs and keeps values verbatim", () => {
    const a = parseArgs('ID=0, Part=0, Bone=hash40("top"), Damage=2.2, X2=LUA_VOID');
    expect(a).toEqual({ ID: "0", Part: "0", Bone: 'hash40("top")', Damage: "2.2", X2: "LUA_VOID" });
    expect(unhash(a.Bone)).toBe("top");
  });
});

describe("parseLine", () => {
  it("reads both spellings of frame and of FT_MOTION_RATE", () => {
    expect(parseLine("frame(Frame=16)")).toEqual({ op: "frame", frame: 16 });
    expect(parseLine("frame(0, 4)")).toEqual({ op: "frame", frame: 4 }); // Fox game_Attack100
    expect(parseLine("FT_MOTION_RATE(FSM=0.9)")).toEqual({ op: "motionRate", rate: 0.9 });
    expect(parseLine("FT_MOTION_RATE(0, 0.77)")).toEqual({ op: "motionRate", rate: 0.77 }); // Pikachu
  });

  it("reads the armour and intangibility commands", () => {
    expect(
      parseLine("damage(MSC=MA_MSC_DAMAGE_DAMAGE_NO_REACTION, Type=DAMAGE_NO_REACTION_MODE_ALWAYS, DamageThreshold=0)"),
    ).toEqual({ op: "superArmour", on: true });
    expect(
      parseLine("damage(MSC=MA_MSC_DAMAGE_DAMAGE_NO_REACTION, Type=DAMAGE_NO_REACTION_MODE_NORMAL, DamageThreshold=0)"),
    ).toEqual({ op: "superArmour", on: false });
    expect(parseLine("WHOLE_HIT(HIT_STATUS_XLU)")).toEqual({ op: "wholeHit", status: "HIT_STATUS_XLU" });
  });

  it("reads clears, grab clears, shield setoff and ATK_POWER", () => {
    expect(parseLine("AttackModule::clear(ID=3)")).toEqual({ op: "clear", id: 3 });
    expect(parseLine("grab(MA_MSC_CMD_GRAB_CLEAR_ALL)")).toEqual({ op: "catchClearAll" });
    expect(parseLine("grab(MA_MSC_CMD_GRAB_CLEAR, 1)")).toEqual({ op: "catchClear", id: 1 });
    expect(parseLine("ATK_SET_SHIELD_SETOFF_MUL(ID=0, ShieldstunMul=1.8)")).toEqual({
      op: "shieldSetoffMul",
      id: 0,
      mul: 1.8,
    });
    expect(parseLine("ATK_POWER(0, 5)")).toEqual({ op: "atkPower", id: 0, damage: 5 });
  });

  it("keeps anything it does not model, verbatim", () => {
    expect(parseLine("CAM_ZOOM_OUT()")).toEqual({ op: "unknown", raw: "CAM_ZOOM_OUT()" });
  });
});

describe("parseScript control flow", () => {
  it("makes is_excute blocks transparent", () => {
    const text = "frame(Frame=2)\nif(is_excute){\n\tAttackModule::clear_all()\n}\nwait(Frames=2)";
    expect(parseScript(text)).toEqual([{ op: "frame", frame: 2 }, { op: "clearAll" }, { op: "wait", frames: 2 }]);
  });

  it("turns for(N Iterations) into a loop — Mario's down air", () => {
    const text = [
      "frame(Frame=5)",
      "for(5 Iterations){",
      "\tif(is_excute){",
      "\t\tAttackModule::clear_all()",
      "\t}",
      "\twait(Frames=1)",
      "}",
    ].join("\n");
    expect(parseScript(text)).toEqual([
      { op: "frame", frame: 5 },
      { op: "loop", count: 5, body: [{ op: "clearAll" }, { op: "wait", frames: 1 }] },
    ]);
  });

  // The duplicate mirrors the first copy command for command, then prints the tail both copies
  // share: Mario's up special ends `wait(Frames=2)` and a `clear_all` only the duplicate carries.
  // Stopping at the marker lost that `clear_all`, and the move's boxes never closed (Plan 3,
  // Task 18, carried from Plan 2 Task 16).
  it("takes the first copy of a costume-flagged move, and from the decompiler's duplicate only the tail both share — Mario's up special", () => {
    const text = [
      "WorkModule::is_flag(FIGHTER_MARIO_STATUS_SPECIAL_HI_FLAG_CAPPY)",
      "if(0xe1ba0(false, true)){",
      "\tframe(Frame=3)",
      "}",
      "wait(Frames=2)",
      "methodlib::L2CValue::operatorbool()const(is_excute)",
      "frame(Frame=1)",
      "wait(Frames=2)",
      "if(is_excute){",
      "\tAttackModule::clear_all()",
      "}",
    ].join("\n");
    expect(parseScript(text)).toEqual([
      { op: "unknown", raw: "WorkModule::is_flag(FIGHTER_MARIO_STATUS_SPECIAL_HI_FLAG_CAPPY)" },
      { op: "frame", frame: 3 },
      { op: "wait", frames: 2 },
      { op: "clearAll" },
    ]);
  });

  it("refuses a duplicate that does not mirror the first copy, rather than guess which of it is the shared tail", () => {
    const text = [
      "frame(Frame=3)",
      "wait(Frames=2)",
      "methodlib::L2CValue::operatorbool()const(is_excute)",
      "AttackModule::clear_all()",
    ].join("\n");
    expect(() => parseScript(text)).toThrow(/duplicate does not mirror/);
  });

  it("skips a Kirby-copy branch and takes its else — Marth's Shield Breaker", () => {
    const text = [
      "if(methodlib::L2CValue::operator==(lib::L2CValueconst&)const(FIGHTER_INSTANCE_WORK_ID_INT_KIND, FIGHTER_KIND_KIRBY)){",
      "\tAttackModule::clear(ID=9)",
      "}",
      "else{",
      "\tAttackModule::clear(ID=1)",
      "}",
    ].join("\n");
    expect(parseScript(text)).toEqual([{ op: "clear", id: 1 }]);
  });
});
