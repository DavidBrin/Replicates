"use client";

import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { textColor } from "@/lib/utils/colors";
import { Editable } from "../Editable";
import { BLOCK_ROW_STYLE, MARKER_WIDTH, type BlockComponentProps } from "./shared";

export function NumberedListItem({ block }: BlockComponentProps) {
  /**
   * The ordinal is derived, never stored: a numbered item only knows it is
   * numbered. Counting back over *consecutive* numbered siblings is what makes
   * a list restart at 1 after a paragraph interrupts it, exactly as Notion
   * does, and keeps the numbering correct after any insert, delete or drag.
   */
  const ordinal = useWorkspaceStore((state) => {
    const siblings =
      state.pages[block.parentId]?.blockIds ??
      state.blocks[block.parentId]?.childIds ??
      [];
    const index = siblings.indexOf(block.id);
    let count = 1;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (state.blocks[siblings[i]]?.type !== "numbered_list_item") break;
      count += 1;
    }
    return count;
  });

  return (
    <div style={BLOCK_ROW_STYLE} className="flex items-start">
      <div
        contentEditable={false}
        aria-hidden
        className="shrink-0 select-none tabular-nums"
        style={{ width: MARKER_WIDTH, color: textColor(block.color), lineHeight: 1.5 }}
      >
        {ordinal}.
      </div>
      <Editable blockId={block.id} style={{ color: textColor(block.color) }} />
    </div>
  );
}
