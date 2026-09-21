"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { generateRandomMap } from "@/engine";
import type { Biome, Difficulty, MapDefinition, MapSize, PlayerColour } from "@/engine/types";
import { PLAYER_COLOURS } from "@/engine/types";
import { useSessionConfig } from "@/game/sessionConfig";

import { GeneratorControls } from "@/components/setup/GeneratorControls";
import { MapThumbnail } from "@/components/setup/MapThumbnail";
import { PixelButton } from "@/components/setup/PixelButton";
import { SeatRow } from "@/components/setup/SeatRow";
import { WoodPanel } from "@/components/setup/WoodPanel";
import { pixelTextStyle } from "@/components/setup/pixelText";
import {
  buildSessionConfig,
  toGeneratorSeats,
  type SetupSeat,
} from "@/components/setup/sessionConfigBuilder";

const MIN_SEATS = 2;
const MAX_SEATS = 8;
const DEFAULT_SEATS = 4;
const GENERATOR_DEBOUNCE_MS = 250;

/** SPEC §7 `/random`: "seat 0 defaults human, others AI". */
function defaultSeats(count: number): SetupSeat[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: i === 0 ? "human" : "ai",
    aiDifficulty: "normal" as Difficulty,
  }));
}

interface PreviewState {
  map: MapDefinition | null;
  error: string | null;
}

/**
 * `/random` — SPEC §7: size (S/M/L), 2–8 seats each human/AI + difficulty,
 * a seed, a live preview, and "Play" builds a `SessionConfig` and navigates
 * to `/play/session` (S2). `generateRandomMap` is S1's; until
 * `src/engine/generator/` exists it throws, so every call here is wrapped
 * and a friendly "generator not ready" message is shown instead of a crash.
 */
export default function RandomMapSetupPage() {
  const router = useRouter();

  const [size, setSize] = useState<MapSize>("medium");
  const [biome, setBiome] = useState<Biome>("grass");
  const [seatCount, setSeatCount] = useState(DEFAULT_SEATS);
  const [seats, setSeats] = useState<SetupSeat[]>(() => defaultSeats(DEFAULT_SEATS));
  const [seed, setSeed] = useState(424242);

  const [preview, setPreview] = useState<PreviewState>({ map: null, error: null });

  const optionsKey = useMemo(() => JSON.stringify({ size, biome, seats }), [size, biome, seats]);

  useEffect(() => {
    const handle = setTimeout(() => {
      try {
        const map = generateRandomMap({ size, biome, seats: toGeneratorSeats(seats) }, seed);
        setPreview({ map, error: null });
      } catch (error) {
        setPreview({
          map: null,
          error: error instanceof Error ? error.message : "Generator not ready yet.",
        });
      }
    }, GENERATOR_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey, seed]);

  function updateSeatCount(next: number) {
    const clamped = Math.max(MIN_SEATS, Math.min(MAX_SEATS, next));
    setSeatCount(clamped);
    setSeats((prev) => {
      const kept = prev.slice(0, clamped);
      while (kept.length < clamped) {
        kept.push({ kind: "ai", aiDifficulty: "normal" });
      }
      return kept;
    });
  }

  function updateSeat(index: number, patch: Partial<SetupSeat>) {
    setSeats((prev) => prev.map((seat, i) => (i === index ? { ...seat, ...patch } : seat)));
  }

  function handlePlay() {
    // Always generate from the current options: the preview is debounced, so
    // right after a seat-count or seed change it can still describe the
    // previous configuration (a map with four players for a two-seat game).
    let map: MapDefinition | null = null;
    {
      try {
        map = generateRandomMap({ size, biome, seats: toGeneratorSeats(seats) }, seed);
      } catch (error) {
        setPreview({
          map: null,
          error: error instanceof Error ? error.message : "Generator not ready yet.",
        });
        return;
      }
    }

    const config = buildSessionConfig({ map, seed, seats });
    useSessionConfig.getState().setConfig(config);
    router.push("/play/session");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4 pb-10">
      <h1 className="text-center text-2xl font-bold uppercase" style={pixelTextStyle}>
        Random Map
      </h1>

      <WoodPanel>
        <GeneratorControls
          size={size}
          onSizeChange={setSize}
          biome={biome}
          onBiomeChange={setBiome}
          seed={seed}
          onSeedChange={setSeed}
        />
      </WoodPanel>

      <WoodPanel className="flex flex-col items-center gap-2">
        <MapThumbnail map={preview.map} size={180} />
        {preview.error ? (
          <p data-testid="generator-status" className="text-center text-xs" style={pixelTextStyle}>
            Generator not ready yet — map preview will appear once it lands.
          </p>
        ) : null}
      </WoodPanel>

      <WoodPanel className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase" style={pixelTextStyle}>
            Seats
          </span>
          <div className="flex items-center gap-2">
            <PixelButton
              type="button"
              variant="neutral"
              data-testid="seat-count-decrease"
              aria-label="Fewer seats"
              onClick={() => updateSeatCount(seatCount - 1)}
              disabled={seatCount <= MIN_SEATS}
            >
              −
            </PixelButton>
            <span data-testid="seat-count" className="w-6 text-center" style={pixelTextStyle}>
              {seatCount}
            </span>
            <PixelButton
              type="button"
              variant="neutral"
              data-testid="seat-count-increase"
              aria-label="More seats"
              onClick={() => updateSeatCount(seatCount + 1)}
              disabled={seatCount >= MAX_SEATS}
            >
              +
            </PixelButton>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {seats.map((seat, i) => (
            <SeatRow
              key={i}
              index={i}
              colour={PLAYER_COLOURS[i] as PlayerColour}
              kind={seat.kind}
              onKindChange={(kind) => updateSeat(i, { kind })}
              aiDifficulty={seat.aiDifficulty}
              onDifficultyChange={(aiDifficulty) => updateSeat(i, { aiDifficulty })}
            />
          ))}
        </div>
      </WoodPanel>

      <PixelButton
        type="button"
        variant="green"
        data-testid="play"
        onClick={handlePlay}
        className="text-lg"
      >
        Play
      </PixelButton>
    </main>
  );
}
