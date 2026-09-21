import type { CSSProperties } from "react";

import { OUTLINE, WHITE } from "@/render/palette";

/** White pixel text with the four-direction `#1A1010` outline (SPEC §8 Type). */
export const pixelText: CSSProperties = {
  color: WHITE,
  fontFamily: "var(--font-pixel), monospace",
  fontWeight: 700,
  textTransform: "uppercase",
  textShadow: `-2px -2px 0 ${OUTLINE}, 2px -2px 0 ${OUTLINE}, -2px 2px 0 ${OUTLINE}, 2px 2px 0 ${OUTLINE}`,
  letterSpacing: "0.02em",
  lineHeight: 1.1,
};

/** Smaller text: a 1 px outline reads better under ~14 px. */
export const pixelTextSmall: CSSProperties = {
  ...pixelText,
  textShadow: `-1px -1px 0 ${OUTLINE}, 1px -1px 0 ${OUTLINE}, -1px 1px 0 ${OUTLINE}, 1px 1px 0 ${OUTLINE}`,
};

/** Dark text on a light panel (speech bubbles, info card stats). */
export const pixelInk: CSSProperties = {
  color: OUTLINE,
  fontFamily: "var(--font-pixel), monospace",
  fontWeight: 700,
  textTransform: "uppercase",
  lineHeight: 1.15,
};

export const HUD_HEIGHT = 96;
/** Every HUD control is at least this tall/wide (SPEC §7). */
export const TOUCH_MIN = 44;

export const panelBorder: CSSProperties = {
  border: `3px solid ${OUTLINE}`,
  borderRadius: 8,
  boxShadow: `0 3px 0 ${OUTLINE}`,
};
