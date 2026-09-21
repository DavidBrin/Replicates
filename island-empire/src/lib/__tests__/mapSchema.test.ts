import { describe, expect, it } from "vitest";

import {
  MapDefinitionInputSchema,
  MapDefinitionSchema,
  issueMessages,
  parseMapDefinition,
} from "@/lib/mapSchema";

import { mapInput, smallMap, tile } from "./fixtures";

describe("MapDefinitionInputSchema", () => {
  it("accepts a well-formed map without an id", () => {
    expect(MapDefinitionInputSchema.safeParse(mapInput()).success).toBe(true);
  });

  it("refuses a tiles array that does not match width*height", () => {
    const input = mapInput();
    input.tiles = input.tiles.slice(1);
    const result = MapDefinitionInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(issueMessages(result.error!).join("\n")).toMatch(/tiles length must equal width\*height/);
  });

  it.each([5, 41])("refuses a %d-wide map", (width) => {
    const input = mapInput();
    input.width = width;
    expect(MapDefinitionInputSchema.safeParse(input).success).toBe(false);
  });

  it("refuses fewer than 2 or more than 8 players", () => {
    const one = mapInput();
    one.players = one.players.slice(0, 1);
    one.tiles = one.tiles.map((t) => (t.owner === 1 ? { ...t, owner: null } : t));
    expect(MapDefinitionInputSchema.safeParse(one).success).toBe(false);

    const nine = mapInput();
    nine.players = Array.from({ length: 9 }, (_, index) => ({
      index,
      colour: "blue" as const,
      kind: "ai" as const,
      startGold: 0,
    }));
    expect(MapDefinitionInputSchema.safeParse(nine).success).toBe(false);
  });

  it("refuses duplicate or out-of-order player indices", () => {
    const input = mapInput();
    input.players = [input.players[0]!, { ...input.players[1]!, index: 0 }];
    const result = MapDefinitionInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(issueMessages(result.error!).join("\n")).toMatch(/appears more than once/);
  });

  it("refuses a tile owned by a player the map does not have", () => {
    const input = mapInput();
    input.tiles[5] = tile("grass", { owner: 4 });
    const result = MapDefinitionInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(issueMessages(result.error!).join("\n")).toMatch(/owned by player 4/);
  });

  it("refuses graveAge on a non-grave and an unknown terrain", () => {
    const aged = mapInput();
    aged.tiles[0] = tile("grass", { graveAge: 0 });
    expect(MapDefinitionInputSchema.safeParse(aged).success).toBe(false);

    const bogus = mapInput();
    (bogus.tiles[0] as { terrain: string }).terrain = "lava";
    expect(MapDefinitionInputSchema.safeParse(bogus).success).toBe(false);
  });

  it("refuses a tutorial trigger id the runner does not emit", () => {
    const input = mapInput();
    input.tutorial = [{ triggerId: "unicorn" as never, text: "HI" }];
    expect(MapDefinitionInputSchema.safeParse(input).success).toBe(false);

    input.tutorial = [{ triggerId: "levelIntro", text: "HI", highlightTile: { x: 99, y: 0 } }];
    const result = MapDefinitionInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(issueMessages(result.error!).join("\n")).toMatch(/outside a 8×8 map/);
  });

  it("trims and bounds name and author", () => {
    const input = mapInput();
    input.name = "   ";
    expect(MapDefinitionInputSchema.safeParse(input).success).toBe(false);
    input.name = "x".repeat(61);
    expect(MapDefinitionInputSchema.safeParse(input).success).toBe(false);
    input.name = "  Fine  ";
    const ok = MapDefinitionInputSchema.safeParse(input);
    expect(ok.success && ok.data.name).toBe("Fine");
  });

  it("rejects a body with an id (the server assigns ids)", () => {
    // `id` is not in the input schema; zod strips unknown keys rather than
    // failing, so the point is that the parsed data never carries a caller's id.
    const parsed = MapDefinitionInputSchema.safeParse({ ...mapInput(), id: "mine" });
    expect(parsed.success).toBe(true);
    expect((parsed.data as Record<string, unknown>).id).toBeUndefined();
  });
});

describe("MapDefinitionSchema / parseMapDefinition", () => {
  it("round-trips a full definition, id included", () => {
    const map = smallMap({ id: "abc123" });
    const result = parseMapDefinition(map);
    expect(result.ok && result.map).toEqual(map);
  });

  it("accepts a null id for an unsaved draft", () => {
    expect(MapDefinitionSchema.safeParse(smallMap()).success).toBe(true);
  });

  it("reports messages with paths for a bad import", () => {
    const result = parseMapDefinition({ name: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((m) => m.startsWith("width"))).toBe(true);
    }
  });
});
