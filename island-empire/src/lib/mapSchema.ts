import { z } from "zod";

import type { MapDefinition, PlayerColour, Terrain, TutorialTriggerId } from "@/engine/types";

/**
 * The wire shape of a `MapDefinition` (SPEC §6), as zod.
 *
 * This is the boundary check — "is this JSON the shape the engine types
 * say" — and it is deliberately dumber than `validateMap`: it knows nothing
 * about provinces, connectivity or whether every player owns a city. Those
 * are rules, and rules live in `src/engine`. The route runs both, in that
 * order: a 400 for a body that is not a map, a 422 for a map the rules
 * reject. The editor imports the same schemas so an Import-JSON paste is
 * refused with the same messages the server would use.
 *
 * `MapDefinitionInput` is `MapDefinition` minus `id` (the server assigns
 * one). The full `MapDefinitionSchema` — `id` included — is what `GET` bodies
 * and editor exports satisfy.
 */

export const TERRAINS = [
  "grass",
  "sand",
  "snow",
  "water",
  "bridge",
  "grassField",
  "grave",
  "forestPine",
  "forestPalm",
  "forestIcePine",
  "mountain",
] as const satisfies readonly Terrain[];

export const BUILDINGS = ["city", "farm", "mine", "chest", "woodwall", "stoneTower"] as const;
export const DECORATIONS = ["rock", "flowerWhite", "flowerPurple", "bush", "tree"] as const;
export const BIOMES = ["grass", "desert", "snow"] as const;
/** Mirrors `PLAYER_COLOURS` in `engine/types.ts` as a literal tuple zod can enumerate. */
export const PLAYER_COLOUR_NAMES = [
  "blue",
  "red",
  "green",
  "yellow",
  "purple",
  "pink",
  "orange",
  "grey",
] as const satisfies readonly PlayerColour[];
type MissingColour = Exclude<PlayerColour, (typeof PLAYER_COLOUR_NAMES)[number]>;
const _missingColour: MissingColour[] = [];
void _missingColour;
export const DIFFICULTIES = ["easy", "normal", "hard"] as const;

/** Mirrors `TutorialTriggerId` in `engine/types.ts`; checked below to stay exhaustive. */
export const TUTORIAL_TRIGGER_IDS = [
  "levelIntro",
  "turnStart:1",
  "turnStart:2",
  "turnStart:3",
  "turnStart:5",
  "unitSelected:first",
  "unitMoved:first",
  "captured:first",
  "attackBlocked:defence",
  "attackBlocked:wall",
  "notEnoughGold",
  "bought:first",
  "bought:woodwall",
  "bought:farm",
  "merged:first",
  "fieldCleared:first",
  "enemyCityCaptured",
  "victory",
  "defeat",
] as const satisfies readonly TutorialTriggerId[];

// If the engine adds a trigger id, this stops compiling until the list above
// gains it — the zod enum cannot be derived from a type alias at runtime.
const _exhaustive: readonly TutorialTriggerId[] = TUTORIAL_TRIGGER_IDS;
void _exhaustive;
type MissingTrigger = Exclude<TutorialTriggerId, (typeof TUTORIAL_TRIGGER_IDS)[number]>;
const _missing: MissingTrigger[] = [];
void _missing;

export const MAP_MIN_SIZE = 6;
export const MAP_MAX_SIZE = 40;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

const int = z.number().int();

export const TileCoordSchema = z.object({ x: int.min(0), y: int.min(0) });

export const TileDefinitionSchema = z.object({
  terrain: z.enum(TERRAINS),
  owner: int.min(0).max(MAX_PLAYERS - 1).nullable(),
  building: z.enum(BUILDINGS).nullable(),
  unit: z
    .object({ level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) })
    .nullable(),
  decoration: z.enum(DECORATIONS).nullable(),
  road: z.boolean(),
  graveAge: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const PlayerSlotDefinitionSchema = z.object({
  index: int.min(0).max(MAX_PLAYERS - 1),
  colour: z.enum(PLAYER_COLOUR_NAMES),
  kind: z.enum(["human", "ai", "empty"]),
  startGold: int.min(0).max(100_000),
});

export const TutorialStepSchema = z.object({
  triggerId: z.enum(TUTORIAL_TRIGGER_IDS),
  text: z.string().min(1).max(400),
  highlightTile: TileCoordSchema.optional(),
});

export const DifficultyTuningSchema = z.object({
  aiStartGoldMultiplier: z.number().min(0).max(10),
});

export const DifficultyTableSchema = z.object({
  easy: DifficultyTuningSchema,
  normal: DifficultyTuningSchema,
  hard: DifficultyTuningSchema,
});

const MapBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  author: z.string().trim().min(1).max(40),
  width: int.min(MAP_MIN_SIZE).max(MAP_MAX_SIZE),
  height: int.min(MAP_MIN_SIZE).max(MAP_MAX_SIZE),
  biome: z.enum(BIOMES),
  tiles: z.array(TileDefinitionSchema).max(MAP_MAX_SIZE * MAP_MAX_SIZE),
  players: z.array(PlayerSlotDefinitionSchema).min(MIN_PLAYERS).max(MAX_PLAYERS),
  tutorial: z.array(TutorialStepSchema).max(200),
  difficulty: DifficultyTableSchema.nullable(),
});

type MapBody = z.infer<typeof MapBodySchema>;

/**
 * The cross-field rules that a field-by-field schema cannot say. Shared by
 * both schemas below so the input and the full definition agree.
 */
function refineMap(map: MapBody, ctx: z.RefinementCtx): void {
  if (map.tiles.length !== map.width * map.height) {
    ctx.addIssue({
      code: "custom",
      path: ["tiles"],
      message: `tiles length must equal width*height (${map.width * map.height}), got ${map.tiles.length}`,
    });
  }
  const indices = new Set<number>();
  map.players.forEach((player, position) => {
    if (indices.has(player.index)) {
      ctx.addIssue({
        code: "custom",
        path: ["players", position, "index"],
        message: `player index ${player.index} appears more than once`,
      });
    }
    indices.add(player.index);
    if (player.index !== position) {
      ctx.addIssue({
        code: "custom",
        path: ["players", position, "index"],
        message: `players must be listed in seat order: expected index ${position}, got ${player.index}`,
      });
    }
  });
  map.tiles.forEach((tile, i) => {
    if (tile.owner !== null && tile.owner >= map.players.length) {
      ctx.addIssue({
        code: "custom",
        path: ["tiles", i, "owner"],
        message: `tile ${i} is owned by player ${tile.owner} but the map has ${map.players.length} players`,
      });
    }
    if (tile.graveAge !== undefined && tile.terrain !== "grave") {
      ctx.addIssue({
        code: "custom",
        path: ["tiles", i, "graveAge"],
        message: `tile ${i} has graveAge but is not a grave`,
      });
    }
  });
  map.tutorial.forEach((step, i) => {
    const at = step.highlightTile;
    if (at && (at.x >= map.width || at.y >= map.height)) {
      ctx.addIssue({
        code: "custom",
        path: ["tutorial", i, "highlightTile"],
        message: `tutorial step ${i} highlights (${at.x},${at.y}), outside a ${map.width}×${map.height} map`,
      });
    }
  });
}

/** What `POST /api/maps` accepts: a `MapDefinition` without `id`. */
export const MapDefinitionInputSchema = MapBodySchema.superRefine(refineMap);
export type MapDefinitionInput = z.infer<typeof MapDefinitionInputSchema>;

/** A full `MapDefinition`, `id` included (`null` for an unsaved draft). */
export const MapDefinitionSchema = MapBodySchema.extend({
  id: z.string().min(1).max(64).nullable(),
}).superRefine(refineMap);

/** zod issues as the `string[]` the API and the editor's validate panel show. */
export function issueMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? `${issue.path.map(String).join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}

/** A typed parse that returns the input as the engine's `MapDefinition`. */
export function parseMapDefinition(
  input: unknown,
): { ok: true; map: MapDefinition } | { ok: false; errors: string[] } {
  const parsed = MapDefinitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: issueMessages(parsed.error) };
  return { ok: true, map: parsed.data as MapDefinition };
}
