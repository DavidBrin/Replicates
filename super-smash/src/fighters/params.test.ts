import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import type { FighterParams } from "@/engine/params";
import { FIGHTERS } from "./index";
import { FIGHTER_PARAMS, type RosterId } from "./params";

/**
 * Source: rubendal/SSBU-Calculator, `Params` block of
 * https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/<fighter>/data.json,
 * as extracted to research/rebuild-2026-10/ssbu_fighter_params.csv (committed by Plan 1 Task 23).
 */
const CSV = readFileSync(
  join(process.cwd(), "research", "rebuild-2026-10", "ssbu_fighter_params.csv"),
  "utf8",
);

const CSV_ROW: Record<RosterId, string> = {
  mario: "mario",
  donkeyKong: "donkey",
  link: "link",
  samus: "samus",
  kirby: "kirby",
  fox: "fox",
  pikachu: "pikachu",
  marth: "marth",
};

/** prc name → CSV column, and whether the value is raw (frames, counts, weight) or Q12. */
const COLUMNS: readonly [keyof FighterParams, string, "raw" | "fx"][] = [
  ["weight", "Weight", "raw"],
  ["air_accel_y", "Gravity", "fx"],
  ["air_speed_y_stable", "FallSpeed", "fx"],
  ["dive_speed_y", "FastFallSpeed", "fx"],
  ["damage_fly_top_air_accel_y", "DamageFlyTopGravity", "fx"],
  ["walk_speed_max", "WalkSpeed", "fx"],
  ["dash_speed", "DashInitialSpeed", "fx"],
  ["run_speed_max", "RunSpeed", "fx"],
  ["run_accel_add", "RunBaseAcceleration", "fx"],
  ["run_accel_mul", "RunAddAcceleration", "fx"],
  ["ground_brake", "GroundFriction", "fx"],
  ["jump_squat_frame", "Jumpsquat", "raw"],
  ["jump_y", "JumpHeight", "fx"],
  ["mini_jump_y", "HopHeight", "fx"],
  ["jump_aerial_y", "AirJumpHeight", "fx"],
  ["jump_count_max", "JumpCount", "raw"],
  ["air_speed_x_stable", "AirSpeed", "fx"],
  ["air_accel_x_add", "AerialBaseAcceleration", "fx"],
  ["air_accel_x_mul", "AerialAddAcceleration", "fx"],
  ["air_brake_x", "AirFriction", "fx"],
  ["shield_radius", "ShieldSize", "fx"],
  ["landing_frame_light", "SoftLandingLag", "raw"],
  ["landing_frame", "HardLandingLag", "raw"],
  ["landing_attack_air_frame_n", "NairLandingLag", "raw"],
  ["landing_attack_air_frame_f", "FairLandingLag", "raw"],
  ["landing_attack_air_frame_b", "BairLandingLag", "raw"],
  ["landing_attack_air_frame_hi", "UairLandingLag", "raw"],
  ["landing_attack_air_frame_lw", "DairLandingLag", "raw"],
  ["scale", "CharacterSizeMultiplier", "fx"],
];

function csvRow(internal: string): Record<string, string> {
  const lines = CSV.trim().split("\n");
  const header = lines[0].split(",");
  const line = lines.find((l) => l.split(",")[0] === internal);
  if (line === undefined) throw new Error(`no CSV row for ${internal}`);
  const cells = line.split(",");
  return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
}

const IDS = Object.keys(FIGHTER_PARAMS) as RosterId[];

describe("fighter_param values", () => {
  it.each(IDS)("%s matches every published CSV column", (id) => {
    const row = csvRow(CSV_ROW[id]);
    const p = FIGHTER_PARAMS[id];
    for (const [key, column, kind] of COLUMNS) {
      const want = kind === "raw" ? Number(row[column]) : fx(Number(row[column]));
      expect(p[key], `${id}.${key} vs CSV ${column}`).toBe(want);
    }
  });

  it("pins the calculator-only fields for Mario (Data/mario/data.json)", () => {
    // https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/mario/data.json
    const m = FIGHTER_PARAMS.mario;
    expect(m.walk_accel_add).toBe(fx(0.105)); // WalkBaseAcceleration
    expect(m.walk_accel_mul).toBe(fx(0.105)); // WalkAddAcceleration
    expect(m.jump_initial_y).toBe(fx(19.9815)); // JumpInitialSpeed
    expect(m.landing_heavy_frame).toBe(4); // FallingFrameToUseHardLandingLag
    expect(m.damage_fly_top_speed_y_stable).toBe(fx(1.8)); // DamageFlyTopFallSpeed
  });

  it("gives Samus the one non-4 heavy-landing threshold on this roster", () => {
    // https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/samus/data.json
    expect(FIGHTER_PARAMS.samus.landing_heavy_frame).toBe(7);
  });

  it.each(IDS)("%s rises 0.55 of its full hop in the initial phase", (id) => {
    // SmashWiki "Jump" (https://www.ssbwiki.com/Jump), Super Smash Bros. Ultimate:
    // "For most characters the initial height is 0.55× their full hop height".
    const p = FIGHTER_PARAMS[id];
    expect(Math.abs(p.jump_initial_y - Math.round(p.jump_y * 0.55))).toBeLessThanOrEqual(1);
  });

  it("gives Kirby the five published midair jump heights", () => {
    // https://www.ssbwiki.com/Jump — Super Smash Bros. Ultimate table, Kirby, Air Jump:
    // "21.06378125, 18.528125, 15.931125, 13.34569531, 10.82288281 for each air jump."
    // (https://www.ssbwiki.com/Double_jump lists 22 for Kirby: the AirJumpHeight parameter,
    // which `jump_aerial_y` keeps; the Jump table is the height each jump reaches.)
    expect(FIGHTER_PARAMS.kirby.jump_aerial_y_list).toEqual([
      fx(21.06378125),
      fx(18.528125),
      fx(15.931125),
      fx(13.34569531),
      fx(10.82288281),
    ]);
    expect(FIGHTER_PARAMS.kirby.jump_aerial_y).toBe(fx(22));
  });
});

describe("roster wiring", () => {
  it.each(FIGHTERS.map((f) => [f.id, f] as const))("%s carries its own params", (id, def) => {
    expect(def.params).toBe(FIGHTER_PARAMS[id as RosterId]);
  });

  it.each(FIGHTERS.map((f) => [f.id, f] as const))(
    "%s agrees with its legacy attributes wherever both exist",
    (_id, def) => {
      const a = def.attributes;
      const p = def.params!;
      expect(p.weight).toBe(a.weight);
      expect(p.walk_speed_max).toBe(a.walkSpeed);
      expect(p.dash_speed).toBe(a.initialDashSpeed);
      expect(p.run_speed_max).toBe(a.runSpeed);
      expect(p.air_speed_x_stable).toBe(a.airSpeed);
      expect(p.air_accel_x_add).toBe(a.airAccelBase);
      expect(p.air_accel_x_mul).toBe(a.airAccelAdditional);
      expect(p.air_accel_y).toBe(a.gravity);
      expect(p.air_speed_y_stable).toBe(a.fallSpeed);
      expect(p.dive_speed_y).toBe(a.fastFallSpeed);
      expect(p.ground_brake).toBe(a.traction);
      expect(p.jump_count_max).toBe(a.jumps);
      expect(p.jump_squat_frame).toBe(a.jumpSquatFrames);
      expect(p.landing_attack_air_frame_n).toBe(def.moves.nair?.landingLag);
      expect(p.landing_attack_air_frame_f).toBe(def.moves.fair?.landingLag);
      expect(p.landing_attack_air_frame_b).toBe(def.moves.bair?.landingLag);
      expect(p.landing_attack_air_frame_hi).toBe(def.moves.uair?.landingLag);
      expect(p.landing_attack_air_frame_lw).toBe(def.moves.dair?.landingLag);
    },
  );

  it("walks Link at the published 1.247, not the 1.237 the roster had", () => {
    // https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/link/data.json WalkSpeed 1.247;
    // CSV row `link` agrees. 1.237 was a transcription error.
    const link = FIGHTERS.find((f) => f.id === "link")!;
    expect(link.attributes.walkSpeed).toBe(fx(1.247));
  });
});
