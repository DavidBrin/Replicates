import { cn } from "@/lib/cn";
import type { RoomEntry } from "./group-messages";

export interface SystemChipProps {
  entry: RoomEntry;
  className?: string;
}

/**
 * A system trade/resolution event, rendered as an inline centered chip —
 * deliberately NOT a chat bubble (SPEC §5.4: "system trade events rendered
 * as inline chips, not bubbles ... this is the detail that makes the chat
 * feel like a tape"). No author avatar, no alignment side — it belongs to
 * the room itself, not to any one participant.
 */
export function SystemChip({ entry, className }: SystemChipProps) {
  return (
    <div className={cn("flex justify-center py-0.5", className)}>
      <span className="inline-flex max-w-[90%] items-center gap-1.5 rounded-(--radius-pill) border border-(--border) bg-(--surface-3) px-3 py-1 text-center text-xs text-(--text-2)">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-(--accent)" />
        <span className="truncate">{entry.body}</span>
      </span>
    </div>
  );
}
