"use client";

/**
 * The hot-seat hand-off overlay (SPEC §7.2 — **[ours]**, and §5.4).
 *
 * Full-screen, opaque and tinted with the incoming seat's colour, so the
 * outgoing player confirms whose turn is next before physically passing the
 * device. The board underneath stays completely hidden until `CONTINUE`.
 *
 * **Purely presentational**: it never dismisses itself and never touches game
 * state. The caller — the session runner, through `GameScreen` — owns both
 * the decision to show it and the decision to hide it. §9's keyboard column
 * maps `Enter` to `CONTINUE`; that is additive, and the button is always the
 * supported path.
 */
import type { PlayerColour } from "@/engine/types";

import { Avatar } from "../ui/Avatar";
import { Pill } from "../ui/Pill";

export interface HandOffOverlayProps {
  /** The seat's display name — `SeatConfig.name`. */
  readonly playerName: string;
  /** The seat's colour; the whole overlay is tinted with it. */
  readonly colour: PlayerColour;
  /** Called once, when `CONTINUE` is activated. */
  readonly onContinue: () => void;
}

export function HandOffOverlay({ playerName, colour, onContinue }: HandOffOverlayProps) {
  return (
    <div
      data-testid="handoff-overlay"
      data-colour={colour}
      role="dialog"
      aria-modal="true"
      aria-label={`Pass the device to ${playerName}`}
      className="fixed inset-0 flex flex-col items-center justify-center gap-6 px-4"
      style={{
        zIndex: "var(--z-banner)",
        // opaque: the base colour first, the owner tint over it
        background: `linear-gradient(var(--chrome-900), var(--chrome-900))`,
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 42%, var(--p-${colour}) 0%, var(--p-${colour}-dark) 38%, var(--p-${colour}-wall) 72%, var(--chrome-900) 100%)`,
          opacity: 0.92,
        }}
      />

      <div className="relative flex flex-col items-center gap-5">
        <Avatar name={playerName} colour={colour} size={132} laurel testId="handoff-avatar" />

        <p
          className="on-board-text text-center uppercase"
          style={{ fontSize: "clamp(20px, 3.4vw, 34px)", letterSpacing: ".06em" }}
        >
          Pass the device to
        </p>

        <p
          data-testid="handoff-name"
          className="on-board-text text-center"
          style={{ fontSize: "clamp(34px, 6vw, 58px)" }}
        >
          {playerName}
        </p>

        <Pill label="CONTINUE" size="hero" testId="handoff-continue" onClick={onContinue} />
      </div>
    </div>
  );
}

export default HandOffOverlay;
