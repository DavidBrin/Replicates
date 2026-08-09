"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { dotColor, tagStyle } from "@/lib/utils/colors";
import type { NotionColor } from "@/lib/model/types";

export interface PillProps {
  children: ReactNode;
  color?: NotionColor;
  /** Status pills carry a leading dot; select pills do not. */
  dot?: boolean;
  size?: "sm" | "md";
  className?: string;
  onRemove?: () => void;
}

/** Notion's tag chip — used for select, multi-select and status values. */
export function Pill({
  children,
  color = "default",
  dot = false,
  size = "md",
  className,
  onRemove,
}: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-[3px] font-normal",
        size === "sm" ? "h-[18px] px-1.5 text-[11px]" : "h-5 px-2 text-xs",
        className,
      )}
      style={tagStyle(color)}
    >
      {dot ? (
        <span
          className="h-[6px] w-[6px] shrink-0 rounded-full"
          style={{ background: dotColor(color) }}
        />
      ) : null}
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label="Remove"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 shrink-0 opacity-50 transition-opacity hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
