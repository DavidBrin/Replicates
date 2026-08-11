"use client";

/**
 * Turn any image a browser can open into a tile of exactly the purchased size.
 *
 * This is the component that makes "the tile is the size you paid for" true by
 * construction (DECISIONS D14). The canvas is created at `rectPixelSize(rect)`
 * and never at the source image's size, so the PNG that comes back out of
 * `toDataURL` carries those dimensions in its IHDR whatever was fed in. The
 * server re-measures the header rather than trusting us, and agrees, because
 * there is no arithmetic here that could disagree — the destination rectangle
 * is the canvas.
 *
 * Re-rendering on every selection change is the other half of it: enlarge the
 * selection after picking an image and the tile is redrawn to the new size
 * rather than going stale and being rejected at checkout.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { rectPixelSize, type BlockRect } from "@/domain/geometry";
import { artErrorMessage, validateTile } from "@/domain/art";
import { Button, Callout } from "@/components/ui";
import { cn } from "@/lib/cn";

/** How a source image that is not the tile's aspect ratio is made to fit. */
export type TileFit = "cover" | "stretch";

export interface DecodedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

export interface TileUploaderProps {
  readonly rect: BlockRect;
  readonly value: string | null;
  readonly onChange: (tile: string | null) => void;
  /**
   * Decoding seam. The default loads the file through an `<img>`; jsdom never
   * loads one, so tests supply their own rather than the component growing a
   * branch for a test environment.
   */
  readonly decode?: (file: File) => Promise<DecodedImage>;
  readonly className?: string;
}

/**
 * The centred crop of a source image with the destination's aspect ratio.
 *
 * Cover fills the tile and loses the overhanging edge; the alternative is
 * letterboxing, which would leave transparent bands inside blocks somebody
 * paid for.
 */
export function coverSource(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (!(sw > 0) || !(sh > 0) || !(dw > 0) || !(dh > 0)) {
    return { sx: 0, sy: 0, sw, sh };
  }
  const target = dw / dh;
  let cw = sw;
  let ch = sh;
  if (sw / sh > target) cw = sh * target;
  else ch = sw / target;
  return { sx: (sw - cw) / 2, sy: (sh - ch) / 2, sw: cw, sh: ch };
}

/** Draw the image into a canvas that *is* the purchase, and export it as PNG. */
export function drawTile(image: DecodedImage, rect: BlockRect, fit: TileFit): string {
  const { width, height } = rectPixelSize(rect);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser will not give us a canvas to draw on.");

  // Smoothing on, because this is a downscale of a photograph to something the
  // size of a postage stamp. The *grid* renderer draws the finished tile 1:1
  // with smoothing off, which is where sharpness actually matters.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const src =
    fit === "cover"
      ? coverSource(image.width, image.height, width, height)
      : { sx: 0, sy: 0, sw: image.width, sh: image.height };

  ctx.drawImage(image.source, src.sx, src.sy, src.sw, src.sh, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/** Load a file through an `<img>`, which is the widest decoder available. */
function decodeWithImageElement(file: File): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth === 0 || image.naturalHeight === 0) {
        reject(new Error("empty image"));
        return;
      }
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("undecodable image"));
    };
    image.src = url;
  });
}

const UNREADABLE =
  "That file could not be read as an image. Try a PNG, JPEG, GIF or WebP.";

export function TileUploader({
  rect,
  value,
  onChange,
  decode = decodeWithImageElement,
  className,
}: TileUploaderProps) {
  const inputId = useId();
  const [fit, setFit] = useState<TileFit>("cover");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { width, height } = rectPixelSize(rect);

  // The decoded image outlives the file input: changing the fit or resizing the
  // selection redraws from it rather than asking the user to pick again.
  const imageRef = useRef<DecodedImage | null>(null);
  // Latest-props ref, so the redraw effect below can depend on the tile's *size*
  // alone. Depending on `rect` or `onChange` directly would re-run it on every
  // parent render, and since it calls `onChange`, that is a loop. Written from
  // an effect declared above the redraw one, so it is current by the time the
  // redraw runs.
  const latest = useRef({ onChange, rect });
  useEffect(() => {
    latest.current = { onChange, rect };
  });

  const render = useCallback((image: DecodedImage, nextFit: TileFit) => {
    const target = latest.current.rect;
    let tile: string;
    try {
      tile = drawTile(image, target, nextFit);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : UNREADABLE);
      latest.current.onChange(null);
      return;
    }

    // Belt and braces: the canvas was sized from the same rect the server will
    // check against, so this cannot fail — but the check is cheap and a silent
    // mismatch here would be a 422 at checkout with no explanation.
    const invalid = validateTile(tile, target);
    if (invalid) {
      setError(artErrorMessage(invalid, rectPixelSize(target)));
      latest.current.onChange(null);
      return;
    }

    setError(null);
    latest.current.onChange(tile);
  }, []);

  // Redraw when the purchase changes shape. Without this, growing the selection
  // after choosing an image leaves a tile the server will reject for being the
  // size of the *old* selection.
  useEffect(() => {
    const image = imageRef.current;
    if (image) render(image, fit);
  }, [width, height, fit, render]);

  async function onPick(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    setFileName(file.name);
    try {
      const image = await decode(file);
      imageRef.current = image;
      render(image, fit);
    } catch {
      imageRef.current = null;
      setError(UNREADABLE);
      onChange(null);
    } finally {
      setBusy(false);
    }
  }

  function clear(): void {
    imageRef.current = null;
    setFileName(null);
    setError(null);
    onChange(null);
  }

  // A 30 x 30 tile is a smudge at 1:1. Magnify to something you can judge,
  // in whole steps so the preview lies about nothing but scale.
  const previewScale = Math.max(1, Math.min(8, Math.floor(160 / Math.max(width, height))));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={inputId} className="text-sm font-bold text-(--ink)">
        Tile image (optional)
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(event) => {
          void onPick(event.target.files?.[0]);
        }}
        className="w-full border border-(--rule) bg-(--panel-2) px-2 py-1.5 text-sm text-(--ink)"
      />
      <p className="text-xs text-(--ink-2)">
        Whatever you pick is redrawn at exactly {width} × {height} pixels — the size of
        this selection. Nothing is uploaded until you check out.
      </p>

      <fieldset className="flex flex-wrap items-center gap-3 border-0 p-0">
        <legend className="sr-only">How the image fits the selection</legend>
        {(["cover", "stretch"] as const).map((option) => (
          <label key={option} className="flex items-center gap-1.5 text-sm text-(--ink)">
            <input
              type="radio"
              name={`${inputId}-fit`}
              value={option}
              checked={fit === option}
              onChange={() => setFit(option)}
            />
            {option === "cover" ? "Crop to fill" : "Stretch to fit"}
          </label>
        ))}
      </fieldset>

      {value ? (
        <div className="flex flex-wrap items-start gap-3">
          {/* A data URL of a handful of pixels: next/image would optimise
              nothing and routes through a loader that cannot take one. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt={`Tile preview, ${width} by ${height} pixels, shown at ${previewScale} times size`}
            width={width * previewScale}
            height={height * previewScale}
            style={{ imageRendering: "pixelated" }}
            className="border border-(--rule) bg-(--panel-2)"
          />
          <div className="flex flex-col gap-1 text-xs text-(--ink-2)">
            <span>
              {fileName ?? "Image"} — {width} × {height} px, shown at {previewScale}×
            </span>
            <Button variant="secondary" size="sm" onClick={clear}>
              Remove image
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-(--ink-3)">
          No image: the blocks are filled with the colour you picked.
        </p>
      )}

      {error ? <Callout tone="danger">{error}</Callout> : null}
    </div>
  );
}
