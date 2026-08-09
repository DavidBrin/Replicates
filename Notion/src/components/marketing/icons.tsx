/**
 * Every mark on the marketing site, drawn inline.
 *
 * Nothing here touches the network: no sprite sheet, no icon CDN, no raster
 * images. Decorative marks carry `aria-hidden` and are announced (when they
 * need to be) by the text beside them.
 */

export interface IconProps {
  size?: number;
  className?: string;
}

/* -------------------------------------------------------------- brand ---- */

/**
 * The Notion "N": a white page with a hairline black border, and inside it the
 * angular glyph — left bar, diagonal, right bar. Drawn rather than imported so
 * it stays crisp at any size and ships zero bytes of image.
 */
export function NotionMark({ size = 34 }: { size?: number }) {
  const width = (size * 33) / 34;
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 33 34"
      fill="none"
      role="img"
      aria-label="Notion"
    >
      {/* page */}
      <rect
        x="0.75"
        y="0.75"
        width="31.5"
        height="32.5"
        rx="4.5"
        fill="#fff"
        stroke="#000"
        strokeWidth="1.5"
      />
      {/* left bar, diagonal, right bar */}
      <path
        d="M9.6 25.2V8.8h3.05l8.05 11.06V8.8h2.85v16.4h-2.95l-8.15-11.2v11.2H9.6Z"
        fill="#000"
      />
    </svg>
  );
}

/* ---------------------------------------------------------------- ui ----- */

export function CaretDown({ size = 12, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2.5 4.5 6 8l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Burger({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M2 5h14M2 9h14M2 13h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Check({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="m2.5 7.5 3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Globe({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M1.75 8h12.5M8 1.75c1.6 1.7 2.5 3.9 2.5 6.25S9.6 12.55 8 14.25C6.4 12.55 5.5 10.35 5.5 8S6.4 3.45 8 1.75Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

/* ------------------------------------------------------------- social ---- */

export function SocialIcon({ name, size = 16 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    "aria-hidden": true as const,
    fill: "currentColor",
  };
  switch (name) {
    case "X":
      return (
        <svg {...common}>
          <path d="M12.1 1.5h2.1L9.6 6.8l5.4 7.7h-4.2L7.5 10l-3.8 4.5H1.6l4.9-5.7L1.3 1.5h4.3l3 4.2 3.5-4.2Zm-.7 11.6h1.2L4.7 2.8H3.4l8 10.3Z" />
        </svg>
      );
    case "LinkedIn":
      return (
        <svg {...common}>
          <path d="M3.2 5.4h2.3v8.1H3.2V5.4Zm1.2-3.6a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7ZM7.1 5.4h2.2v1.1h.03c.31-.57 1.07-1.17 2.2-1.17 2.35 0 2.79 1.5 2.79 3.46v4.7h-2.3V9.26c0-.85-.02-1.94-1.2-1.94-1.2 0-1.39.92-1.39 1.88v4.3H7.1V5.4Z" />
        </svg>
      );
    case "Instagram":
      return (
        <svg {...common}>
          <path d="M8 1.9c2 0 2.24.01 3.03.04.73.04 1.12.16 1.39.26.35.14.6.3.86.56.26.26.42.51.56.86.1.27.23.66.26 1.39.03.79.04 1.03.04 3.03s-.01 2.24-.04 3.03c-.04.73-.16 1.12-.26 1.39a2.3 2.3 0 0 1-.56.86c-.26.26-.51.42-.86.56-.27.1-.66.23-1.39.26-.79.03-1.03.04-3.03.04s-2.24-.01-3.03-.04c-.73-.04-1.12-.16-1.39-.26a2.3 2.3 0 0 1-.86-.56 2.3 2.3 0 0 1-.56-.86c-.1-.27-.23-.66-.26-1.39C1.91 10.24 1.9 10 1.9 8s.01-2.24.04-3.03c.04-.73.16-1.12.26-1.39.14-.35.3-.6.56-.86.26-.26.51-.42.86-.56.27-.1.66-.23 1.39-.26C5.76 1.91 6 1.9 8 1.9Zm0 3.05a3.05 3.05 0 1 0 0 6.1 3.05 3.05 0 0 0 0-6.1Zm0 5.03a1.98 1.98 0 1 1 0-3.96 1.98 1.98 0 0 1 0 3.96Zm3.88-5.15a.71.71 0 1 1-1.42 0 .71.71 0 0 1 1.42 0Z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M8 1.6a6.4 6.4 0 0 0-2.02 12.47c.32.06.44-.14.44-.31v-1.2c-1.78.39-2.16-.75-2.16-.75-.29-.75-.71-.95-.71-.95-.58-.4.04-.39.04-.39.65.05.99.67.99.67.57.98 1.5.7 1.87.53.06-.42.22-.7.4-.86-1.42-.16-2.91-.71-2.91-3.17 0-.7.25-1.27.66-1.72-.07-.16-.29-.82.06-1.7 0 0 .54-.18 1.76.65a6.1 6.1 0 0 1 3.2 0c1.22-.83 1.76-.65 1.76-.65.35.88.13 1.54.06 1.7.41.45.66 1.02.66 1.72 0 2.47-1.5 3.01-2.92 3.17.23.2.43.58.43 1.18v1.75c0 .17.12.37.44.31A6.4 6.4 0 0 0 8 1.6Z" />
        </svg>
      );
  }
}

/* ------------------------------------------------------------- doodles --- */

/**
 * Hand-drawn faces used by the avatar pile and the sticker rail. Each is a
 * closed set of paths on a 56×56 grid so it can be dropped into any circle.
 */
export function DoodleFace({ variant, size = 56 }: { variant: number; size?: number }) {
  const s = { stroke: "#191918", strokeWidth: 2, strokeLinecap: "round" as const };
  const faces = [
    // 0 — wide grin
    <g key="0" {...s} fill="none">
      <circle cx="21" cy="24" r="2.4" fill="#191918" stroke="none" />
      <circle cx="35" cy="24" r="2.4" fill="#191918" stroke="none" />
      <path d="M20 33c2.6 3.4 5.2 5 8 5s5.4-1.6 8-5" />
    </g>,
    // 1 — winking
    <g key="1" {...s} fill="none">
      <path d="M17.5 24.5c1.6-2 3.4-2 5 0" />
      <circle cx="35" cy="24" r="2.4" fill="#191918" stroke="none" />
      <path d="M22 34c3.4 2.6 8.6 2.6 12 0" />
    </g>,
    // 2 — surprised
    <g key="2" {...s} fill="none">
      <circle cx="21" cy="23" r="2.6" fill="#191918" stroke="none" />
      <circle cx="35" cy="23" r="2.6" fill="#191918" stroke="none" />
      <ellipse cx="28" cy="35" rx="4" ry="5" />
    </g>,
    // 3 — sunglasses
    <g key="3" {...s} fill="none">
      <path d="M15 22h11v5.5a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3V22Zm15 0h11v5.5a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3V22Zm-4 1.5h4" />
      <path d="M22 36c3.4 2.4 8.6 2.4 12 0" />
    </g>,
    // 4 — content
    <g key="4" {...s} fill="none">
      <path d="M17.5 26c1.6-2.4 3.6-2.4 5.2 0M33.3 26c1.6-2.4 3.6-2.4 5.2 0" />
      <path d="M23 34.5c2.8 2 7.2 2 10 0" />
    </g>,
    // 5 — thinking
    <g key="5" {...s} fill="none">
      <circle cx="21" cy="25" r="2.4" fill="#191918" stroke="none" />
      <circle cx="35" cy="25" r="2.4" fill="#191918" stroke="none" />
      <path d="M22 35h9" />
      <path d="M32 17c2.5-2.5 6-2 7 0" />
    </g>,
    // 6 — cheer
    <g key="6" {...s} fill="none">
      <path d="M18 22.5 24 26l-6 3.5M38 22.5 32 26l6 3.5" />
      <path d="M21 33c2.8 4 11.2 4 14 0" />
    </g>,
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      aria-hidden="true"
    >
      {faces[variant % faces.length]}
    </svg>
  );
}

/** Rough marker squiggles / arrows that tie the stickers to the hero. */
export function Squiggle({ variant, width = 74 }: { variant: number; width?: number }) {
  const paths = [
    "M2 26C14 6 28 34 44 14c6-7 14-6 18 1",
    "M2 8c14 4 22 14 30 26 4 6 12 8 20 2",
    "M4 22c8-14 20-18 30-8 6 6 16 6 24-4",
  ];
  const arrowHeads = [
    "M56 12l6 3-2 6",
    "M46 38l6-2 1 6",
    "M52 10l6 0 0 6",
  ];
  return (
    <svg
      width={width}
      height={(width * 44) / 74}
      viewBox="0 0 74 44"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={paths[variant % paths.length]}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={arrowHeads[variant % arrowHeads.length]}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Abstract "connected app" glyphs for the badge pinned to each sticker.
 * Deliberately generic shapes rather than real third-party logos.
 */
export function AppGlyph({ variant, size = 16 }: { variant: number; size?: number }) {
  const glyphs = [
    <g key="a">
      <rect x="2" y="2" width="5" height="5" rx="1.5" fill="#097FE8" />
      <rect x="9" y="2" width="5" height="5" rx="1.5" fill="#93CDFE" />
      <rect x="2" y="9" width="5" height="5" rx="1.5" fill="#62AEF0" />
      <rect x="9" y="9" width="5" height="5" rx="1.5" fill="#005BAB" />
    </g>,
    <g key="b">
      <circle cx="8" cy="8" r="6" fill="#31302E" />
      <path d="M5.4 8.4 7.3 10.3l3.4-3.6" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </g>,
    <g key="c">
      <path d="M8 1.6 14 8l-6 6.4L2 8l6-6.4Z" fill="#0075DE" />
    </g>,
    <g key="d">
      <rect x="2" y="3.5" width="12" height="9" rx="2" fill="#F6F5F4" stroke="#A39E98" />
      <path d="m3 5 5 3.6L13 5" stroke="#615D59" strokeWidth="1.1" fill="none" />
    </g>,
    <g key="e">
      <circle cx="5.5" cy="8" r="3.5" fill="#93CDFE" />
      <circle cx="10.5" cy="8" r="3.5" fill="#097FE8" fillOpacity="0.8" />
    </g>,
    <g key="f">
      <rect x="2.5" y="2.5" width="11" height="11" rx="3" fill="#191918" />
      <path d="M8 5v6M5 8h6" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </g>,
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {glyphs[variant % glyphs.length]}
    </svg>
  );
}
