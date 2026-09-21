"use client";

import { useEffect, useState } from "react";

import { worldToScreen } from "@/render/camera";
import { OUTLINE, UI, WHITE } from "@/render/palette";

import { useSession, useUi } from "./SessionContext";
import { HUD_HEIGHT, TOUCH_MIN, pixelInk, pixelText } from "./styles";

/**
 * Tutorial speech bubble (research §9): white rounded box, upper-case
 * pixel text in ink, a tail toward `highlightTile`, OK / tap to dismiss.
 * Anchored to the HUD when the step names no tile.
 */
export function SpeechBubble() {
  const session = useSession();
  const step = useUi((s) => s.tutorialStep);
  const [, force] = useState(0);
  // follow the camera while the bubble is open
  useEffect(() => {
    if (!step?.highlightTile) return;
    let raf = 0;
    const tick = () => {
      force((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);
  if (!step) return null;

  let style: React.CSSProperties;
  let tail: React.CSSProperties | null = null;
  if (step.highlightTile) {
    const cam = session.camera;
    const p = worldToScreen(cam, step.highlightTile.x + 0.5, step.highlightTile.y);
    const left = Math.min(Math.max(p.x, 130), cam.viewW - 130);
    const top = Math.max(60, Math.min(p.y - 16, cam.viewH - 40));
    style = { left, top, transform: "translate(-50%, -100%)" };
    tail = { left: `calc(50% + ${Math.max(-100, Math.min(100, p.x - left))}px)` };
  } else {
    style = { left: "50%", bottom: HUD_HEIGHT + 16, transform: "translateX(-50%)" };
  }
  return (
    <div
      data-testid="tutorial-bubble"
      role="dialog"
      aria-live="polite"
      className="absolute z-30 flex max-w-[min(320px,calc(100vw-32px))] flex-col gap-2 px-4 py-3"
      style={{ ...style, background: WHITE, border: `3px solid ${OUTLINE}`, borderRadius: 12 }}
      onClick={() => session.dismissTutorial()}
    >
      <p className="text-center text-sm" style={pixelInk}>
        {step.text}
      </p>
      <button
        type="button"
        data-testid="tutorial-ok"
        onClick={(e) => {
          e.stopPropagation();
          session.dismissTutorial();
        }}
        className="self-center px-6 text-sm"
        style={{ minHeight: TOUCH_MIN - 8, background: UI.buyGreen, border: `2px solid ${OUTLINE}`, borderRadius: 6, ...pixelText }}
      >
        OK
      </button>
      {tail && (
        <span
          aria-hidden
          className="absolute -bottom-[12px] block h-0 w-0 -translate-x-1/2"
          style={{ ...tail, borderLeft: "10px solid transparent", borderRight: "10px solid transparent", borderTop: `12px solid ${OUTLINE}` }}
        />
      )}
    </div>
  );
}
