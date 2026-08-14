/**
 * A project's glyph.
 *
 * `projects.icon` is a free-text column holding a name like `Bolt` or `Rocket`,
 * because the seed and any future importer need to write one without knowing
 * what this component supports. So the mapping is *lossy on purpose*: a name
 * this file has never met falls back to the initial of the project's own name
 * on a tinted square, which reads as deliberate rather than as a missing asset.
 *
 * Drawn rather than imported for the reason `SPEC.md` §5 gives about status
 * glyphs: an icon set adds a dependency and a bundle for shapes that are four
 * paths each, and the app's own icons already live in `components/ui/icons`.
 */

import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

const PATHS: Readonly<Record<string, string>> = {
  Bolt: "M8.5 1.5 3 8.5h3.5L5.5 14.5 11 7.5H7.5z",
  Rocket:
    "M8 1.5c2.2 1.4 3.5 3.7 3.5 6.2 0 1-.2 1.9-.5 2.8H5c-.3-.9-.5-1.8-.5-2.8 0-2.5 1.3-4.8 3.5-6.2zM6 12h4l-.7 2.2a.5.5 0 0 1-.5.3H7.2a.5.5 0 0 1-.5-.3z",
  Palette:
    "M8 2a6 6 0 0 0 0 12c.7 0 1.2-.6 1.2-1.2 0-.4-.2-.7-.4-.9-.2-.2-.3-.5-.3-.8 0-.6.5-1.1 1.2-1.1h1.4A3.4 3.4 0 0 0 14 6.6C14 4 11.3 2 8 2zM5 8.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm1.8-2.8a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm2.9 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z",
  Cube: "M8 1.5 14 5v6l-6 3.5L2 11V5zm0 1.7L3.7 5.7 8 8.2l4.3-2.5zM3 7.2v3.2l4.4 2.5V9.7zm5.6 2.5v3.2L13 10.4V7.2z",
  Target:
    "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 1.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8zm0 1.9a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  Compass:
    "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm2.6 3.4-1.4 3.7-3.8 1.5 1.4-3.7zM8 7.3a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z",
};

export interface ProjectIconProps {
  icon: string;
  color: string;
  /** Used for the fallback initial, and for the accessible name. */
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function ProjectIcon({
  icon,
  color,
  name,
  size = 20,
  className,
  style,
}: ProjectIconProps) {
  const path = PATHS[icon];
  const shared = cn(
    "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
    className,
  );

  if (path === undefined) {
    return (
      <span
        role="img"
        aria-label={`${name} icon`}
        className={cn(shared, "font-[var(--weight-title)]")}
        style={{
          width: size,
          height: size,
          fontSize: size * 0.55,
          // `color-mix` rather than a second hex: the tint has to survive both
          // themes, and mixing toward the app background does that without a
          // per-theme table of project colours.
          background: `color-mix(in srgb, ${color} 18%, transparent)`,
          color,
          ...style,
        }}
      >
        {name.trim().slice(0, 1).toUpperCase() || "P"}
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={`${name} icon`}
      className={shared}
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${color} 18%, transparent)`,
        ...style,
      }}
    >
      <svg
        width={size * 0.75}
        height={size * 0.75}
        viewBox="0 0 16 16"
        fill={color}
        aria-hidden="true"
      >
        <path d={path} />
      </svg>
    </span>
  );
}
