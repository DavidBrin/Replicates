import { describe, expect, it } from "vitest";

import type { MapDefinition } from "@/engine/types";

import {
  buildSessionConfig,
  highestAiDifficulty,
  randomSeed,
  toGeneratorSeats,
  toSeatConfigs,
} from "./sessionConfigBuilder";

const STUB_MAP: MapDefinition = {
  id: null,
  name: "stub",
  author: "test",
  width: 2,
  height: 2,
  biome: "grass",
  tiles: [],
  players: [],
  tutorial: [],
  difficulty: null,
};

describe("highestAiDifficulty", () => {
  it("returns normal when no seat is AI", () => {
    expect(highestAiDifficulty([{ kind: "human", aiDifficulty: "normal" }])).toBe("normal");
    expect(highestAiDifficulty([])).toBe("normal");
  });

  it("returns the hardest AI difficulty chosen, ignoring human seats", () => {
    expect(
      highestAiDifficulty([
        { kind: "ai", aiDifficulty: "easy" },
        { kind: "human", aiDifficulty: "hard" },
        { kind: "ai", aiDifficulty: "hard" },
      ]),
    ).toBe("hard");
  });

  it("picks easy when every AI seat is easy", () => {
    expect(
      highestAiDifficulty([
        { kind: "ai", aiDifficulty: "easy" },
        { kind: "ai", aiDifficulty: "easy" },
      ]),
    ).toBe("easy");
  });
});

describe("toGeneratorSeats", () => {
  it("drops aiDifficulty for human seats and keeps it for AI seats", () => {
    expect(
      toGeneratorSeats([
        { kind: "human", aiDifficulty: "normal" },
        { kind: "ai", aiDifficulty: "hard" },
      ]),
    ).toEqual([{ kind: "human" }, { kind: "ai", aiDifficulty: "hard" }]);
  });
});

describe("toSeatConfigs", () => {
  it("assigns seat index from array order and carries the name through", () => {
    expect(
      toSeatConfigs([
        { kind: "human", aiDifficulty: "normal", name: "Blue" },
        { kind: "ai", aiDifficulty: "easy" },
      ]),
    ).toEqual([
      { index: 0, kind: "human", aiDifficulty: "normal", name: "Blue" },
      { index: 1, kind: "ai", aiDifficulty: "easy", name: undefined },
    ]);
  });
});

describe("buildSessionConfig", () => {
  it("builds a generated-source SessionConfig using the highest AI difficulty", () => {
    const config = buildSessionConfig({
      map: STUB_MAP,
      seed: 42,
      seats: [
        { kind: "human", aiDifficulty: "normal" },
        { kind: "ai", aiDifficulty: "hard" },
        { kind: "ai", aiDifficulty: "easy" },
      ],
    });

    expect(config.source).toEqual({ kind: "generated", map: STUB_MAP, seed: 42 });
    expect(config.seed).toBe(42);
    expect(config.difficulty).toBe("hard");
    expect(config.seats).toHaveLength(3);
    expect(config.seats[0]).toMatchObject({ index: 0, kind: "human" });
    expect(config.seats[1]).toMatchObject({ index: 1, kind: "ai", aiDifficulty: "hard" });
  });

  it("defaults to normal difficulty for an all-human hot-seat config", () => {
    const config = buildSessionConfig({
      map: STUB_MAP,
      seed: 7,
      seats: [
        { kind: "human", aiDifficulty: "normal", name: "Alex" },
        { kind: "human", aiDifficulty: "normal", name: "Sam" },
      ],
    });

    expect(config.difficulty).toBe("normal");
    expect(config.seats.map((s) => s.name)).toEqual(["Alex", "Sam"]);
  });
});

describe("randomSeed", () => {
  it("returns an integer within [0, 1_000_000_000)", () => {
    const seed = randomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(1_000_000_000);
  });

  it("varies across calls", () => {
    const seeds = new Set(Array.from({ length: 5 }, () => randomSeed()));
    expect(seeds.size).toBeGreaterThan(1);
  });
});
