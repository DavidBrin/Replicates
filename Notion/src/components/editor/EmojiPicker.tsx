"use client";

/**
 * A deliberately small emoji grid.
 *
 * A full picker means shipping the whole Unicode emoji dataset plus a search
 * index; Notion's actual affordance is "pick a glyph quickly", and a curated
 * grid of the ones that appear on real pages covers that in a few kilobytes.
 */

import type { RefObject } from "react";

import { Popover } from "@/components/primitives/Popover";

const EMOJIS = [
  "💡", "📌", "⚠️", "✅", "❌", "🔥", "⭐", "🎯",
  "📝", "📄", "📊", "📈", "🗓️", "⏰", "🔔", "🔒",
  "🚀", "🛠️", "🧩", "🧠", "💬", "❓", "❗", "🏁",
  "🌱", "🌊", "🎨", "🎉", "☕", "🍀", "🐛", "👋",
];

export interface EmojiPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
  onSelect: (emoji: string) => void;
  /** Rendered as a "Remove" row when provided. */
  onRemove?: () => void;
}

export function EmojiPicker({
  open,
  onOpenChange,
  anchor,
  onSelect,
  onRemove,
}: EmojiPickerProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} anchor={anchor} width={296}>
      <div className="p-2">
        <div className="grid grid-cols-8 gap-1">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onSelect(emoji);
                onOpenChange(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-[4px] text-lg transition-colors duration-75 hover:bg-[var(--bac-int)]"
            >
              {emoji}
            </button>
          ))}
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={() => {
              onRemove();
              onOpenChange(false);
            }}
            className="mt-2 w-full rounded-[4px] px-2 py-1 text-left text-sm transition-colors duration-75 hover:bg-[var(--bac-int)]"
            style={{ color: "var(--tex-sec)" }}
          >
            Remove
          </button>
        ) : null}
      </div>
    </Popover>
  );
}
