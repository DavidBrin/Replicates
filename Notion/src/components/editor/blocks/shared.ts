import type { CSSProperties } from "react";

import type { Block } from "@/lib/model/types";

export interface BlockComponentProps {
  block: Block;
  /** Nesting level, used for bullet glyph cycling. */
  depth: number;
}

/**
 * Notion's body row metrics: 16px text on a 1.5 line-height, 3px of vertical
 * padding and a 1px top margin, which is what gives a run of paragraphs their
 * characteristic tight-but-not-cramped rhythm.
 *
 * The font size reads a custom property so a "small text" page can shrink the
 * whole body from one place on the editor root.
 */
export const BLOCK_ROW_STYLE: CSSProperties = {
  fontSize: "var(--editor-text, 16px)",
  lineHeight: 1.5,
  padding: "3px 2px",
  marginTop: 1,
};

/** Width of the marker column in front of a list item, matching Notion. */
export const MARKER_WIDTH = 24;
