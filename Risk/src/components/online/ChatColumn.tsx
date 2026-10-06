"use client";

import { useEffect } from "react";

import type { ChatLine, ChatSend } from "@/ports/sync";

import { EMOJI_GLYPHS } from "./emoji";
import { lineText, primeDialogRoster } from "./dialogText";

/**
 * A chat column for the lobby browser and the lobby room (SPEC §5.9, §7).
 *
 * **Preset-only.** The eight glyph ids are the whole send surface here: a
 * client posts an *index*, never a string, and there is no free-text input
 * anywhere in this component because there is no column in the database for
 * one to land in (D41). The in-game drawer with the full 42-line roster is
 * S4's (§7.3); this is the lobby's lighter cousin.
 */

export interface ChatColumnProps {
  readonly lines: readonly ChatLine[];
  readonly onSend: (line: ChatSend) => void;
  readonly title: string;
  readonly disabled?: boolean;
}

export default function ChatColumn({ lines, onSend, title, disabled }: ChatColumnProps) {
  useEffect(() => {
    void primeDialogRoster();
  }, []);

  return (
    <section
      data-testid="chat-column"
      className="flex min-h-0 flex-col rounded-xl border border-[color:var(--chrome-line)] bg-[color:var(--chrome-800)]"
    >
      <h2 className="border-b border-[color:var(--chrome-line)] px-4 py-3 font-head text-sm font-bold tracking-wide uppercase text-[color:var(--text-muted)]">
        {title}
      </h2>

      <ol
        data-testid="chat-log"
        className="min-h-24 flex-1 space-y-1 overflow-y-auto px-4 py-3 text-sm"
      >
        {lines.length === 0 ? (
          <li className="text-[color:var(--text-dim)]">No messages yet.</li>
        ) : (
          lines.map((line) => (
            <li key={line.id} data-testid="chat-line" className="text-[color:var(--text)]">
              <span className="font-semibold text-[color:var(--text-muted)]">
                {line.displayName}
              </span>{" "}
              {line.emoji === null ? (
                <span>{lineText(line.lineId ?? 0)}</span>
              ) : (
                <span aria-label={line.emoji} className="text-base">
                  {EMOJI_GLYPHS[line.emoji] ?? line.emoji}
                </span>
              )}
            </li>
          ))
        )}
      </ol>

      <div
        data-testid="chat-emoji-row"
        className="grid grid-cols-4 gap-1 border-t border-[color:var(--chrome-line)] p-2"
      >
        {Object.entries(EMOJI_GLYPHS).map(([id, glyph]) => (
          <button
            key={id}
            type="button"
            data-testid={`chat-emoji-${id}`}
            disabled={disabled}
            onClick={() => onSend({ emoji: id })}
            aria-label={id}
            className="rounded-lg bg-[color:var(--chrome-700)] py-2 text-lg disabled:opacity-40"
          >
            {glyph}
          </button>
        ))}
      </div>
    </section>
  );
}
