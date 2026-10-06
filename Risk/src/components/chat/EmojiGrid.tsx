"use client";

/**
 * The 3×3 emoji grid of SPEC §7.3 — eight code-drawn glyphs and a ninth `…`
 * slot that scrolls the dialog roster into view.
 *
 * Every glyph is inline SVG, never a system emoji character: the original's
 * sticker art is paid, and a platform emoji font would render differently on
 * every device.
 */

import clsx from "clsx";
import type { ReactElement } from "react";

import { EMOJI, EMOJI_MORE, type EmojiGlyph } from "@/content/dialog";
import type { ChatSend } from "@/ports/sync";

const GOLD = "var(--gold)";
const INK = "var(--text-on-paper)";

/** One code-drawn glyph, by id. Flat, chunky, two-tone — the §8 icon idiom. */
export function EmojiGlyphIcon({ id, size = 34 }: { readonly id: string; readonly size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  const face = (
    <circle cx="12" cy="12" r="9.2" fill={GOLD} stroke={INK} strokeWidth="1.2" />
  );
  const glyphs: Record<string, ReactElement> = {
    thumbsUp: (
      <svg {...common}>
        <path d="M7 10.5h2.6V20H7a1.4 1.4 0 0 1-1.4-1.4v-6.7A1.4 1.4 0 0 1 7 10.5Z" fill={INK} />
        <path
          d="M11 10.2 13.6 4a1.7 1.7 0 0 1 3.2 1l-.9 4h3.4a1.8 1.8 0 0 1 1.7 2.3l-1.6 6A2.3 2.3 0 0 1 17.2 19H11Z"
          fill={GOLD}
          stroke={INK}
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
    grin: (
      <svg {...common}>
        {face}
        <rect x="7.3" y="8.4" width="2.6" height="2.6" rx="1.3" fill={INK} />
        <rect x="14.1" y="8.4" width="2.6" height="2.6" rx="1.3" fill={INK} />
        <path d="M6.6 13.6h10.8a5.4 5.4 0 0 1-10.8 0Z" fill={INK} />
        <path d="M8.4 13.6h7.2v1.5H8.4Z" fill="#FFF" />
      </svg>
    ),
    gasp: (
      <svg {...common}>
        {face}
        <circle cx="8.6" cy="9.4" r="1.4" fill={INK} />
        <circle cx="15.4" cy="9.4" r="1.4" fill={INK} />
        <ellipse cx="12" cy="15.4" rx="2.7" ry="3.1" fill={INK} />
      </svg>
    ),
    fume: (
      <svg {...common}>
        {face}
        <path d="M6.6 8.2 10.4 10l-.7 1.7-3.8-1.8Z" fill={INK} />
        <path d="M17.4 8.2 13.6 10l.7 1.7 3.8-1.8Z" fill={INK} />
        <circle cx="9.3" cy="12.4" r="1.2" fill={INK} />
        <circle cx="14.7" cy="12.4" r="1.2" fill={INK} />
        <path d="M9 17.2h6" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M2.8 7.4c1.5-1.1 1.5-2.5 0-3.6M21.2 7.4c-1.5-1.1-1.5-2.5 0-3.6" stroke={INK}
          strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </svg>
    ),
    tear: (
      <svg {...common}>
        {face}
        <circle cx="8.6" cy="9.8" r="1.3" fill={INK} />
        <circle cx="15.4" cy="9.8" r="1.3" fill={INK} />
        <path d="M8.4 17.2a4.3 4.3 0 0 1 7.2 0" stroke={INK} strokeWidth="1.8" strokeLinecap="round"
          fill="none" />
        <path d="M7.3 12.1c1.9 2.5 1.9 3.9 0 5.2-1.9-1.3-1.9-2.7 0-5.2Z" fill="var(--cyan)"
          stroke={INK} strokeWidth="1" />
      </svg>
    ),
    handshake: (
      <svg {...common}>
        <path d="M2.4 11.1 7 7.4l4.2 2.4 1.9-1.5 4.2 2.1 3.3 3-3.1 3.4-2.3-1.7-1.4 1.5-2.2-1.4-1.6 1.6L7 15.4Z"
          fill={GOLD} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M11.2 9.8 9 11.6M13.1 8.3l-2 1.5" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    ),
    swords: (
      <svg {...common}>
        <path d="M4 3.4 7 3.2l11 12.1-2.6 2.4Z" fill="#C9D2D8" stroke={INK} strokeWidth="1.1"
          strokeLinejoin="round" />
        <path d="M20 3.4 17 3.2 6 15.3l2.6 2.4Z" fill="#C9D2D8" stroke={INK} strokeWidth="1.1"
          strokeLinejoin="round" />
        <path d="M5.2 17.1 8.1 20M18.8 17.1 15.9 20" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    ),
    flag: (
      <svg {...common}>
        <path d="M5.6 2.6v19" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
        <path d="M7 4.2h12l-2.6 4 2.6 4H7Z" fill="#FFFFFF" stroke={INK} strokeWidth="1.3"
          strokeLinejoin="round" />
      </svg>
    ),
  };
  return glyphs[id] ?? <svg {...common} />;
}

export interface EmojiGridProps {
  /** Fires `{ emoji: id }` — never free text (§7.3, R-chat). */
  readonly onSend: (send: ChatSend) => void;
  /** The ninth slot: scroll the dialog roster into view. */
  readonly onMore: () => void;
  readonly className?: string;
}

const TILE: React.CSSProperties = {
  width: 78,
  minHeight: 60,
  // 44 px is the touch-target floor; the measured tile already clears it.
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  background: "var(--chrome-800)",
  border: "2px solid var(--chrome-line)",
  cursor: "pointer",
};

export function EmojiGrid({ onSend, onMore, className }: EmojiGridProps) {
  return (
    <div
      data-testid="emoji-grid"
      role="group"
      aria-label="Emotes"
      className={clsx("emoji-grid", className)}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 78px)",
        gap: 8,
        justifyContent: "center",
        padding: "8px 0",
      }}
    >
      {EMOJI.map((glyph: EmojiGlyph) => (
        <button
          key={glyph.id}
          type="button"
          data-testid={`emoji-${glyph.id}`}
          aria-label={glyph.label}
          style={TILE}
          onClick={() => onSend({ emoji: glyph.id })}
        >
          <EmojiGlyphIcon id={glyph.id} />
        </button>
      ))}
      <button
        type="button"
        data-testid="emoji-more"
        aria-label="More — open the dialog roster"
        style={{ ...TILE, fontSize: 28, fontWeight: 900, color: "var(--text)" }}
        onClick={onMore}
      >
        {EMOJI_MORE}
      </button>
    </div>
  );
}

export default EmojiGrid;
