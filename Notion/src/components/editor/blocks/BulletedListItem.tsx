"use client";

import { textColor } from "@/lib/utils/colors";
import { Editable } from "../Editable";
import { BLOCK_ROW_STYLE, MARKER_WIDTH, type BlockComponentProps } from "./shared";

/** Notion cycles the bullet glyph by nesting depth so levels stay legible. */
const BULLETS = ["•", "◦", "▪"];

export function BulletedListItem({ block, depth }: BlockComponentProps) {
  return (
    <div style={BLOCK_ROW_STYLE} className="flex items-start">
      <div
        contentEditable={false}
        aria-hidden
        className="flex shrink-0 select-none justify-center"
        style={{ width: MARKER_WIDTH, color: textColor(block.color), lineHeight: 1.5 }}
      >
        {BULLETS[depth % BULLETS.length]}
      </div>
      <Editable blockId={block.id} style={{ color: textColor(block.color) }} />
    </div>
  );
}
