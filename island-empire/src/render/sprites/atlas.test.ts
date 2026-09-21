import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAYER_COLOURS } from "@/engine/types";

import { createAtlas, spriteKeyString, type SpriteKind } from "./atlas";

/**
 * jsdom has no canvas implementation: `getContext` returns null. The stub
 * below records draw calls so the painters can be exercised and the cache
 * observed.
 */
function fakeContext() {
  const calls: string[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    fillRect: vi.fn(() => calls.push("fillRect")),
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
  };
  return { ctx, calls };
}

const ALL_KINDS: SpriteKind[] = [
  "ground",
  "water",
  "beachN",
  "beachE",
  "beachS",
  "beachW",
  "bridge",
  "field",
  "grave",
  "forestPine",
  "forestPalm",
  "forestIcePine",
  "mountain",
  "road",
  "rock",
  "flowerWhite",
  "flowerPurple",
  "bush",
  "tree",
  "city",
  "farm",
  "mine",
  "chest",
  "woodwall",
  "stoneTower",
  "knight1",
  "knight2",
  "knight3",
  "knight4",
  "coin",
  "income",
  "upkeep",
  "sword",
  "shield",
  "beadsH",
  "beadsV",
  "dottedFrame",
  "star",
  "starEmpty",
];

describe("sprite atlas", () => {
  let getContext: ReturnType<typeof vi.spyOn>;
  let contexts: ReturnType<typeof fakeContext>[];

  beforeEach(() => {
    contexts = [];
    vi.stubGlobal("OffscreenCanvas", undefined);
    getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => {
        const c = fakeContext();
        contexts.push(c);
        return c.ctx as unknown as CanvasRenderingContext2D;
      }) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rasterises a sprite once and returns the cached entry afterwards", () => {
    const atlas = createAtlas();
    const a = atlas.get({ kind: "knight1", colour: "blue" });
    const b = atlas.get({ kind: "knight1", colour: "blue" });
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(atlas.size).toBe(1);
    expect(contexts[0]!.calls.length).toBeGreaterThan(20);
  });

  it("keys by (kind, colour, biome, frame)", () => {
    const atlas = createAtlas();
    atlas.get({ kind: "knight1", colour: "blue" });
    atlas.get({ kind: "knight1", colour: "red" });
    atlas.get({ kind: "city", colour: "red", biome: "grass" });
    atlas.get({ kind: "city", colour: "red", biome: "desert" });
    atlas.get({ kind: "water", biome: "grass", frame: 0 });
    atlas.get({ kind: "water", biome: "grass", frame: 1 });
    expect(atlas.size).toBe(6);
    expect(spriteKeyString({ kind: "city", colour: "red", biome: "desert" })).toBe("city|red|desert|0");
    expect(spriteKeyString({ kind: "coin" })).toBe("coin|-|-|0");
  });

  it("paints every kind in every colour and biome without throwing", () => {
    const atlas = createAtlas();
    for (const kind of ALL_KINDS) {
      for (const biome of ["grass", "desert", "snow"] as const) {
        for (const colour of PLAYER_COLOURS) {
          const e = atlas.get({ kind, colour, biome, frame: 1 });
          expect(e).not.toBeNull();
          expect(e!.w).toBe(32);
          expect(e!.h).toBe(40);
          expect(e!.oy).toBe(8);
        }
      }
    }
    for (const c of contexts) expect(c.calls.length).toBeGreaterThan(0);
  });

  it("every painter only ever fills with palette colours or the outline", () => {
    const atlas = createAtlas();
    atlas.get({ kind: "knight4", colour: "purple" });
    const used = new Set<string>();
    const ctx = contexts[0]!.ctx;
    const orig = ctx.fillRect.getMockImplementation();
    ctx.fillRect.mockImplementation(() => {
      used.add(String(ctx.fillStyle));
      return orig ? orig() : 0;
    });
    atlas.clear();
    atlas.get({ kind: "knight4", colour: "purple" });
    for (const c of used) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("returns null (and caches it) when no 2D context is available", () => {
    getContext.mockImplementation(() => null);
    const atlas = createAtlas();
    expect(atlas.get({ kind: "coin" })).toBeNull();
    expect(atlas.get({ kind: "coin" })).toBeNull();
    expect(getContext).toHaveBeenCalledTimes(1);
  });
});
