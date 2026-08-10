/**
 * Turns a picked image file into a small data URL.
 *
 * Why downscale at all: settings live in `localStorage`, which is a ~5MB
 * per-origin budget for the *whole* app, and a photo straight off a modern
 * phone camera is 3–8MB before base64 inflates it by a third. Storing one
 * un-resized picture therefore either blows the quota outright or leaves no
 * room for the live-mode avatar. `LocalSettingsStore.save` already swallows a
 * quota error and keeps going in memory, so nothing crashes — but the user's
 * carefully-chosen photo silently fails to survive a reload, which is exactly
 * the kind of quiet breakage this app cannot afford. Better to never get close
 * to the limit.
 *
 * 512px is the ceiling because the largest place a photo is ever drawn is a
 * full-bleed iOS call background on a 3x phone at ~1170px wide — where a 512px
 * source, blurred behind a scrim and a name, is indistinguishable from the
 * original. JPEG at 0.82 lands a 512px photo at roughly 40–70KB.
 *
 * Lives in `components/ui` rather than `adapters/` deliberately: it is a
 * property of this one file input, not a platform capability the app depends
 * on, and nothing outside the picker should be able to reach for it.
 */

export const MAX_PHOTO_EDGE = 512;
const JPEG_QUALITY = 0.82;
/** Matches `--color-surface-1`; flattens PNG transparency to something calm. */
const MATTE = "#17171c";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read that file."));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That file is not an image we can read."));
    image.src = src;
  });
}

/**
 * Resolves to a JPEG data URL no larger than `maxEdge` on its longest side.
 *
 * Rejects rather than falling back to the original bytes: a fallback here would
 * be an unbounded string heading for `localStorage`, which is the failure this
 * function exists to prevent.
 */
export async function fileToDownscaledDataUrl(
  file: File,
  maxEdge: number = MAX_PHOTO_EDGE,
): Promise<string> {
  const original = await readAsDataUrl(file);
  const image = await loadImage(original);

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width === 0 || height === 0) throw new Error("That image has no size.");

  // Only ever shrink. Upscaling a small avatar would add bytes and no detail.
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not resize that image.");

  context.fillStyle = MATTE;
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const encoded = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (!encoded.startsWith("data:image/")) throw new Error("Could not resize that image.");
  return encoded;
}
