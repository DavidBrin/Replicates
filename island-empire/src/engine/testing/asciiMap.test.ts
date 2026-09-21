import { describe, expect, it } from "vitest";
import { asciiMap, renderAscii } from "./asciiMap";
import { validateMap } from "../validate";

describe("asciiMap", () => {
  const spec = {
    terrain: ["~~~~~~~", "~..^..~", "~.T=f.~", "~..g..~", "~~~~~~~"],
    owners: ["......", "", "", "", ""].map((_, i) => ["......." , ".00.11.", ".0.....", ".0...1.", "......."][i] as string),
    objects: [".......", ".C1.C..", ".W.....", ".F...2.", "......."],
  };

  it("builds a MapDefinition from the three layers", () => {
    const map = asciiMap(spec);
    expect(map.width).toBe(7);
    expect(map.height).toBe(5);
    expect(map.tiles[1 * 7 + 3]?.terrain).toBe("mountain");
    expect(map.tiles[2 * 7 + 2]?.terrain).toBe("forestPine");
    expect(map.tiles[2 * 7 + 3]?.terrain).toBe("bridge");
    expect(map.tiles[2 * 7 + 4]?.terrain).toBe("grassField");
    expect(map.tiles[3 * 7 + 3]?.terrain).toBe("grave");
    expect(map.tiles[3 * 7 + 3]?.graveAge).toBe(0);
    expect(map.tiles[1 * 7 + 1]).toMatchObject({ owner: 0, building: "city" });
    expect(map.tiles[1 * 7 + 2]).toMatchObject({ owner: 0, unit: { level: 1 } });
    expect(map.tiles[3 * 7 + 5]).toMatchObject({ owner: 1, unit: { level: 2 } });
    expect(map.players.map((p) => p.kind)).toEqual(["human", "ai"]);
  });

  it("uses the biome's terrain skins", () => {
    const map = asciiMap({ ...spec, biome: "desert" });
    expect(map.tiles[1 * 7 + 1]?.terrain).toBe("sand");
    expect(map.tiles[2 * 7 + 2]?.terrain).toBe("forestPalm");
    expect(asciiMap({ ...spec, biome: "snow" }).tiles[2 * 7 + 2]?.terrain).toBe("forestIcePine");
  });

  it("round-trips through renderAscii", () => {
    const map = asciiMap(spec);
    const rendered = renderAscii(map);
    expect(rendered.terrain).toEqual(spec.terrain);
    expect(rendered.owners).toEqual(spec.owners);
    expect(rendered.objects).toEqual(spec.objects);
  });

  it("rejects ragged layers and unknown characters", () => {
    expect(() => asciiMap({ terrain: ["..", "..."] })).toThrow(/dimensions/);
    expect(() => asciiMap({ terrain: ["x."] })).toThrow(/terrain character/);
    expect(() => asciiMap({ terrain: [".."], owners: ["9."] })).toThrow(/owner character/);
    expect(() => asciiMap({ terrain: [".."], objects: ["Z."] })).toThrow(/object character/);
  });

  it("produces a validateMap-clean map for a sane fixture", () => {
    const map = asciiMap({
      terrain: ["~~~~~~", "~....~", "~....~", "~~~~~~", "~~~~~~", "~~~~~~"],
      owners: ["......", ".00.1.", ".0011.", "......", "......", "......"],
      objects: ["......", ".C..C.", ".1....", "......", "......", "......"],
    });
    expect(validateMap(map).errors).toEqual([]);
  });
});
