import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MapDefinition } from "@/engine/types";

import { MapThumbnail } from "./MapThumbnail";

function stubMap(): MapDefinition {
  return {
    id: null,
    name: "stub",
    author: "test",
    width: 3,
    height: 2,
    biome: "grass",
    tiles: [
      { terrain: "grass", owner: 0, building: "city", unit: { level: 1 }, decoration: null, road: false },
      { terrain: "water", owner: null, building: null, unit: null, decoration: null, road: false },
      { terrain: "mountain", owner: null, building: null, unit: null, decoration: null, road: false },
      { terrain: "forestPine", owner: null, building: null, unit: null, decoration: null, road: false },
      { terrain: "grassField", owner: 1, building: null, unit: null, decoration: null, road: false },
      {
        terrain: "grave",
        owner: null,
        building: null,
        unit: null,
        decoration: null,
        road: false,
        graveAge: 0,
      },
    ],
    players: [
      { index: 0, colour: "blue", kind: "human", startGold: 10 },
      { index: 1, colour: "red", kind: "ai", startGold: 10 },
    ],
    tutorial: [],
    difficulty: null,
  };
}

function mockCanvasContext() {
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  return ctx;
}

describe("MapThumbnail", () => {
  it("draws every tile without throwing when a map is given", () => {
    const ctx = mockCanvasContext();
    expect(() => render(<MapThumbnail map={stubMap()} />)).not.toThrow();
    // 6 tiles, two of which are owned (an extra owner-tint fillRect each) and
    // one carries a city marker: at least 6 base fills happened.
    expect(ctx.fillRect).toHaveBeenCalledTimes(6 + 2 + 1);
  });

  it("does not throw and draws a placeholder when map is null (generator not ready)", () => {
    const ctx = mockCanvasContext();
    expect(() => render(<MapThumbnail map={null} />)).not.toThrow();
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
  });

  it("does not throw when getContext returns null (canvas unsupported in this environment)", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(() => render(<MapThumbnail map={stubMap()} />)).not.toThrow();
  });
});
