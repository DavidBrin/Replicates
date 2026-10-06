"use client";

/**
 * The left chat drawer of SPEC §7.3 — ≈22 %W, full height, `rgba(20,24,28,.88)`
 * on `--z-modal`. Top row: own avatar in a gold frame, the `ALL` channel pill,
 * a chat-bubble button. Then the emoji grid, the dialog roster, the log.
 *
 * There is no free-text path: everything the drawer can send is one of the 42
 * roster indices or one of the 8 glyph ids.
 */

import clsx from "clsx";
import { useRef } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/IconButton";
import type { PlayerColour } from "@/engine/types";
import type { ChatLine, ChatSend } from "@/ports/sync";

import { ChatLog } from "./ChatLog";
import { DialogRoster } from "./DialogRoster";
import { EmojiGrid } from "./EmojiGrid";

export interface ChatDrawerProps {
  readonly open: boolean;
  readonly me: { readonly name: string; readonly colour: PlayerColour };
  readonly lines: readonly ChatLine[];
  /** True while an alliance is active: unlocks the two ally-only lines. */
  readonly allied: boolean;
  readonly onSend: (send: ChatSend) => void;
  readonly onClose: () => void;
  /** Host/system announcements shown at the head of the log. */
  readonly notices?: readonly string[];
  readonly className?: string;
}

export function ChatDrawer({
  open, me, lines, allied, onSend, onClose, notices, className,
}: ChatDrawerProps) {
  const rosterRef = useRef<HTMLDivElement | null>(null);
  if (!open) return null;

  return (
    <aside
      data-testid="chat-drawer"
      aria-label="Chat"
      className={clsx("chat-drawer", className)}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        width: "22%",
        minWidth: 280,
        zIndex: "var(--z-modal)" as unknown as number,
        /* §7.3 quotes this drawer face literally; it has no token. */
        background: "rgba(20,24,28,.88)",
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--sh-panel)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: 10,
          borderBottom: "1px solid var(--chrome-line)",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            borderRadius: "50%",
            padding: 3,
            background: "var(--gold)",
            boxShadow: "var(--sh-chip)",
          }}
        >
          <Avatar colour={me.colour} name={me.name} size={48} you />
        </span>
        <span
          data-testid="chat-channel"
          style={{
            /* §7.3: the grey channel pill. */
            background: "#B9B6B0",
            color: "var(--text-on-paper)",
            borderRadius: 20,
            minWidth: 64,
            height: 44,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 18px",
            fontFamily: "var(--font-head), system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 18,
            letterSpacing: ".04em",
          }}
        >
          ALL
        </span>
        <span style={{ marginLeft: "auto" }}>
          <IconButton
            chassis="circle"
            icon="speaking-head"
            size={44}
            label="Close chat"
            onClick={onClose}
          />
        </span>
      </header>

      <EmojiGrid
        onSend={onSend}
        onMore={() => rosterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />

      <div ref={rosterRef} style={{ flex: "1 1 55%", minHeight: 0, display: "flex", flexDirection: "column" }}>
        <DialogRoster allied={allied} onSend={onSend} />
      </div>

      <ChatLog lines={lines} notices={notices} />
    </aside>
  );
}

export default ChatDrawer;
