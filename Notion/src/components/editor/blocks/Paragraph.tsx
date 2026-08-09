"use client";

import { textColor } from "@/lib/utils/colors";
import { Editable } from "../Editable";
import { BLOCK_ROW_STYLE, type BlockComponentProps } from "./shared";

export function Paragraph({ block }: BlockComponentProps) {
  return (
    <div style={{ ...BLOCK_ROW_STYLE, color: textColor(block.color) }}>
      <Editable blockId={block.id} />
    </div>
  );
}
