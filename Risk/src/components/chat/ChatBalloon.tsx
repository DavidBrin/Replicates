"use client";

/**
 * A dialog balloon popped to the LEFT of the sender's roster capsule
 * (SPEC §7.3, §8 Motion): scale 0.6 → 1.06 → 1 over 240 ms back-out,
 * auto-dismissed after ~4 s with a 200 ms fade.
 *
 * Purely presentational. The session owns the timer; this component simply
 * reports when its own exit animation has finished, so a caller that prefers
 * to drive the lifetime itself can ignore `onDone` entirely.
 */

import clsx from "clsx";
import { useEffect, useRef } from "react";

import type { PlayerColour } from "@/engine/types";
import { playerVar } from "@/render/palette";

export interface ChatBalloonProps {
  readonly text: string;
  readonly colour: PlayerColour;
  /** Called once the 200 ms fade has finished. */
  readonly onDone?: () => void;
  readonly className?: string;
}

const KEYFRAMES = `
@keyframes risk-balloon-in {
  0%   { transform: scale(.6); opacity: 0 }
  62%  { transform: scale(1.06); opacity: 1 }
  100% { transform: scale(1); opacity: 1 }
}
@keyframes risk-balloon-out {
  0%, 94% { opacity: 1 }
  100%    { opacity: 0 }
}
`;

export function ChatBalloon({ text, colour, onDone, className }: ChatBalloonProps) {
  const fadeRef = useRef<HTMLSpanElement | null>(null);

  // A native listener, not React's `onAnimationEnd`: React only registers
  // animation events when the environment exposes `AnimationEvent`, which the
  // test environment does not.
  useEffect(() => {
    const node = fadeRef.current;
    if (node === null || onDone === undefined) return;
    const handler = (): void => onDone();
    node.addEventListener("animationend", handler);
    return () => node.removeEventListener("animationend", handler);
  }, [onDone]);

  return (
    <div
      data-testid="chat-balloon"
      role="status"
      className={clsx("chat-balloon", className)}
      style={{
        position: "relative",
        maxWidth: 300,
        padding: "10px 16px",
        borderRadius: 18,
        background: "var(--paper)",
        color: "var(--text-on-paper)",
        fontFamily: "var(--font-body), system-ui, sans-serif",
        fontWeight: 600,
        fontSize: 17,
        border: `3px solid ${playerVar(colour)}`,
        boxShadow: "var(--sh-float)",
        transformOrigin: "100% 50%",
        // 240 ms back-out in (§8 Motion).
        animation: "risk-balloon-in 240ms cubic-bezier(.34,1.56,.64,1) both",
      }}
    >
      <style>{KEYFRAMES}</style>
      {/* The 3.5 s hold and the 200 ms fade, on their own element so the exit is the
          only `animationend` this handler can see. */}
      <span
        ref={fadeRef}
        data-testid="chat-balloon-fade"
        style={{ display: "block",
          animation: "risk-balloon-out 3700ms linear 240ms both" }}
      >
        {text}
      </span>
      {/* The tail points right, at the roster capsule the balloon popped from. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: -14,
          top: "50%",
          marginTop: -9,
          width: 0,
          height: 0,
          borderTop: "9px solid transparent",
          borderBottom: "9px solid transparent",
          borderLeft: `14px solid ${playerVar(colour)}`,
        }}
      />
    </div>
  );
}

export default ChatBalloon;
