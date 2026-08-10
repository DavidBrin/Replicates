import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";
import type { RoomAuthorInfo, RoomEntry } from "./group-messages";

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export interface MessageGroupProps {
  entries: RoomEntry[];
  author: RoomAuthorInfo | undefined;
  isOwn: boolean;
  className?: string;
}

/**
 * One author-grouped run of consecutive text messages (SPEC §5.4: "messages
 * grouped by author with time separators") — one avatar/name/time header,
 * stacked message bubbles below it. `isOwn` mirrors the sketch's implicit
 * "your own messages read differently" convention (right-aligned, accent
 * tint) without hiding the sender's name (still useful once other people's
 * messages interleave).
 */
export function MessageGroup({ entries, author, isOwn, className }: MessageGroupProps) {
  const first = entries[0];
  if (!first) return null;
  const displayName = author?.displayName ?? "Unknown trader";
  const initials = author?.avatarInitials ?? "?";
  const color = author?.avatarColor ?? "var(--text-3)";

  return (
    <div className={cn("flex gap-2.5", isOwn && "flex-row-reverse", className)}>
      <Avatar initials={initials} color={color} size="sm" className="mt-0.5 shrink-0" />
      <div className={cn("flex min-w-0 flex-col gap-1", isOwn && "items-end")}>
        <div className={cn("flex items-baseline gap-2 text-xs", isOwn && "flex-row-reverse")}>
          <span className="font-medium text-(--text-1)">{displayName}</span>
          <span className="tnum text-(--text-3)">{timeFormat.format(new Date(first.at))}</span>
        </div>
        {entries.map((m) => (
          <p
            key={m.id}
            className={cn(
              "max-w-[85%] rounded-(--radius-input) px-3 py-1.5 text-sm whitespace-pre-wrap break-words",
              isOwn ? "bg-(--accent)/20 text-(--text-1)" : "bg-(--surface-3) text-(--text-1)",
              m.pending && "opacity-60",
            )}
          >
            {m.body}
          </p>
        ))}
      </div>
    </div>
  );
}
