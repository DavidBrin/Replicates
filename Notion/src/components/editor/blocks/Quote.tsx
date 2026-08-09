"use client";

import { textColor } from "@/lib/utils/colors";
import { Editable } from "../Editable";
import { BLOCK_ROW_STYLE, type BlockComponentProps } from "./shared";

export function Quote({ block }: BlockComponentProps) {
  return (
    <blockquote
      style={{
        ...BLOCK_ROW_STYLE,
        marginTop: 6,
        paddingLeft: 14,
        borderLeft: "3px solid var(--tex-pri)",
        color: textColor(block.color),
      }}
    >
      <Editable blockId={block.id} />
    </blockquote>
  );
}
