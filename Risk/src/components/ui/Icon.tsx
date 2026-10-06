/**
 * The icon set (SPEC §8 "Icons").
 *
 * Flat, monochrome, chunky rounded silhouettes with **no internal detail and
 * no outlines** — every glyph is one or more filled sub-paths in a 24×24 box,
 * holes cut with `fill-rule: evenodd` rather than drawn as strokes, so a glyph
 * reads the same at 18 px in a roster capsule and at 120 px on a menu card.
 *
 * There is exactly one `<Icon>`; the chassis (circle, grey tray, bare) is
 * `IconButton`'s job, never the glyph's.
 */
import type { ReactNode } from "react";

export type IconName =
  | "person"
  | "robot"
  | "globe"
  | "soldier"
  | "map-pin"
  | "tank"
  | "die"
  | "speaking-head"
  | "bar-chart"
  | "snowflake"
  | "stopwatch"
  | "skull"
  | "gear"
  | "question"
  | "screen"
  | "laurel"
  | "card"
  | "chevron"
  | "check"
  | "cross"
  | "portal"
  | "capital"
  | "percent"
  | "dice-cup";

export const ICON_NAMES: readonly IconName[] = [
  "person", "robot", "globe", "soldier", "map-pin", "tank", "die", "speaking-head",
  "bar-chart", "snowflake", "stopwatch", "skull", "gear", "question", "screen",
  "laurel", "card", "chevron", "check", "cross", "portal", "capital", "percent", "dice-cup",
];

const EVEN_ODD = { fillRule: "evenodd", clipRule: "evenodd" } as const;

const PATHS: Record<IconName, ReactNode> = {
  person: (
    <path d="M12 2.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8Zm0 10.2c4.5 0 8.1 2.6 8.1 5.8v2.8H3.9v-2.8c0-3.2 3.6-5.8 8.1-5.8Z" />
  ),
  robot: (
    <>
      <path d="M11.1 0.8h1.8v3.2h-1.8Z" />
      <path d="M12 0a1.6 1.6 0 1 1 0 3.2A1.6 1.6 0 0 1 12 0Z" />
      <path
        {...EVEN_ODD}
        d="M4.6 4.6h14.8a2 2 0 0 1 2 2v10.2a2 2 0 0 1-2 2H4.6a2 2 0 0 1-2-2V6.6a2 2 0 0 1 2-2ZM8 9.3a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm8 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z"
      />
      <path d="M6.2 20.2h3.6V24H6.2Zm8 0h3.6V24h-3.6Z" />
    </>
  ),
  globe: (
    <path
      {...EVEN_ODD}
      d="M12 1.4a10.6 10.6 0 1 1 0 21.2 10.6 10.6 0 0 1 0-21.2Zm-9 8.4h18v2.2H3Zm.9 5h16.2v2.2H3.9Z"
    />
  ),
  soldier: (
    <>
      <path d="M11.4 1.8a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" />
      <path d="M7.4 10h7.4l1.9 5.4-1.8 7.4h-3l.5-5.3-1.4 5.3H8l-2-7.6Z" />
      <path d="M15.4 0.6l2 1-6.6 12.6-2-1Z" />
    </>
  ),
  "map-pin": (
    <path
      {...EVEN_ODD}
      d="M12 1.2c4 0 7.2 3.2 7.2 7.2 0 5.2-7.2 14.4-7.2 14.4S4.8 13.6 4.8 8.4c0-4 3.2-7.2 7.2-7.2Zm0 4.4a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8Z"
    />
  ),
  tank: (
    <>
      <path d="M4 11.4h10.4v4.2H4Z" />
      <path d="M8 7.6h5.2v3.8H8Z" />
      <path d="M12.6 8.4h9v2.2h-9Z" />
      <path {...EVEN_ODD} d="M3 16.8h14.6a3.4 3.4 0 0 1 0 6.8H3a3.4 3.4 0 0 1 0-6.8Z" />
    </>
  ),
  die: (
    <path
      {...EVEN_ODD}
      d="M5 2.6h14a2.4 2.4 0 0 1 2.4 2.4v14a2.4 2.4 0 0 1-2.4 2.4H5A2.4 2.4 0 0 1 2.6 19V5A2.4 2.4 0 0 1 5 2.6Zm3 3.1a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Zm8 0a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Zm-4 4.4a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Zm-4 4.4a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Zm8 0a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z"
    />
  ),
  "speaking-head": (
    <>
      <path d="M10.6 1.6c4.2 0 7.2 3 7.2 7.2v4.4h-2.2v4.6l-3.2-1.4v5.6H5.2v-5.6l-2.8-4 2.4-3.4C4.8 4.8 7 1.6 10.6 1.6Z" />
      <path d="M19.4 6.6l1.8-1a9.6 9.6 0 0 1 0 8.8l-1.8-1a7.6 7.6 0 0 0 0-6.8Z" />
    </>
  ),
  "bar-chart": (
    <path d="M3 13.6h4.4V22H3Zm6.8-6.4h4.4V22H9.8Zm6.8-4.2H21V22h-4.4Z" />
  ),
  snowflake: (
    <path d="M10.9 0.8h2.2v22.4h-2.2Zm-8.6 5.6 1.1-1.9 19.4 11.2-1.1 1.9Zm19.4-1.9 1.1 1.9L3.4 17.6l-1.1-1.9Z" />
  ),
  stopwatch: (
    <>
      <path d="M9 0.8h6V3H9Z" />
      <path d="M18.6 3.4l1.6 1.6-2.3 2.3-1.6-1.6Z" />
      <path
        {...EVEN_ODD}
        d="M12 3.6a9.8 9.8 0 1 1 0 19.6 9.8 9.8 0 0 1 0-19.6Zm-1.1 3.6v6.9h6.2v-2.2h-4v-4.7Z"
      />
    </>
  ),
  skull: (
    <path
      {...EVEN_ODD}
      d="M12 1.4c5.2 0 9.2 3.8 9.2 8.8 0 3.1-1.4 5.3-3.4 6.7v3.3c0 1.3-1 2.4-2.4 2.4H8.6c-1.4 0-2.4-1.1-2.4-2.4v-3.3c-2-1.4-3.4-3.6-3.4-6.7 0-5 4-8.8 9.2-8.8ZM8.2 8.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Zm7.6 0a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Zm-5.6 9.2v3h1.6v-3Zm3.6 0v3h1.6v-3Z"
    />
  ),
  gear: (
    <path
      {...EVEN_ODD}
      d="M10.1 1h3.8l.5 2.8 2.2.9 2.3-1.6 2.7 2.7-1.6 2.3.9 2.2 2.8.5v3.8l-2.8.5-.9 2.2 1.6 2.3-2.7 2.7-2.3-1.6-2.2.9-.5 2.8h-3.8l-.5-2.8-2.2-.9-2.3 1.6-2.7-2.7 1.6-2.3-.9-2.2L0.4 14.6v-3.8l2.8-.5.9-2.2L2.5 5.8l2.7-2.7 2.3 1.6 2.2-.9ZM12 8.3a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8Z"
    />
  ),
  question: (
    <>
      <path d="M12 1.4c3.7 0 6.6 2.7 6.6 6.2 0 3.6-3.8 4.4-3.8 6.6v1h-3.6v-1.4c0-3.4 3.8-3.9 3.8-6.1a2.9 2.9 0 0 0-3-2.8c-1.7 0-2.9 1.1-3.1 2.8L5.4 7.3C5.8 3.9 8.5 1.4 12 1.4Z" />
      <path d="M13 17.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z" />
    </>
  ),
  screen: (
    <>
      <path {...EVEN_ODD} d="M2.4 3h19.2a1.8 1.8 0 0 1 1.8 1.8v10.8a1.8 1.8 0 0 1-1.8 1.8H2.4a1.8 1.8 0 0 1-1.8-1.8V4.8A1.8 1.8 0 0 1 2.4 3Zm2 2.8v8.8h15.2V5.8Z" />
      <path d="M7.6 19h8.8v2.4H7.6Z" />
      <path d="M10.6 16.8h2.8v2.8h-2.8Z" />
    </>
  ),
  laurel: (
    <>
      <path d="M11 1.4c-4.6 1.9-7.6 6-7.6 10.9 0 4.4 2.6 8.3 6.6 10.3l.9-2c-3.2-1.6-5.3-4.7-5.3-8.3 0-3.9 2.4-7.2 6.2-8.8Z" />
      <path d="M13 1.4c4.6 1.9 7.6 6 7.6 10.9 0 4.4-2.6 8.3-6.6 10.3l-.9-2c3.2-1.6 5.3-4.7 5.3-8.3 0-3.9-2.4-7.2-6.2-8.8Z" />
      <path d="M5.4 8.2c1.9-.4 3.4.3 4 1.9-1.9.6-3.3 0-4-1.9Zm13.2 0c-1.9-.4-3.4.3-4 1.9 1.9.6 3.3 0 4-1.9ZM6 14c1.9-.4 3.4.3 4 1.9-1.9.6-3.3 0-4-1.9Zm12 0c-1.9-.4-3.4.3-4 1.9 1.9.6 3.3 0 4-1.9Z" />
    </>
  ),
  card: (
    <path
      {...EVEN_ODD}
      d="M6.4 1.6h11.2a2.2 2.2 0 0 1 2.2 2.2v16.4a2.2 2.2 0 0 1-2.2 2.2H6.4a2.2 2.2 0 0 1-2.2-2.2V3.8a2.2 2.2 0 0 1 2.2-2.2Zm1 2.8v8.4h9.2V4.4Z"
    />
  ),
  chevron: <path d="M8.4 2.2 18.2 12 8.4 21.8l-2.6-2.6L13 12 5.8 4.8Z" />,
  check: <path d="M9.4 18.6 2.6 11.8l2.8-2.8 4 4 9.2-9.2 2.8 2.8Z" />,
  cross: (
    <path d="M4.6 2 12 9.4 19.4 2 22 4.6 14.6 12 22 19.4 19.4 22 12 14.6 4.6 22 2 19.4 9.4 12 2 4.6Z" />
  ),
  portal: (
    <path
      {...EVEN_ODD}
      d="M12 1.2c5.4 0 9.6 4.8 9.6 10.8S17.4 22.8 12 22.8 2.4 18 2.4 12 6.6 1.2 12 1.2Zm0 3.4c-3.4 0-6.2 3.3-6.2 7.4s2.8 7.4 6.2 7.4 6.2-3.3 6.2-7.4S15.4 4.6 12 4.6Zm0 3.4c1.6 0 2.8 1.8 2.8 4s-1.2 4-2.8 4-2.8-1.8-2.8-4 1.2-4 2.8-4Z"
    />
  ),
  capital: (
    <>
      <path d="M2.6 6.4 7 10.2l5-7.6 5 7.6 4.4-3.8-1.8 11H4.4Z" />
      <path d="M4.4 19h15.2v3H4.4Z" />
    </>
  ),
  percent: (
    <>
      <path d="M18.4 3.4 7.2 21.6 4.4 19.8 15.6 1.6Z" />
      <path {...EVEN_ODD} d="M6.6 1.4a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4Zm0 2.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" />
      <path {...EVEN_ODD} d="M17.4 13.4a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4Zm0 2.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" />
    </>
  ),
  "dice-cup": (
    <>
      <path d="M3.6 6.4h16.8l-2 13.4a2.4 2.4 0 0 1-2.4 2H8a2.4 2.4 0 0 1-2.4-2Z" />
      <path d="M2.6 2.8h18.8V6H2.6Z" />
      <path d="M15.6 0.2 19 2l-1.4 2.6-3.4-1.8Z" />
    </>
  ),
};

export interface IconProps {
  readonly name: IconName;
  /** Edge length in px; the glyph is always square. */
  readonly size?: number;
  readonly className?: string;
  /** Supply when the icon is the only label of a control; otherwise it stays `aria-hidden`. */
  readonly title?: string;
}

/** One flat silhouette, filled with `currentColor`. */
export function Icon({ name, size = 24, className, title }: IconProps) {
  return (
    <svg
      data-testid={`icon-${name}`}
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      focusable="false"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}

export default Icon;
