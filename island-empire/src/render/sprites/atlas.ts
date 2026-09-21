import type { Biome, Building, Decoration, PlayerColour, UnitLevel } from "@/engine/types";

import { playerHex } from "../palette";
import {
  paintChest,
  paintCity,
  paintFarm,
  paintMine,
  paintStoneTower,
  paintWoodwall,
} from "./buildings";
import {
  paintBeads,
  paintCoin,
  paintDottedFrame,
  paintIncome,
  paintShield,
  paintStar,
  paintSword,
  paintUpkeep,
} from "./glyphs";
import { HEADROOM, SPRITE_H, SPRITE_W, createPix } from "./pix";
import {
  paintBeach,
  paintBridge,
  paintDecoration,
  paintField,
  paintForest,
  paintGrave,
  paintGround,
  paintMountain,
  paintRoad,
  paintWater,
} from "./terrain";
import { paintKnight } from "./units";

/**
 * The sprite atlas: every painter rasterised lazily, once, into a native
 * 32×40 canvas keyed by `(kind, colour, biome, frame)` (SPEC §8, §10) and
 * blitted nearest-neighbour by the renderer at `tilePx / 32`.
 */

export type SpriteKind =
  | "ground"
  | "water"
  | "beachN"
  | "beachE"
  | "beachS"
  | "beachW"
  | "bridge"
  | "field"
  | "grave"
  | "forestPine"
  | "forestPalm"
  | "forestIcePine"
  | "mountain"
  | "road"
  | Decoration
  | Building
  | `knight${UnitLevel}`
  | "coin"
  | "income"
  | "upkeep"
  | "sword"
  | "shield"
  | "beadsH"
  | "beadsV"
  | "dottedFrame"
  | "star"
  | "starEmpty";

export interface SpriteKey {
  kind: SpriteKind;
  colour?: PlayerColour | null;
  biome?: Biome;
  frame?: number;
}

export interface SpriteEntry {
  canvas: CanvasImageSource;
  /** Native width / height in px. */
  w: number;
  h: number;
  /** Rows above the tile's top edge (headroom). */
  oy: number;
}

export function spriteKeyString(key: SpriteKey): string {
  return `${key.kind}|${key.colour ?? "-"}|${key.biome ?? "-"}|${key.frame ?? 0}`;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): AnyCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

function paint(key: SpriteKey, ctx: CanvasRenderingContext2D): void {
  const p = createPix(ctx, HEADROOM);
  const biome = key.biome ?? "grass";
  const frame = key.frame ?? 0;
  const colour = playerHex(key.colour ?? null);
  switch (key.kind) {
    case "ground":
      return paintGround(p, biome, frame);
    case "water":
      return paintWater(p, biome, frame);
    case "beachN":
      return paintBeach(p, "n");
    case "beachE":
      return paintBeach(p, "e");
    case "beachS":
      return paintBeach(p, "s");
    case "beachW":
      return paintBeach(p, "w");
    case "bridge":
      return paintBridge(p, biome, frame);
    case "field":
      return paintField(p, biome);
    case "grave":
      return paintGrave(p, biome);
    case "forestPine":
      return paintForest(p, biome, "pine");
    case "forestPalm":
      return paintForest(p, biome, "palm");
    case "forestIcePine":
      return paintForest(p, biome, "ice");
    case "mountain":
      return paintMountain(p, biome);
    case "road":
      return paintRoad(p, frame);
    case "rock":
    case "flowerWhite":
    case "flowerPurple":
    case "bush":
    case "tree":
      return paintDecoration(p, key.kind);
    case "city":
      return paintCity(p, biome, colour);
    case "farm":
      return paintFarm(p, biome);
    case "mine":
      return paintMine(p);
    case "chest":
      return paintChest(p);
    case "woodwall":
      return paintWoodwall(p, colour);
    case "stoneTower":
      return paintStoneTower(p, colour);
    case "knight1":
      return paintKnight(p, 1, colour);
    case "knight2":
      return paintKnight(p, 2, colour);
    case "knight3":
      return paintKnight(p, 3, colour);
    case "knight4":
      return paintKnight(p, 4, colour);
    case "coin":
      return paintCoin(p);
    case "income":
      return paintIncome(p);
    case "upkeep":
      return paintUpkeep(p);
    case "sword":
      return paintSword(p);
    case "shield":
      return paintShield(p, colour);
    case "beadsH":
      return paintBeads(p, colour, "h");
    case "beadsV":
      return paintBeads(p, colour, "v");
    case "dottedFrame":
      return paintDottedFrame(p);
    case "star":
      return paintStar(p, true);
    case "starEmpty":
      return paintStar(p, false);
  }
}

export interface SpriteAtlas {
  get(key: SpriteKey): SpriteEntry | null;
  /** How many sprites have been rasterised so far (for tests). */
  readonly size: number;
  clear(): void;
}

export function createAtlas(): SpriteAtlas {
  const cache = new Map<string, SpriteEntry | null>();
  return {
    get(key) {
      const k = spriteKeyString(key);
      const hit = cache.get(k);
      if (hit !== undefined) return hit;
      const canvas = makeCanvas(SPRITE_W, SPRITE_H);
      const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | null | undefined;
      if (!canvas || !ctx) {
        cache.set(k, null);
        return null;
      }
      paint(key, ctx);
      const entry: SpriteEntry = { canvas, w: SPRITE_W, h: SPRITE_H, oy: HEADROOM };
      cache.set(k, entry);
      return entry;
    },
    get size() {
      return cache.size;
    },
    clear() {
      cache.clear();
    },
  };
}

/** The process-wide atlas the renderer and HUD icons share. */
export const atlas: SpriteAtlas = createAtlas();
