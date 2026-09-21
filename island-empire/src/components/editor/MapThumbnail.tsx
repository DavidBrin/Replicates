"use client";

import { useEffect, useRef } from "react";

import type { MapDefinition } from "@/engine/types";

import { BUILDING_GLYPH, PLAYER_HEX, TERRAIN_FILL, UI } from "./palette";

/**
 * A small canvas picture of a map: one coloured square per tile, an owner
 * tint, a dot for a building and a dark dot for a unit. Used by the weekly
 * challenge cards and the share page; the editor grid is the larger
 * interactive sibling (`EditorCanvas`).
 */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  map: Pick<MapDefinition, "width" | "height" | "tiles" | "players">,
  cell: number,
  options: { grid?: boolean; glyphs?: boolean } = {},
): void {
  const { width, height, tiles, players } = map;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width * cell, height * cell);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = tiles[y * width + x];
      if (!tile) continue;
      const px = x * cell;
      const py = y * cell;
      ctx.fillStyle = TERRAIN_FILL[tile.terrain];
      ctx.fillRect(px, py, cell, cell);

      if (tile.road) {
        ctx.fillStyle = UI.road;
        ctx.fillRect(px + cell * 0.3, py, cell * 0.4, cell);
      }
      if (tile.decoration) {
        ctx.fillStyle = tile.decoration === "flowerWhite" ? "#FFFFFF" : tile.decoration === "flowerPurple" ? "#8E44AD" : tile.decoration === "rock" ? "#838A9C" : "#1F5847";
        const d = Math.max(1, Math.floor(cell * 0.2));
        ctx.fillRect(px + cell - d - 1, py + 1, d, d);
      }
      if (tile.owner !== null) {
        const colour = players[tile.owner]?.colour;
        if (colour) {
          ctx.strokeStyle = PLAYER_HEX[colour];
          ctx.lineWidth = Math.max(1, Math.floor(cell / 8));
          const inset = ctx.lineWidth / 2 + 0.5;
          ctx.strokeRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
        }
      }
      if (tile.building) {
        const ownerColour = tile.owner !== null ? players[tile.owner]?.colour : undefined;
        ctx.fillStyle =
          tile.building === "city" && ownerColour ? PLAYER_HEX[ownerColour] : tile.building === "chest" || tile.building === "mine" ? UI.gold : UI.cream;
        const s = Math.max(2, Math.floor(cell * 0.5));
        const o = Math.floor((cell - s) / 2);
        ctx.fillRect(px + o, py + o, s, s);
        ctx.strokeStyle = UI.outline;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + o + 0.5, py + o + 0.5, s - 1, s - 1);
        if (options.glyphs && cell >= 16) {
          ctx.fillStyle = UI.outline;
          ctx.font = `bold ${Math.floor(cell * 0.45)}px var(--font-pixel, monospace)`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(BUILDING_GLYPH[tile.building], px + cell / 2, py + cell / 2 + 1);
        }
      }
      if (tile.unit) {
        const s = Math.max(2, Math.floor(cell * 0.4));
        const o = Math.floor((cell - s) / 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(px + cell / 2, py + cell / 2, s / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = UI.outline;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (options.glyphs && cell >= 16) {
          ctx.fillStyle = UI.outline;
          ctx.font = `bold ${Math.floor(cell * 0.4)}px var(--font-pixel, monospace)`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(tile.unit.level), px + cell / 2, py + cell / 2 + 1);
        }
        void o;
      }
      if (options.grid) {
        ctx.strokeStyle = "rgba(26,16,16,0.25)";
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
      }
    }
  }
}

export function MapThumbnail({
  map,
  size = 120,
  className,
  testId,
}: {
  map: Pick<MapDefinition, "width" | "height" | "tiles" | "players">;
  /** The longest side, in CSS pixels. */
  size?: number;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cell = Math.max(1, Math.floor(size / Math.max(map.width, map.height)));
  const w = cell * map.width;
  const h = cell * map.height;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawMap(ctx, map, cell);
  }, [map, cell]);

  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      className={className}
      data-testid={testId}
      aria-label={`Map preview, ${map.width} by ${map.height}`}
      style={{ width: w, height: h, imageRendering: "pixelated" }}
    />
  );
}
