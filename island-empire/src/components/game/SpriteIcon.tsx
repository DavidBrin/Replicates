"use client";

import { useEffect, useRef } from "react";

import { NATIVE, SPRITE_H, atlas, type SpriteKey } from "@/render/sprites";

/**
 * A sprite from the atlas blitted into a small canvas — the HUD's portraits
 * and glyphs share the board's pixel art rather than duplicating it in CSS.
 */
export function SpriteIcon({
  sprite,
  size = 32,
  className,
  title,
}: {
  sprite: SpriteKey;
  /** Width of the tile area in CSS px; the canvas is taller for headroom. */
  size?: number;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const key = `${sprite.kind}|${sprite.colour ?? ""}|${sprite.biome ?? ""}|${sprite.frame ?? 0}`;
  const height = Math.round((size * SPRITE_H) / NATIVE);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, height);
    const entry = atlas.get(sprite);
    if (!entry) return;
    const s = size / NATIVE;
    ctx.drawImage(entry.canvas, 0, 0, entry.w * s, entry.h * s);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the stable identity of `sprite`
  }, [key, size, height]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={title ?? sprite.kind}
      className={className}
      style={{ width: size, height, imageRendering: "pixelated", display: "block" }}
    />
  );
}
