"use client";

import { useEffect, useRef } from "react";

import type { MapDefinition, Terrain } from "@/engine/types";

import { COLOUR_HEX } from "./colours";

/** One fill colour per `Terrain` (SPEC §8 palette). */
const TERRAIN_FILL: Record<Terrain, string> = {
  grass: "#8DAD3A",
  sand: "#C39A5C",
  snow: "#C2C2C2",
  water: "#2898F0",
  bridge: "#A28444",
  grassField: "#99D333",
  grave: "#AFB9D2",
  forestPine: "#209058",
  forestPalm: "#209058",
  forestIcePine: "#9FD3E8",
  mountain: "#A86061",
};

export interface MapThumbnailProps {
  map: MapDefinition | null;
  /** Rendered CSS size in px (square); default 160. */
  size?: number;
  className?: string;
}

/**
 * Pure canvas drawing of a `MapDefinition`: one native pixel per tile —
 * water blue, land by biome/terrain, mountains, forests, an owner tint, and
 * a dark city marker — blitted `pixelated` up to `size`px. Draws nothing
 * (a translucent placeholder) when `map` is `null`, which is how the setup
 * screens represent "generator not ready yet" / still debouncing.
 */
export function MapThumbnail({ map, size = 160, className }: MapThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = map?.width ?? 1;
    const height = map?.height ?? 1;
    canvas.width = width;
    canvas.height = height;

    if (!map) {
      ctx.fillStyle = "#00000022";
      ctx.fillRect(0, 0, width, height);
      return;
    }

    ctx.clearRect(0, 0, width, height);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y * map.width + x];
        if (!tile) continue;

        ctx.fillStyle = TERRAIN_FILL[tile.terrain] ?? TERRAIN_FILL.grass;
        ctx.fillRect(x, y, 1, 1);

        if (tile.owner !== null) {
          const player = map.players[tile.owner];
          const hex = player ? COLOUR_HEX[player.colour] : null;
          if (hex) {
            ctx.fillStyle = `${hex}90`;
            ctx.fillRect(x, y, 1, 1);
          }
        }

        if (tile.building === "city") {
          ctx.fillStyle = "#1A1010";
          ctx.fillRect(x + 0.25, y + 0.25, 0.5, 0.5);
        }
      }
    }
  }, [map]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="map-thumbnail"
      role="img"
      aria-label={map ? `Preview of ${map.width}×${map.height} generated map` : "Map preview unavailable"}
      className={className}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}

export default MapThumbnail;
