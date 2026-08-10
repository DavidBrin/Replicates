import { cn } from "@/lib/cn";
import { buildRoomTimeline, type RoomAuthorInfo, type RoomEntry } from "./group-messages";
import { MessageGroup } from "./MessageGroup";
import { SystemChip } from "./SystemChip";

export interface MessageListProps {
  /** Ascending (oldest first, as displayed top-to-bottom). */
  messages: RoomEntry[];
  authors: Record<string, RoomAuthorInfo>;
  currentUserId: string;
  now: Date;
  className?: string;
}

/** Renders `buildRoomTimeline`'s output: day separators, system chips, and
 * author-grouped message bubbles, in order. Pure presentational component —
 * all the grouping logic lives in `group-messages.ts`. */
export function MessageList({ messages, authors, currentUserId, now, className }: MessageListProps) {
  const items = buildRoomTimeline(messages, now);

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {items.map((item) => {
        if (item.type === "separator") {
          return (
            <div key={item.key} className="flex items-center gap-3 py-1 text-xs text-(--text-3)">
              <span aria-hidden="true" className="h-px flex-1 bg-(--border)" />
              {item.label}
              <span aria-hidden="true" className="h-px flex-1 bg-(--border)" />
            </div>
          );
        }
        if (item.type === "system") {
          return <SystemChip key={item.key} entry={item.entry} />;
        }
        return (
          <MessageGroup
            key={item.key}
            entries={item.entries}
            author={authors[item.authorId]}
            isOwn={item.authorId === currentUserId}
          />
        );
      })}
    </div>
  );
}
