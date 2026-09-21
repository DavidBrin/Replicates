import type { CSSProperties } from "react";

/**
 * White fill with a `#1A1010` outline via a four-direction `text-shadow`
 * stack (SPEC §8 "Type"). Shared by every local pixel-UI primitive in this
 * directory so headings/labels/buttons read consistently until S3 publishes
 * `src/components/ui/*` (this file has no dependency on that landing).
 */
export const PIXEL_TEXT_OUTLINE =
  "-2px -2px 0 #1A1010, 2px -2px 0 #1A1010, -2px 2px 0 #1A1010, 2px 2px 0 #1A1010";

export const pixelTextStyle: CSSProperties = {
  color: "#FFFFFF",
  textShadow: PIXEL_TEXT_OUTLINE,
};
