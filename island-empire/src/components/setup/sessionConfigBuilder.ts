import type { Difficulty, GeneratorOptions, MapDefinition, PlayerColour } from "@/engine/types";
import type { SeatConfig, SessionConfig } from "@/game/sessionConfig";

import { colourDisplayName } from "./colours";

/**
 * A seat as the random/hot-seat setup screens edit it, before it becomes a
 * `SeatConfig` (SPEC §4 `sessionConfig.ts`) or a `GeneratorOptions["seats"]`
 * entry (SPEC §4 `engine/types.ts`). Kept separate from both so the setup
 * screens can hold a `name` even for a seat the generator itself doesn't
 * care about.
 */
export interface SetupSeat {
  kind: "human" | "ai";
  aiDifficulty: Difficulty;
  name?: string;
}

const DIFFICULTY_RANK: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2 };

/**
 * SPEC §12 acceptance: "difficulty: the highest AI difficulty chosen".
 * Falls back to "normal" when no seat is AI (e.g. an all-human hot-seat game).
 */
export function highestAiDifficulty(seats: SetupSeat[]): Difficulty {
  let best: Difficulty = "normal";
  let bestRank = -1;
  for (const seat of seats) {
    if (seat.kind !== "ai") continue;
    const rank = DIFFICULTY_RANK[seat.aiDifficulty];
    if (rank > bestRank) {
      bestRank = rank;
      best = seat.aiDifficulty;
    }
  }
  return bestRank === -1 ? "normal" : best;
}

/** `GeneratorOptions["seats"]` never carries `aiDifficulty` for a human seat. */
export function toGeneratorSeats(seats: SetupSeat[]): GeneratorOptions["seats"] {
  return seats.map((seat) =>
    seat.kind === "ai"
      ? { kind: "ai" as const, aiDifficulty: seat.aiDifficulty }
      : { kind: "human" as const },
  );
}

/** Seat index is array order — SPEC §4: "seat order = colour order". */
export function toSeatConfigs(seats: SetupSeat[]): SeatConfig[] {
  return seats.map((seat, index) => ({
    index,
    kind: seat.kind,
    aiDifficulty: seat.aiDifficulty,
    name: seat.name,
  }));
}

export function buildSessionConfig(params: {
  map: MapDefinition;
  seed: number;
  seats: SetupSeat[];
}): SessionConfig {
  return {
    source: { kind: "generated", map: params.map, seed: params.seed },
    seats: toSeatConfigs(params.seats),
    difficulty: highestAiDifficulty(params.seats),
    seed: params.seed,
  };
}

/**
 * A fresh seed for the setup screens' "🎲" button. UI-only randomness (SPEC
 * §5 "the 🎲 button randomises... allowed here, this is UI") — never used
 * inside `src/engine/**`, which is seeded and deterministic throughout.
 */
export function randomSeed(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return (buffer[0] ?? 0) % 1_000_000_000;
  }
  return Math.floor(Date.now() % 1_000_000_000);
}

export function defaultSeatName(colour: PlayerColour): string {
  return colourDisplayName(colour);
}
