"use client";

/**
 * The tutorial tip card (SPEC §7.2): a top banner y 0–240, a card x 570–1480 /
 * y 330–760 with a broad specular sheen across the upper third, a cyan shield
 * badge at the card's left, and body copy bold white 54 px, **two lines max**.
 * Modal, dismiss-on-tap.
 *
 * **There is no small corner toast anywhere in the evidence** — never add one.
 */

import { at, atTopLeft, outlined, Stage } from "./stage";

export interface TipCardProps {
  /** Two lines at most; longer copy is clamped rather than reflowed. */
  readonly text: string;
  readonly onDismiss: () => void;
  /** Optional heading in the top banner. */
  readonly heading?: string;
}

const BANNER = "#203A5F"; // §7.2, a `--chrome-900`-ish banner with no token
const CARD_TOP = "#304064"; // §7.2 card gradient, top
const CARD_BOTTOM = "#103059"; // §7.2 card gradient, bottom

export function TipCard({ text, onDismiss, heading }: TipCardProps) {
  return (
    <Stage
      testId="tip-card"
      label={heading ?? "Tip"}
      scrim="var(--scrim-heavy)"
      z="var(--z-tip)"
      onBackdropClick={onDismiss}
    >
      <div
        aria-hidden
        style={{
          ...atTopLeft(0, 0), width: "100%", height: 240, background: BANNER,
          borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
        }}
      />
      {heading ? <div style={{ ...at(800, 120), ...outlined(46) }}>{heading}</div> : null}

      <button
        type="button"
        data-testid="tip-card-body"
        onClick={(event) => { event.stopPropagation(); onDismiss(); }}
        style={{
          ...atTopLeft(570, 330), width: 910, height: 430, borderRadius: 30,
          background: `linear-gradient(${CARD_TOP}, ${CARD_BOTTOM})`,
          border: "none", cursor: "pointer", overflow: "hidden", padding: "0 60px 0 170px",
          display: "flex", alignItems: "center", textAlign: "left",
        }}
      >
        {/* the broad specular sheen across the upper third */}
        <span
          aria-hidden
          style={{
            position: "absolute", left: 0, right: 0, top: 0, height: "34%",
            background: "linear-gradient(rgba(255,255,255,.18), rgba(255,255,255,0))",
            pointerEvents: "none",
          }}
        />
        {/* the cyan shield badge */}
        <svg
          aria-hidden
          width="70"
          height="80"
          viewBox="0 0 70 80"
          style={{ position: "absolute", left: 50, top: 175 }}
        >
          <path d="M35 2 68 14v30c0 20-14 30-33 34C16 74 2 64 2 44V14Z" fill="var(--cyan)"
            stroke="var(--stroke-dark)" strokeWidth="3" />
          <path d="M20 40 31 52 52 26" fill="none" stroke="var(--text)" strokeWidth="8"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <span
          className="on-board-text"
          style={{
            fontSize: 54, lineHeight: 1.12, WebkitTextStroke: "4px var(--stroke-dark)",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {text}
        </span>
      </button>
    </Stage>
  );
}

export default TipCard;
