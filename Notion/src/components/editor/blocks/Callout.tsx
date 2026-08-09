"use client";

import { useRef, useState } from "react";

import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { blockBackground, textColor } from "@/lib/utils/colors";
import { Editable } from "../Editable";
import { EmojiPicker } from "../EmojiPicker";
import type { BlockComponentProps } from "./shared";

export function Callout({ block }: BlockComponentProps) {
  const patchBlock = useWorkspaceStore((state) => state.patchBlock);
  const emojiRef = useRef<HTMLButtonElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div
      className="flex items-start gap-3"
      style={{
        marginTop: 4,
        borderRadius: 4,
        padding: 16,
        background: blockBackground(block.color),
        color: textColor(block.color),
        fontSize: "var(--editor-text, 16px)",
        lineHeight: 1.5,
      }}
    >
      <button
        ref={emojiRef}
        type="button"
        contentEditable={false}
        aria-label="Change icon"
        onClick={() => setPickerOpen((open) => !open)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-[18px] leading-none transition-colors duration-100 hover:bg-[var(--bac-overlay)]"
      >
        {block.emoji ?? "💡"}
      </button>
      <Editable blockId={block.id} className="flex-1" />
      <EmojiPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        anchor={emojiRef}
        onSelect={(emoji) => patchBlock(block.id, { emoji })}
      />
    </div>
  );
}
