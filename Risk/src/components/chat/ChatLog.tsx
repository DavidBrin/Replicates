"use client";

/**
 * The chat drawer's scrollable log (SPEC §7.3).
 *
 * A line renders as `displayName: text`. System notices are plain light text
 * in the same column — precedent: *"The host has deactivated alliances for
 * this game. No private chat allowed."*
 */

import clsx from "clsx";

import { dialogText, EMOJI } from "@/content/dialog";
import type { ChatLine } from "@/ports/sync";

import { EmojiGlyphIcon } from "./EmojiGrid";

export interface ChatLogProps {
  readonly lines: readonly ChatLine[];
  /** Host/system announcements, shown above the log in the same column. */
  readonly notices?: readonly string[];
  readonly className?: string;
}

function emojiLabel(id: string): string {
  return EMOJI.find((g) => g.id === id)?.label ?? id;
}

export function ChatLog({ lines, notices = [], className }: ChatLogProps) {
  return (
    <div
      data-testid="chat-log"
      role="log"
      aria-live="polite"
      aria-label="Chat log"
      className={clsx("chat-log", className)}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        overflowY: "auto",
        padding: "8px 12px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontFamily: "var(--font-body), system-ui, sans-serif",
        fontSize: 15,
      }}
    >
      {notices.map((notice, i) => (
        <p
          key={`notice-${i}`}
          data-testid="chat-notice"
          style={{ margin: 0, color: "var(--text-muted)" }}
        >
          {notice}
        </p>
      ))}
      {lines.map((line) => {
        const text = line.lineId !== null ? dialogText(line.lineId) : emojiLabel(line.emoji ?? "");
        return (
          <p
            key={line.id}
            data-testid={`chat-line-${line.id}`}
            style={{ margin: 0, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ fontWeight: 700 }}>{line.displayName}:</span>{" "}
            {line.emoji !== null ? <EmojiGlyphIcon id={line.emoji} size={18} /> : null}
            <span>{text}</span>
          </p>
        );
      })}
    </div>
  );
}

export default ChatLog;
