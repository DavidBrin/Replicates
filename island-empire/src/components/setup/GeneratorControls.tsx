"use client";

import type { Biome, MapSize } from "@/engine/types";
import { MAP_SIZE_DIMENSIONS } from "@/engine/types";

import { pixelTextStyle } from "./pixelText";
import { randomSeed } from "./sessionConfigBuilder";

export interface GeneratorControlsProps {
  size: MapSize;
  onSizeChange: (size: MapSize) => void;
  biome: Biome;
  onBiomeChange: (biome: Biome) => void;
  seed: number;
  onSeedChange: (seed: number) => void;
}

const SIZES: MapSize[] = ["small", "medium", "large"];
const BIOMES: Biome[] = ["grass", "desert", "snow"];

function optionButtonStyle(active: boolean) {
  return { backgroundColor: active ? "#228F00" : "#4D525E", borderColor: "#1A1010" };
}

/**
 * Size / biome / seed controls shared by `/random` and `/hotseat` (SPEC §7:
 * "size (S/M/L)... seed" on both screens).
 */
export function GeneratorControls({
  size,
  onSizeChange,
  biome,
  onBiomeChange,
  seed,
  onSeedChange,
}: GeneratorControlsProps) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1 text-xs font-bold uppercase" style={pixelTextStyle}>
          Map size
        </p>
        <div className="flex gap-2">
          {SIZES.map((option) => {
            const dims = MAP_SIZE_DIMENSIONS[option];
            return (
              <button
                key={option}
                type="button"
                data-testid={`size-${option}`}
                aria-pressed={size === option}
                onClick={() => onSizeChange(option)}
                className="min-h-11 flex-1 rounded border-2 px-2 py-2 text-xs font-bold uppercase text-white"
                style={optionButtonStyle(size === option)}
              >
                {option}
                <br />
                {dims.width}×{dims.height}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-bold uppercase" style={pixelTextStyle}>
          Biome
        </p>
        <div className="flex gap-2">
          {BIOMES.map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`biome-${option}`}
              aria-pressed={biome === option}
              onClick={() => onBiomeChange(option)}
              className="min-h-11 flex-1 rounded border-2 px-2 py-2 text-xs font-bold uppercase text-white"
              style={optionButtonStyle(biome === option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-bold uppercase" style={pixelTextStyle}>
          Seed
        </p>
        <div className="flex gap-2">
          <input
            data-testid="seed-input"
            aria-label="Map seed"
            type="number"
            value={seed}
            onChange={(event) => onSeedChange(Number(event.target.value) || 0)}
            className="min-h-11 flex-1 rounded border-2 border-[#1A1010] bg-white px-2 text-[#1A1010]"
          />
          <button
            type="button"
            data-testid="seed-randomize"
            aria-label="Randomise seed"
            onClick={() => onSeedChange(randomSeed())}
            className="min-h-11 min-w-11 rounded border-2 border-[#1A1010] bg-[#F6D83C] text-lg"
          >
            🎲
          </button>
        </div>
      </div>
    </div>
  );
}

export default GeneratorControls;
