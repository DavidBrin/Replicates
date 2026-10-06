"use client";

/**
 * One 175×320 territory card (SPEC §8 "Card", §7.2 card-trade panel).
 *
 * `--paper` under a radial sunburst, a 4 px `--paper-edge` inset rule, suit art
 * in the top ~45% as a flat `--suit` silhouette, an owner-tinted territory
 * silhouette in the lower ~35%, the name bold white ~30 px with a 4 px outline.
 * Selected: `translateY(-14px)` plus a white dashed border 8 px outside.
 */

import clsx from "clsx";
import type { ReactElement } from "react";

import type { Card, PlayerColour, Suit } from "@/engine/types";
import { playerVar } from "@/render/palette";

/** "western-australia" → "Western Australia"; "wild-1" → "Wild". */
export function cardName(card: Card): string {
  if (card.suit === "wild") return "Wild";
  return card.id
    .split("-")
    .map((part) => (part.length > 0 ? part[0]?.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

const INFANTRY = "M50 6c7 0 11 5 11 11 0 5-2 8-5 10l6 6 18-14 4 6-19 17 3 30h-9l-3-23-6 8v31h-9V56l-9 7-6-16 13-12c3-3 6-4 10-4-3-2-5-5-5-10 0-6 5-11 11-11Z";
const CAVALRY = "M26 92V70c0-16 9-28 23-33l4-14c1-5 6-8 11-6l16 7-7 7 7 5-9 9c-4 4-6 9-6 15v32h-9V63l-9 6v23h-9V72l-8 6v14Z";
const ARTILLERY = "M14 70a14 14 0 1 0 0 1Zm62 0a11 11 0 1 0 0 1ZM20 62l10-18h18l44 8v10l-44 6-8 10Z";

const SUIT_ART: Record<Suit, ReactElement> = {
  infantry: <path d={INFANTRY} />,
  cavalry: <path d={CAVALRY} />,
  artillery: <path d={ARTILLERY} />,
  wild: (
    <g>
      <g opacity=".45" transform="translate(-18 6) scale(.68)"><path d={INFANTRY} /></g>
      <g opacity=".45" transform="translate(42 6) scale(.68)"><path d={ARTILLERY} /></g>
      <g transform="translate(14 14) scale(.72)"><path d={CAVALRY} /></g>
    </g>
  ),
};

/** A chunky default landmass, in a 100×100 box. Maps may supply their own. */
const DEFAULT_SILHOUETTE = "M14 46 30 22l26-8 22 10 10 22-8 20-20 14-24 4-18-12Z";

export interface TerritoryCardProps {
  readonly card: Card;
  readonly selected: boolean;
  readonly onToggle: (id: string) => void;
  /** The territory's CURRENT owner; the silhouette is tinted by it (§8). */
  readonly owner?: PlayerColour;
  /** An SVG path `d` in a 100×100 box, when the map supplies one. */
  readonly silhouette?: string;
  /** Alternating ±4–6°; the middle card is upright. */
  readonly rotate?: number;
  readonly className?: string;
}

export function TerritoryCard({
  card, selected, onToggle, owner, silhouette, rotate = 0, className,
}: TerritoryCardProps) {
  const name = cardName(card);
  const tint = owner ? playerVar(owner) : "var(--land-neutral)";

  return (
    <button
      type="button"
      data-testid={`card-${card.id}`}
      data-suit={card.suit}
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      aria-label={`${name}, ${card.suit}`}
      onClick={() => onToggle(card.id)}
      className={clsx("territory-card", className)}
      style={{
        position: "relative",
        width: 175,
        height: 320,
        marginInline: -10, // ~20 px of overlap across the fan
        borderRadius: 18,
        border: "none",
        padding: 0,
        cursor: "pointer",
        background: "radial-gradient(circle at 50% 34%, #FBF2DF, var(--paper))",
        boxShadow: "var(--sh-card)",
        transform: `rotate(${rotate}deg) translateY(${selected ? -14 : 0}px)`,
        transition: "transform 160ms cubic-bezier(.34,1.56,.64,1)",
      }}
    >
      {/* the inset paper rule */}
      <span
        aria-hidden
        style={{ position: "absolute", inset: 7, borderRadius: 12,
          border: "3px solid var(--paper-edge)" }}
      />
      {/* selected: a white dashed border 8 px OUTSIDE the card */}
      {selected ? (
        <span
          aria-hidden
          data-testid={`card-${card.id}-selected`}
          style={{ position: "absolute", inset: -8, borderRadius: 26,
            border: "4px dashed var(--text)", borderSpacing: 0 }}
        />
      ) : null}

      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="45%"
        aria-hidden
        style={{ position: "absolute", left: 0, top: "4%" }}
      >
        <g fill="var(--suit)">{SUIT_ART[card.suit]}</g>
      </svg>

      <svg
        viewBox="0 0 100 100"
        width="72%"
        height="35%"
        aria-hidden
        style={{ position: "absolute", left: "14%", top: "50%" }}
      >
        <path d={silhouette ?? DEFAULT_SILHOUETTE} fill={tint} />
      </svg>

      <span
        className="on-board-text"
        style={{
          position: "absolute", left: 6, right: 6, bottom: 26, fontSize: 30, lineHeight: 1.05,
          wordBreak: "break-word",
        }}
      >
        {name}
      </span>
    </button>
  );
}

export default TerritoryCard;
