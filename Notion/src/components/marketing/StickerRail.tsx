"use client";

import { useEffect, useRef, useState } from "react";
import { AppGlyph, DoodleFace, Squiggle } from "./icons";

interface Sticker {
  /** Which rail the sticker hangs off. */
  side: "left" | "right";
  /** Distance from the top of the hero, as a percentage. */
  top: string;
  /** Inset from the rail edge. */
  inset: number;
  /** Rest rotation, so the set reads as hand-placed rather than gridded. */
  rotate: number;
  /** Parallax rate — layered, so they separate as the page scrolls. */
  rate: number;
  face: number;
  app: number;
  squiggle: number;
  squigglePos: { top?: number; bottom?: number; left?: number; right?: number };
  count?: number;
}

/* Insets stay ≤ 28px so that badge + squiggle never reach the 960px hero
   column at the 1280px breakpoint where the rail first appears. */
const STICKERS: Sticker[] = [
  { side: "left", top: "5%", inset: 20, rotate: -12, rate: 0.16, face: 0, app: 0, squiggle: 0, squigglePos: { bottom: -32, right: -44 }, count: 3 },
  { side: "left", top: "36%", inset: 4, rotate: 9, rate: 0.3, face: 4, app: 3, squiggle: 1, squigglePos: { top: -26, right: -48 } },
  { side: "left", top: "64%", inset: 26, rotate: -21, rate: 0.22, face: 2, app: 4, squiggle: 2, squigglePos: { bottom: -28, right: -46 } },
  { side: "right", top: "7%", inset: 14, rotate: 15, rate: 0.26, face: 3, app: 2, squiggle: 1, squigglePos: { bottom: -30, left: -46 }, count: 12 },
  { side: "right", top: "39%", inset: 28, rotate: -8, rate: 0.14, face: 6, app: 5, squiggle: 0, squigglePos: { top: -24, left: -48 } },
  { side: "right", top: "67%", inset: 8, rotate: 11, rate: 0.34, face: 1, app: 1, squiggle: 2, squigglePos: { bottom: -26, left: -44 } },
];

/**
 * The decorative characters flanking the hero.
 *
 * Each drifts *outward* and down as the page scrolls, at its own rate, so the
 * rail feels like several depth layers rather than one sheet. Motion is opt-in
 * per the user's reduced-motion setting; with motion off the stickers still
 * render, just pinned at their rest position.
 */
export function StickerRail() {
  const [offset, setOffset] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        setOffset(window.scrollY);
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  return (
    <div className="mkt-stickers" aria-hidden="true">
      {STICKERS.map((sticker, i) => {
        const drift = offset * sticker.rate;
        const outward = sticker.side === "left" ? -drift * 0.45 : drift * 0.45;
        return (
          <div
            key={i}
            className="mkt-sticker"
            style={{
              top: sticker.top,
              left: sticker.side === "left" ? sticker.inset : undefined,
              right: sticker.side === "right" ? sticker.inset : undefined,
              animationDelay: `${i * 70}ms`,
              transform: `translate3d(${outward}px, ${drift}px, 0) rotate(${sticker.rotate}deg)`,
            }}
          >
            <div className="mkt-sticker__badge">
              <DoodleFace variant={sticker.face} size={48} />
              {sticker.count !== undefined && (
                <span className="mkt-sticker__count">{sticker.count}</span>
              )}
              {/* the connected-app badge, pinned to the corner off-axis */}
              <span
                className="mkt-sticker__app"
                style={{ transform: `rotate(${sticker.rotate > 0 ? -7 : 6}deg)` }}
              >
                <AppGlyph variant={sticker.app} />
              </span>
            </div>
            <span className="mkt-sticker__squiggle" style={sticker.squigglePos}>
              <Squiggle variant={sticker.squiggle} width={66} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
