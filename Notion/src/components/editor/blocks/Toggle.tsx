"use client";

import { ChevronRight } from "lucide-react";

import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { cn } from "@/lib/utils/cn";
import { textColor } from "@/lib/utils/colors";
import { Editable } from "../Editable";
import { BLOCK_ROW_STYLE, MARKER_WIDTH, type BlockComponentProps } from "./shared";

export function Toggle({ block }: BlockComponentProps) {
  const toggleBlockExpanded = useWorkspaceStore((state) => state.toggleBlockExpanded);
  // A toggle created before `expanded` existed reads as open, which is the
  // safer default: content is never silently hidden.
  const expanded = block.expanded ?? true;

  return (
    <div style={BLOCK_ROW_STYLE} className="flex items-start">
      <div
        contentEditable={false}
        className="flex shrink-0 justify-center"
        style={{ width: MARKER_WIDTH }}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={() => toggleBlockExpanded(block.id)}
          className="flex h-[22px] w-[18px] items-center justify-center rounded-[3px] transition-colors duration-100 outline-hidden hover:bg-[var(--bac-int)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          style={{ color: "var(--ico-pri)" }}
        >
          <ChevronRight
            size={14}
            strokeWidth={2.5}
            className={cn("transition-transform duration-150", expanded && "rotate-90")}
          />
        </button>
      </div>
      <Editable blockId={block.id} style={{ color: textColor(block.color) }} />
    </div>
  );
}
