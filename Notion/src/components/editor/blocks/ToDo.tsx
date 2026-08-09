"use client";

import { Check } from "lucide-react";

import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { textColor } from "@/lib/utils/colors";
import { Editable } from "../Editable";
import { BLOCK_ROW_STYLE, MARKER_WIDTH, type BlockComponentProps } from "./shared";

export function ToDo({ block }: BlockComponentProps) {
  const toggleBlockChecked = useWorkspaceStore((state) => state.toggleBlockChecked);
  const checked = block.checked ?? false;

  return (
    <div style={BLOCK_ROW_STYLE} className="flex items-start">
      <div
        contentEditable={false}
        className="flex shrink-0 justify-center"
        style={{ width: MARKER_WIDTH, paddingTop: 3 }}
      >
        <span className="relative inline-flex h-4 w-4">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleBlockChecked(block.id)}
            aria-label={block.text || "To-do"}
            className="h-4 w-4 cursor-pointer appearance-none rounded-[3px] border transition-colors duration-100 outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            style={{
              borderColor: checked ? "var(--accent)" : "var(--bor-str)",
              background: checked ? "var(--accent)" : "transparent",
            }}
          />
          {checked ? (
            <Check
              size={12}
              strokeWidth={3}
              className="pointer-events-none absolute left-[2px] top-[2px]"
              // White on a saturated accent fill in both themes — the same
              // deliberate exception `avatarStyle` makes in lib/utils/colors.
              style={{ color: "#ffffff" }}
            />
          ) : null}
        </span>
      </div>
      <Editable
        blockId={block.id}
        style={{
          color: checked ? "var(--tex-ter)" : textColor(block.color),
          textDecoration: checked ? "line-through" : undefined,
        }}
      />
    </div>
  );
}
