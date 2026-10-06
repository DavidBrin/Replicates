"use client";

/**
 * One `/new/map` tile (SPEC §7, research/04 §5.3): the map's name at the top
 * (4 px dark outline), the board itself on a translucent blue glass tray
 * tilted ~30° back and ~6° yawed over a soft elliptical contact shadow, and
 * the stat line beneath.
 *
 * The three rows are **flex rows, not fixed percentages of an 8:7 box**: a
 * name set at 40 px does not fit inside 9 % of a 190 px grid cell, so the box
 * let the glass tray ride up over the name and clip it, and both strings were
 * truncated with an ellipsis. Now the **tray** carries the aspect, the name
 * reserves two lines' worth of room (so every tray in a row is the same size)
 * and wraps rather than truncating, and the stat line sits under it in
 * `--text-muted`. **No string on this tile is ever abbreviated.**
 *
 * **No locked tiles — every map is free** (§7).
 *
 * The mini board is drawn straight from the `MapDef`'s territory `d` strings:
 * land parchment, 3 px coasts, 1.5 px internal borders, 2.5 px continent
 * perimeters in the continent's own accent, and white dotted sea routes. The
 * map is lazy-loaded through `playMapDef` — never `@/content/maps`, which is
 * still S3's empty stub — and a skeleton holds the tile until it resolves.
 */
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";

import type { MapDef } from "@/engine/types";
import { playMapDef } from "@/game/pending";

import { SETUP_TOKENS } from "../ui/tokens";

export interface MapTileProps {
  readonly slug: string;
  /** Shown until the `MapDef` resolves and supplies the real name. */
  readonly fallbackName?: string;
  /** The stat line under the tray; defaults to the map's own shape. */
  readonly tagline?: string;
  readonly selected?: boolean;
  /** Omitted, the tile is inert — the `/new/rules` hero. */
  readonly onSelect?: () => void;
  /** Overlays the bottom edge: the player-count chip and mode plate. */
  readonly footer?: ReactNode;
  readonly testId?: string;
  readonly className?: string;
}

function MiniBoard({ def }: { readonly def: MapDef }) {
  const [x, y, w, h] = def.viewBox;
  const routes: { readonly key: string; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }[] = [];
  def.territories.forEach((t) => {
    t.seaLinked.forEach((other) => {
      if (other <= t.index) return;
      const to = def.territories[other];
      if (!to) return;
      routes.push({ key: `${t.index}-${other}`, x1: t.token[0], y1: t.token[1], x2: to.token[0], y2: to.token[1] });
    });
  });

  return (
    <svg
      data-testid="map-tile-board"
      viewBox={`${x} ${y} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      aria-hidden
    >
      <g>
        {def.territories.map((t) => (
          <path
            key={t.id}
            d={t.d}
            fill={SETUP_TOKENS.tileLand}
            stroke={SETUP_TOKENS.tileBorder}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        ))}
      </g>
      {/* continent perimeters, 2.5 px in that continent's accent */}
      <g fill="none" strokeWidth={2.5} strokeLinejoin="round">
        {def.continents.map((continent) =>
          continent.border.map((index) => {
            const t = def.territories[index];
            return t ? <path key={`${continent.id}-${t.id}`} d={t.d} stroke={continent.color} /> : null;
          }),
        )}
      </g>
      {/* coasts: the outer rule, drawn last so it reads at tile scale */}
      <g fill="none" stroke={SETUP_TOKENS.tileCoast} strokeWidth={3} strokeLinejoin="round" opacity={0.75}>
        {def.territories.map((t) => (
          <path key={`coast-${t.id}`} d={t.d} />
        ))}
      </g>
      <g stroke="var(--sea-route)" strokeWidth={3} strokeDasharray="10 9" strokeLinecap="round">
        {routes.map((r) => (
          <line key={r.key} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />
        ))}
      </g>
    </svg>
  );
}

export function MapTile({
  slug,
  fallbackName,
  tagline,
  selected = false,
  onSelect,
  footer,
  testId,
  className,
}: MapTileProps) {
  // One state cell, stamped with the slug it belongs to, so switching slug
  // shows the skeleton again without a synchronous reset inside the effect.
  const [loaded, setLoaded] = useState<{ slug: string; def: MapDef | null } | null>(null);

  useEffect(() => {
    let live = true;
    playMapDef(slug)
      .then((def) => { if (live) setLoaded({ slug, def }); })
      .catch(() => { if (live) setLoaded({ slug, def: null }); });
    return () => { live = false; };
  }, [slug]);

  const settled = loaded?.slug === slug ? loaded : null;
  const def = settled?.def ?? null;
  const failed = settled !== null && settled.def === null;

  const name = def?.name ?? fallbackName ?? slug;
  // §1: "Continent" is RGD's word on Classic; **region** is the generic one
  // the catalogue uses — and it keeps the line on one row at tile width.
  const line = tagline
    ?? (def ? `${def.territories.length} territories · ${def.continents.length} regions` : "Loading map…");
  // A real <button> when the tile is pickable, an inert <div> for the
  // `/new/rules` hero. The cast keeps one JSX block instead of two copies.
  const Chassis = (onSelect ? "button" : "div") as "button";

  return (
    <Chassis
      type={onSelect ? "button" : undefined}
      data-testid={testId ?? `map-tile-${slug}`}
      data-slug={slug}
      data-selected={selected ? "true" : "false"}
      aria-pressed={onSelect ? selected : undefined}
      onClick={onSelect}
      className={clsx(
        "relative flex w-full flex-col items-center gap-1 overflow-visible p-2 outline-none",
        onSelect && "cursor-pointer focus-visible:ring-4 focus-visible:ring-white/70",
        className,
      )}
      style={{
        // The tile is name + tray + tagline tall; it is the **tray** that
        // carries the aspect, so a two-line name never eats the board.
        minHeight: 44,
        borderRadius: "var(--r-menu)",
        border: `2px solid ${selected ? "var(--go)" : "transparent"}`,
        background: selected ? "rgba(166,220,95,.10)" : "transparent",
      }}
    >
      <span
        data-testid="map-tile-name"
        className="on-board-text flex w-full shrink-0 items-center justify-center text-center"
        // Two lines' worth of room whether the name needs it or not, so every
        // tray in a row ends up the same size.
        style={{ fontSize: "clamp(14px, 1.7vw, 40px)", lineHeight: 1.08, minHeight: "2.16em" }}
      >
        {name}
      </span>

      {/* The tray's slot owns the aspect; the tray itself is absolute inside
          it, so a board's own viewBox ratio can never size the tile. */}
      <span
        className="relative block w-full shrink-0"
        style={{ aspectRatio: "8 / 4.5" }}
      >
        {/* the soft elliptical contact shadow */}
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-[2%] left-1/2 h-[12%] w-[72%] -translate-x-1/2 rounded-[50%]"
          style={{ background: "rgba(0,0,0,.45)", filter: "blur(10px)" }}
        />
        <span
          data-testid="map-tile-tray"
          className="absolute inset-0 flex items-center justify-center rounded-[10px]"
          style={{
            background: "linear-gradient(rgba(60,160,205,.34), rgba(20,80,110,.42))",
            border: "1px solid rgba(190,236,255,.35)",
            transform: "perspective(900px) rotateX(30deg) rotateY(-6deg)",
            transformOrigin: "50% 70%",
          }}
        >
          {def ? (
            <MiniBoard def={def} />
          ) : (
            <span
              data-testid="map-tile-skeleton"
              className="h-[80%] w-[86%] rounded-[8px]"
              style={{ background: failed ? "transparent" : "rgba(255,255,255,.12)" }}
            >
              {failed ? (
                <span className="font-body" style={{ color: "var(--text-dim)" }}>
                  Map unavailable
                </span>
              ) : null}
            </span>
          )}
        </span>
      </span>

      <span
        data-testid="map-tile-tagline"
        className="flex w-full shrink-0 items-center justify-center text-center font-body"
        style={{
          fontSize: "clamp(11px, 1.05vw, 26px)", lineHeight: 1.2, minHeight: "1.2em",
          color: "var(--text-muted)",
          // The ray burst is at its brightest right behind the middle tiles.
          textShadow: "0 1px 2px rgba(0,0,0,.9), 0 0 6px rgba(0,0,0,.6)",
        }}
      >
        {line}
      </span>

      {footer ? <span className="absolute inset-x-0 bottom-[-26px] flex justify-center">{footer}</span> : null}
    </Chassis>
  );
}

export default MapTile;
