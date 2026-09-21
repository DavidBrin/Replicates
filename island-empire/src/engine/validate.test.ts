import { describe, expect, it } from "vitest";
import { asciiMap } from "./testing/asciiMap";
import type { MapDefinition } from "./types";
import { validateMap } from "./validate";

const good = (): MapDefinition =>
  asciiMap({
    terrain: ["~~~~~~~", "~.....~", "~..=..~", "~.....~", "~~~~~~~", "~~~~~~~"],
    owners: [".......", ".00.11.", ".00.11.", ".......", ".......", "......."],
    objects: [".......", ".C1.C..", ".......", ".......", ".......", "......."],
  });

describe("validateMap (SPEC §4, §6)", () => {
  it("accepts a well-formed map", () => {
    expect(validateMap(good())).toEqual({ valid: true, errors: [] });
  });

  it("checks dimensions and tile count", () => {
    const m = good();
    expect(validateMap({ ...m, width: 5 }).errors[0]).toMatch(/6\.\.40/);
    expect(validateMap({ ...m, height: 41 }).errors[0]).toMatch(/6\.\.40/);
    expect(validateMap({ ...m, tiles: m.tiles.slice(1) }).errors.join()).toMatch(/tiles length/);
  });

  it("checks the player list: 2..8, unique indices and colours, index = position", () => {
    const m = good();
    expect(validateMap({ ...m, players: [m.players[0]!] }).errors.join()).toMatch(/2\.\.8/);
    const dupColour = { ...m, players: [m.players[0]!, { ...m.players[1]!, colour: "blue" as const }] };
    expect(validateMap(dupColour).errors.join()).toMatch(/colour blue is duplicated/);
    const badIndex = { ...m, players: [m.players[0]!, { ...m.players[1]!, index: 3 }] };
    expect(validateMap(badIndex).errors.join()).toMatch(/index must equal its position/);
    const owner9 = { ...m, tiles: m.tiles.map((t, i) => (i === 1 * 7 + 1 ? { ...t, owner: 5 } : t)) };
    expect(validateMap(owner9).errors.join()).toMatch(/owner 5 is not a player index/);
  });

  it("requires every player to have a city on a province of at least 2 tiles", () => {
    const noCity = asciiMap({
      terrain: ["~~~~~~~", "~.....~", "~.....~", "~.....~", "~~~~~~~", "~~~~~~~"],
      owners: [".......", ".00.11.", ".00..1.", ".......", ".......", "......."],
      objects: [".......", ".C.....", ".......", ".......", ".......", "......."],
    });
    const errors = validateMap(noCity).errors;
    expect(errors).toContain("player 1 has no city on a province of at least 2 tiles");
    expect(errors.join()).toMatch(/province of player 1 at \(4,1\) has no city/);
    expect(errors).toHaveLength(2);
    const loneCity = asciiMap({
      terrain: ["~~~~~~~", "~.....~", "~.....~", "~.....~", "~~~~~~~", "~~~~~~~"],
      owners: [".......", ".00..1.", ".00....", ".......", ".......", "......."],
      objects: [".......", ".C...C.", ".......", ".......", ".......", "......."],
    });
    expect(validateMap(loneCity).errors).toContain("lone province of player 1 at (5,1) carries a city");
    const twoCities = asciiMap({
      terrain: ["~~~~~~~", "~.....~", "~.....~", "~.....~", "~~~~~~~", "~~~~~~~"],
      owners: [".......", ".00.11.", ".00.11.", ".......", ".......", "......."],
      objects: [".......", ".C..CC.", ".......", ".......", ".......", "......."],
    });
    expect(validateMap(twoCities).errors.join()).toMatch(/has 2 cities/);
  });

  it("requires ownable land to be 4-connected, counting bridges", () => {
    const split = asciiMap({
      terrain: ["~~~~~~~", "~..~..~", "~..~..~", "~~~~~~~", "~~~~~~~", "~~~~~~~"],
      owners: [".......", ".00.11.", ".00.11.", ".......", ".......", "......."],
      objects: [".......", ".C..C..", ".......", ".......", ".......", "......."],
    });
    expect(validateMap(split).errors.join()).toMatch(/not 4-connected \(4 tiles unreachable\)/);
    const bridged = asciiMap({
      terrain: ["~~~~~~~", "~..=..~", "~..~..~", "~~~~~~~", "~~~~~~~", "~~~~~~~"],
      owners: [".......", ".00.11.", ".00.11.", ".......", ".......", "......."],
      objects: [".......", ".C..C..", ".......", ".......", ".......", "......."],
    });
    expect(validateMap(bridged).valid).toBe(true);
  });

  it("rejects units / buildings / owners on non-ownable terrain and other tile-level mistakes", () => {
    const m = good();
    const water = m.tiles[0]!;
    const withBad = (patch: Partial<MapDefinition["tiles"][number]>, index = 0) => ({
      ...m,
      tiles: m.tiles.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    });
    expect(validateMap(withBad({ owner: 0 })).errors).toContain("tile (0,0) is water and cannot be owned");
    expect(validateMap(withBad({ building: "farm" })).errors).toContain("tile (0,0) has a building on water");
    expect(validateMap(withBad({ unit: { level: 1 } })).errors.join()).toMatch(/unit on water/);
    void water;
    // (3,1) is neutral grass.
    expect(validateMap(withBad({ unit: { level: 1 } }, 1 * 7 + 3)).errors).toContain("tile (3,1) has a unit on unowned land");
    expect(validateMap(withBad({ building: "city" }, 1 * 7 + 3)).errors).toContain("tile (3,1) has a city on unowned land");
    expect(validateMap(withBad({ graveAge: 1 }, 1 * 7 + 3)).errors).toContain("tile (3,1) has graveAge but is not a grave");
    expect(validateMap(withBad({ terrain: "grassField", building: "farm" }, 1 * 7 + 3)).errors).toContain("tile (3,1) has a building on a grassField");
    expect(validateMap(withBad({ unit: { level: 1 }, building: "farm" }, 1 * 7 + 1)).errors).toContain("tile (1,1) has both a unit and a farm");
    expect(validateMap(withBad({ unit: { level: 7 as unknown as 1 } }, 1 * 7 + 1)).errors).toContain("tile (1,1) unit level must be 1..4");
    expect(validateMap(withBad({ terrain: "lava" as unknown as "grass" }, 1 * 7 + 1)).errors).toContain("tile (1,1) has unknown terrain lava");
  });

  it("checks tutorial trigger ids, highlight tiles and the difficulty table", () => {
    const m = good();
    const tut = { ...m, tutorial: [{ triggerId: "nope" as never, text: "HI" }, { triggerId: "levelIntro" as const, text: "", highlightTile: { x: 99, y: 0 } }] };
    const errors = validateMap(tut).errors;
    expect(errors).toContain("tutorial[0].triggerId nope is not a known trigger");
    expect(errors).toContain("tutorial[1].text must be a non-empty string");
    expect(errors).toContain("tutorial[1].highlightTile is out of bounds");
    const diff = { ...m, difficulty: { easy: { aiStartGoldMultiplier: 0.5 }, normal: { aiStartGoldMultiplier: -1 }, hard: { aiStartGoldMultiplier: 1.5 } } };
    expect(validateMap(diff).errors).toEqual(["difficulty.normal.aiStartGoldMultiplier must be a non-negative number"]);
  });

  it("never throws on garbage", () => {
    expect(validateMap(null as unknown as MapDefinition).valid).toBe(false);
    expect(validateMap({} as MapDefinition).valid).toBe(false);
    expect(validateMap({ ...good(), tiles: "x" as unknown as [] }).valid).toBe(false);
  });
});
