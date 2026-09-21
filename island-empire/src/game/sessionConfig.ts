"use client";

import { create } from "zustand";

import type { Difficulty, MapDefinition } from "@/engine/types";

/**
 * How the current session was configured — the SECOND published contract
 * (SPEC §4, §12). Menu screens (S3), random/hot-seat setup (S5) and the
 * custom-map share page (S4) write it; the in-game screen (S2) reads it.
 * Live `GameState` never enters this store.
 */
export type MapSource =
  | { kind: "campaign"; levelId: string }
  | { kind: "custom"; mapId: string }
  | { kind: "generated"; map: MapDefinition; seed: number }
  | { kind: "challenge"; mapId: string; weekKey: string };

export interface SeatConfig {
  index: number;
  kind: "human" | "ai";
  aiDifficulty: Difficulty;
  /** Display name for hot-seat hand-off screens; defaults to the colour. */
  name?: string;
}

export interface SessionConfig {
  source: MapSource;
  /** One per seat present on the map, in seat order. */
  seats: SeatConfig[];
  /** Campaign / challenge difficulty; drives the AI gold multiplier and medals. */
  difficulty: Difficulty;
  /** RNG seed for AI decisions and generation; pick once per session. */
  seed: number;
}

interface SessionConfigState {
  config: SessionConfig | null;
  setConfig: (config: SessionConfig) => void;
  clear: () => void;
}

export const useSessionConfig = create<SessionConfigState>()((set) => ({
  config: null,
  setConfig: (config) => set({ config }),
  clear: () => set({ config: null }),
}));
