import type { SVGProps } from "react";

/**
 * The icon set — drawn here, not copied.
 *
 * `research/extracted/icons-svg-paths.json` holds 78 real glyphs from the
 * shipped product. It is used in this file for exactly one thing: to learn how
 * the set is *constructed*. Not one path string from it appears below. That is
 * this repository's rule — its sibling project redraws every game character
 * from code for the same reason — and it is why the brand marks are absent
 * from the dump in the first place (their entries are flagged `"brandLogo":
 * true` with the data stripped).
 *
 * ## What the dump teaches, and what is therefore true of every icon here
 *
 * * **`viewBox="0 0 24 24"`, rendered at 24×24, fill-only, `stroke: none`.**
 *   Every one of the 28 masthead/guide/chip glyphs measured this way. A
 *   stroked icon set is the wrong shape for this product: strokes scale badly
 *   and YouTube bakes its rounded terminals into the path with `a1 1 0 …`
 *   arcs instead, which is what the `rx` on the rectangles below is doing.
 * * **`fill` is inherited from `color`.** So every shape here is
 *   `fill="currentColor"` by inheritance and an icon takes the ink of whatever
 *   it sits in — which is the entire mechanism by which a Filled button's icon
 *   flips to near-black without anyone writing a rule.
 * * **There are three optical sizes, not one scaled size.** The chrome draws
 *   on a 24 grid; the watch action row draws on an **18** grid and renders at
 *   18 (the `MainstageIconSize` modifier); the player's play/pause alone uses
 *   a **36** grid. Redrawing at the target size rather than scaling one master
 *   is why YouTube's 18px glyphs do not look like shrunken 24px ones. The
 *   `size` prop here scales, which is honest for 20/24/40 but is *not* a
 *   substitute for the 18-grid redraw; that is noted where it matters.
 * * **The stroke weight of the drawing is 2 units at 24.** Rings are an outer
 *   radius and an inner radius 2 apart; bars are 2 tall with `rx: 1`. The one
 *   exception in the dump is the small `0 0 18 18` chevron, which is 1.5.
 *
 * ## Accessibility
 *
 * Every icon is `aria-hidden` and `focusable="false"` by default. Icons here
 * are decorative: the button, link or menu item around them carries the
 * accessible name. An icon that is the *only* content of a control needs an
 * `aria-label` on the control, and `Button`'s `iconOnly` mode says so.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /**
   * Rendered box, px. 24 is the chrome default; 18 is the watch action row;
   * 20 is the guide's compact contexts.
   */
  size?: number;
}

interface GlyphProps extends IconProps {
  children: SVGProps<SVGSVGElement>["children"];
  viewBox?: string;
}

function Glyph({
  size = 24,
  viewBox = "0 0 24 24",
  children,
  ...rest
}: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="currentColor"
      // `aria-hidden` and `focusable` together: IE-era `focusable` still
      // matters because an SVG inside a `<button>` picks up a tab stop in some
      // engines, which puts a second, unlabelled stop inside every icon button.
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------- masthead --- */

/**
 * The guide toggle.
 *
 * Three bars, 16 long and 2 thick with fully-rounded ends, at y = 5, 11, 17 —
 * so the gaps between them are 4, wider than the bars. That ratio is what
 * keeps the glyph from reading as a stack of lines at 24px.
 */
export function MenuIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="4" y="5" width="16" height="2" rx="1" />
      <rect x="4" y="11" width="16" height="2" rx="1" />
      <rect x="4" y="17" width="16" height="2" rx="1" />
    </Glyph>
  );
}

/**
 * Search.
 *
 * A 2-unit ring (r 8 outer, r 6 inner) centred at (11, 11), and a 2-thick
 * rounded handle laid along the 45° diagonal from inside the ring's lower
 * right. The handle starts *inside* the ring so the join has no seam at
 * fractional scales.
 */
export function SearchIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M11 3a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"
      />
      <rect
        x="15.8"
        y="15.3"
        width="7"
        height="2"
        rx="1"
        transform="rotate(45 15.8 15.3)"
      />
    </Glyph>
  );
}

/** Voice search: a 6×12 capsule in a U-shaped cradle, on a stem and a base. */
export function MicIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a1 1 0 0 1 1 1 6 6 0 0 0 12 0 1 1 0 1 1 2 0 8 8 0 0 1-7 7.94V21h2.5a1 1 0 1 1 0 2h-7a1 1 0 1 1 0-2H11v-2.06A8 8 0 0 1 4 11a1 1 0 0 1 1-1Z" />
    </Glyph>
  );
}

/** The overflow control. Three r-2 dots, 7 apart. */
export function MoreVerticalIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </Glyph>
  );
}

export function MoreHorizontalIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </Glyph>
  );
}

/**
 * Account.
 *
 * Three separate elements — an r-10 ring, a solid r-3 head, and a shoulders
 * cap — rather than one `evenodd` path with the head and shoulders nested
 * inside the ring. The nested version is shorter and it is the version that
 * goes subtly wrong: whether a shoulder arc bulges up or down depends on an
 * arc's sweep flag, and getting that backwards produces a shape that still
 * parses and still looks like *something*. Three elements each have one
 * unambiguous winding.
 *
 * Rendered at **18** in the masthead (measured), not 24.
 */
export function AccountIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z"
      />
      <circle cx="12" cy="10" r="3" />
      <path d="M12 14.5a6.5 6.5 0 0 0-5.6 3.2 8 8 0 0 0 11.2 0 6.5 6.5 0 0 0-5.6-3.2Z" />
    </Glyph>
  );
}

/** Notifications. Bell body with a separate clapper so the two never merge. */
export function BellIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M12 2a6 6 0 0 0-6 6v4.38l-1.85 3.16A1 1 0 0 0 5 17h14a1 1 0 0 0 .85-1.46L18 12.38V8a6 6 0 0 0-6-6Zm0 2a4 4 0 0 1 4 4v4.65l1.1 1.85H6.9L8 12.65V8a4 4 0 0 1 4-4Z"
      />
      <path d="M9.5 19h5a2.5 2.5 0 0 1-5 0Z" />
    </Glyph>
  );
}

/**
 * Settings, as a gear.
 *
 * Eight teeth on a 45° rotation plus a 2-unit ring. Written as eight
 * transformed rectangles rather than one enormous path: the path would be
 * unreadable and unmaintainable, and the dump shows YouTube itself using four
 * separate paths where a glyph has repeated parts.
 */
export function GearIcon(props: IconProps) {
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <Glyph {...props}>
      {teeth.map((angle) => (
        <rect
          key={angle}
          x="10.4"
          y="1.4"
          width="3.2"
          height="4.2"
          rx="1"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      <path
        fillRule="evenodd"
        d="M12 4.6a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8Zm0 2a5.4 5.4 0 1 1 0 10.8 5.4 5.4 0 0 1 0-10.8Z"
      />
      <circle cx="12" cy="12" r="2.6" />
    </Glyph>
  );
}

/* ---------------------------------------------------------------- guide --- */

/**
 * Home.
 *
 * An outlined house with a 4-wide door, which is how the measured glyph is
 * described. The roof apex is rounded by the two 1-unit arcs at the eaves
 * rather than by a `stroke-linejoin`, following the set's convention.
 */
export function HomeIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M12 2.3 2.4 8.7a1 1 0 0 0 1.1 1.66l.5-.33V20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9.97l.5.33a1 1 0 0 0 1.1-1.66L12 2.3Zm0 2.4 6 4V20H6V8.7l6-4Z"
      />
      <path d="M10 13h4v9h-4z" />
    </Glyph>
  );
}

/**
 * Shorts.
 *
 * A capsule 10.4 across and 20.4 along its axis, tilted 30° off vertical, with
 * an upright play triangle knocked out of it. The tilt is the whole glyph: an
 * untilted capsule with a triangle in it is the Subscriptions icon.
 *
 * The capsule is written as two arcs and two straight sides at pre-rotated
 * coordinates instead of a `transform`, because the triangle must stay upright
 * — a `<g transform>` would rotate both, and a knockout cannot cross a group
 * boundary.
 */
export function ShortsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M10 5.07A5.2 5.2 0 0 1 19 10.27L14 18.93A5.2 5.2 0 0 1 5 13.73L10 5.07ZM9.6 7.4v9.2l8-4.6-8-4.6Z"
      />
    </Glyph>
  );
}

/** Subscriptions: a screen outline under a shelf bar, with a play triangle. */
export function SubscriptionsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="5" y="2" width="14" height="2" rx="1" />
      <path
        fillRule="evenodd"
        d="M3 6h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm0 2v12h18V8H3Z"
      />
      <path d="M10 10.3v7.4l6.4-3.7-6.4-3.7Z" />
    </Glyph>
  );
}

/**
 * History: a clock ring broken at eleven o'clock, with the arrowhead that
 * turns the break into an anticlockwise rewind, plus the hands.
 */
export function HistoryIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3a9 9 0 1 0 8.95 9.75 1 1 0 1 1 1.99.16A11 11 0 1 1 12 1a10.95 10.95 0 0 1 7 2.52V2.5a1 1 0 1 1 2 0V7a1 1 0 0 1-1 1h-4.5a1 1 0 1 1 0-2h2.14A8.95 8.95 0 0 0 12 3Z" />
      <path d="M12 6a1 1 0 0 1 1 1v4.42l3.4 1.96a1 1 0 1 1-1 1.74l-3.9-2.25A1 1 0 0 1 11 12V7a1 1 0 0 1 1-1Z" />
    </Glyph>
  );
}

/** Shopping: a bag with the handle arc breaking its top edge. */
export function ShoppingIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M8 6.5V6a4 4 0 1 1 8 0v.5h3a2 2 0 0 1 2 2V19a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8.5a2 2 0 0 1 2-2h3Zm2 0h4V6a2 2 0 1 0-4 0v.5Zm-5 2V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5H5Z"
      />
    </Glyph>
  );
}

/**
 * Music: a beamed pair of notes.
 *
 * The two stems and the beam are one path; the note heads are two circles.
 * Same reasoning as {@link AccountIcon} — a head drawn as an arc inside the
 * stem's own subpath is where a hand-written path silently inverts.
 */
export function MusicIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M20.2 2.42A1 1 0 0 1 21 3.4v13.1h-2V7.72l-8 1.6v9.18H9V6.5a1 1 0 0 1 .8-.98l9.4-1.88a1 1 0 0 1 1-.02ZM19 3.4v2.28l-8 1.6V5l8-1.6Z" />
      <circle cx="7" cy="18.5" r="3" />
      <circle cx="17" cy="16.5" r="3" />
    </Glyph>
  );
}

/** Movies & TV: a film frame with sprocket strips down both edges. */
export function FilmIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M3 3h18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 2v14h10V5H7ZM3 5v2h2V5H3Zm0 4v2h2V9H3Zm0 4v2h2v-2H3Zm0 4v2h2v-2H3Zm16-12v2h2V5h-2Zm0 4v2h2V9h-2Zm0 4v2h2v-2h-2Zm0 4v2h2v-2h-2Z"
      />
    </Glyph>
  );
}

/** Report history: a flag on a 2-unit pole with a rounded cap. */
export function FlagIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M4 2a1 1 0 0 1 1 1v.28A9 9 0 0 1 15 4.1a7 7 0 0 0 5.5.6A1 1 0 0 1 22 5.66v9a1 1 0 0 1-.6.92 9 9 0 0 1-7.4-.7 7 7 0 0 0-9-.06V22a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm1 3.7v6.65a9 9 0 0 1 9.9.53 7 7 0 0 0 5.1.7V6.85a9 9 0 0 1-6.9-1.04 7 7 0 0 0-8.1-.11Z"
      />
    </Glyph>
  );
}

/* ------------------------------------------------------------ direction --- */

/**
 * The chevron, drawn once pointing down and rotated for the other three.
 *
 * 2.2 units thick with rounded ends and a rounded apex — the measured glyph
 * has an apex at (12, 16.9) with a 1-unit arc, so the point is soft rather
 * than mitred. The `0 0 18 18` variant in the dump is drawn at 1.5 rather than
 * scaled from this one; a caller needing that weight should not just pass
 * `size={18}`.
 */
function chevronRotation(direction: "up" | "down" | "left" | "right"): number {
  return { down: 0, left: 90, up: 180, right: 270 }[direction];
}

export function ChevronIcon({
  direction = "down",
  ...props
}: IconProps & { direction?: "up" | "down" | "left" | "right" }) {
  return (
    <Glyph {...props}>
      <path
        transform={`rotate(${chevronRotation(direction)} 12 12)`}
        d="M4.92 8.52a1.1 1.1 0 0 1 1.56 0L12 14.04l5.52-5.52a1.1 1.1 0 1 1 1.56 1.56l-6.3 6.3a1.1 1.1 0 0 1-1.56 0l-6.3-6.3a1.1 1.1 0 0 1 0-1.56Z"
      />
    </Glyph>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5.4 5.4a1.1 1.1 0 0 1 1.56 0L12 10.44l5.04-5.04a1.1 1.1 0 1 1 1.56 1.56L13.56 12l5.04 5.04a1.1 1.1 0 0 1-1.56 1.56L12 13.56 6.96 18.6a1.1 1.1 0 0 1-1.56-1.56L10.44 12 5.4 6.96a1.1 1.1 0 0 1 0-1.56Z" />
    </Glyph>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M20.28 6.32a1.1 1.1 0 0 1 0 1.56l-10.2 10.2a1.1 1.1 0 0 1-1.56 0L3.72 13.28a1.1 1.1 0 1 1 1.56-1.56l4.02 4.02 9.42-9.42a1.1 1.1 0 0 1 1.56 0Z" />
    </Glyph>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3.5a1.1 1.1 0 0 1 1.1 1.1v6.3h6.3a1.1 1.1 0 1 1 0 2.2h-6.3v6.3a1.1 1.1 0 1 1-2.2 0v-6.3H4.6a1.1 1.1 0 1 1 0-2.2h6.3V4.6A1.1 1.1 0 0 1 12 3.5Z" />
    </Glyph>
  );
}

/* ----------------------------------------------------------- watch row --- */

/**
 * The watch action row's glyphs.
 *
 * These render at **18×18** in the product (`icons-svg-paths.json`,
 * `scope: "watchActions"`), which is the `MainstageIconSize` modifier on the
 * button. They are drawn on the 24 grid here like everything else and scaled,
 * which is a deliberate, stated compromise: redrawing a second 18-grid master
 * per glyph is the fidelity-correct answer and is not work this slice can
 * justify before a surface exists that shows the difference.
 */
const THUMB_ARM = "M2.5 9.5h4a.5.5 0 0 1 .5.5v9.5a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5V10a.5.5 0 0 1 .5-.5Z";
const THUMB_HAND =
  "M13.35 2a1 1 0 0 1 .96.72l.36 1.24a5.5 5.5 0 0 1-.44 4.14L13.7 9.5H19a3 3 0 0 1 2.94 3.6l-1 5A3 3 0 0 1 18 20.5H9.5a.5.5 0 0 1-.5-.5v-9.6a1 1 0 0 1 .3-.71l2.62-2.62a2.5 2.5 0 0 0 .7-2.13L12.36 3a1 1 0 0 1 .99-1Z";

/**
 * Two elements, not one path: a 4.5-wide arm and the hand.
 *
 * The real glyph is a single path, but a single path here means the arm has to
 * be joined to the hand with a notch, and the notch is what makes a hand-drawn
 * thumb look like a mitten.
 */
export function ThumbUpIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d={THUMB_ARM} />
      <path d={THUMB_HAND} />
    </Glyph>
  );
}

/** The same drawing, rotated. Which is also what the product does. */
export function ThumbDownIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <g transform="rotate(180 12 12)">
        <path d={THUMB_ARM} />
        <path d={THUMB_HAND} />
      </g>
    </Glyph>
  );
}

/** Share: an arrow leaving a tray to the right. */
export function ShareIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M14.3 3.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 0 1-1.7-.7v-2.94c-3.63.2-6.4 1.6-8.5 4.4a1 1 0 0 1-1.8-.6c0-5.7 4.3-9.9 10.3-10.4V4a1 1 0 0 1 .3-.7Zm1.7 3.11V8a1 1 0 0 1-1 1c-4.32 0-7.5 2.2-8.63 5.62A13.4 13.4 0 0 1 15 11.98a1 1 0 0 1 1 1v1.61L19.59 11 16 6.41Z" />
    </Glyph>
  );
}

/** Save to playlist: a list whose last row is replaced by a plus. */
export function SaveIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="2" y="5" width="16" height="2" rx="1" />
      <rect x="2" y="11" width="16" height="2" rx="1" />
      <rect x="2" y="17" width="9" height="2" rx="1" />
      <path d="M18 13a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2h-2a1 1 0 1 1 0-2h2v-2a1 1 0 0 1 1-1Z" />
    </Glyph>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 2.5a1 1 0 0 1 1 1v10.09l3.3-3.3a1 1 0 0 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3.5a1 1 0 0 1 1-1Z" />
      <rect x="3.5" y="19" width="17" height="2" rx="1" />
    </Glyph>
  );
}

/**
 * The verified tick.
 *
 * Rendered at **14×14** inside the card's 20px metadata row and inheriting the
 * row's secondary grey — it is not a blue badge on this surface.
 */
export function VerifiedIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.42 7.36-5.6 6.4a1 1 0 0 1-1.46.05l-2.8-2.8a1 1 0 1 1 1.42-1.42l2.04 2.05 4.9-5.6a1 1 0 1 1 1.5 1.32Z"
      />
    </Glyph>
  );
}

/** The comments sort control: three rules of decreasing length. */
export function SortIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="6" width="18" height="2" rx="1" />
      <rect x="6" y="11" width="12" height="2" rx="1" />
      <rect x="9" y="16" width="6" height="2" rx="1" />
    </Glyph>
  );
}

/* --------------------------------------------------------------- player --- */

/**
 * Play and pause.
 *
 * The only glyphs in the product drawn on a **36** grid, rendered 36×36 — a
 * genuinely different optical size, not a scale of the 24 pair. They are
 * declared with that viewBox here for the same reason.
 */
export function PlayIcon({ size = 36, ...props }: IconProps) {
  return (
    <Glyph size={size} viewBox="0 0 36 36" {...props}>
      <path d="M12 8.4a1 1 0 0 1 1.52-.85l14.4 8.85a1.4 1.4 0 0 1 0 2.39l-14.4 8.85A1 1 0 0 1 12 26.8V8.4Z" />
    </Glyph>
  );
}

export function PauseIcon({ size = 36, ...props }: IconProps) {
  return (
    <Glyph size={size} viewBox="0 0 36 36" {...props}>
      <rect x="11" y="8" width="5" height="20" rx="1.5" />
      <rect x="20" y="8" width="5" height="20" rx="1.5" />
    </Glyph>
  );
}

/** The small play triangle used inside badges and thumbnails, on the 24 grid. */
export function PlaySmallIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M7 4.6a1 1 0 0 1 1.51-.86l11.4 6.99a1.4 1.4 0 0 1 0 2.39l-11.4 6.99A1 1 0 0 1 7 19.24V4.6Z" />
    </Glyph>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12.4 3.08a1 1 0 0 1 .6.92v16a1 1 0 0 1-1.65.76L6.13 16.4H3a1 1 0 0 1-1-1v-6.8a1 1 0 0 1 1-1h3.13l5.22-4.36a1 1 0 0 1 1.05-.16Z" />
      <path d="M16.24 7.76a1 1 0 0 1 1.42 0 6 6 0 0 1 0 8.48 1 1 0 0 1-1.42-1.41 4 4 0 0 0 0-5.66 1 1 0 0 1 0-1.41Z" />
      <path d="M19.07 4.93a1 1 0 0 1 1.41 0 10 10 0 0 1 0 14.14 1 1 0 0 1-1.41-1.41 8 8 0 0 0 0-11.32 1 1 0 0 1 0-1.41Z" />
    </Glyph>
  );
}

export function VolumeMutedIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12.4 3.08a1 1 0 0 1 .6.92v16a1 1 0 0 1-1.65.76L6.13 16.4H3a1 1 0 0 1-1-1v-6.8a1 1 0 0 1 1-1h3.13l5.22-4.36a1 1 0 0 1 1.05-.16Z" />
      <path d="M16.3 8.7a1 1 0 0 1 1.4 0l1.8 1.8 1.8-1.8a1 1 0 1 1 1.4 1.4L20.9 12l1.8 1.8a1 1 0 0 1-1.4 1.4l-1.8-1.8-1.8 1.8a1 1 0 0 1-1.4-1.4l1.8-1.8-1.8-1.8a1 1 0 0 1 0-1.4Z" />
    </Glyph>
  );
}

/** Subtitles: a rounded frame with two caption rules inside it. */
export function CaptionsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M3 4h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v12h18V6H3Z"
      />
      <rect x="4.5" y="9" width="7" height="2" rx="1" />
      <rect x="13" y="9" width="6.5" height="2" rx="1" />
      <rect x="4.5" y="13" width="5" height="2" rx="1" />
      <rect x="11" y="13" width="8.5" height="2" rx="1" />
    </Glyph>
  );
}

/** Theatre mode: a wide frame inset top and bottom. */
export function TheaterIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        d="M2 6h20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm1 2v8h18V8H3Z"
      />
    </Glyph>
  );
}

/**
 * Fullscreen and its inverse: four corner brackets, each 2 thick.
 *
 * Four separate `<path>` elements rather than four subpaths of one. Each
 * bracket is an independent L, and four L-shaped subpaths in a single path
 * only fill correctly if all four happen to be wound the same way under the
 * default `nonzero` rule — which is true here but is a property of the
 * coordinates rather than of the drawing, and is silently lost the next time
 * someone edits one of them.
 */
export function FullscreenIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 3h7v2H5v5H3V3Z" />
      <path d="M14 3h7v7h-2V5h-5V3Z" />
      <path d="M3 14h2v5h5v2H3v-7Z" />
      <path d="M19 14h2v7h-7v-2h5v-5Z" />
    </Glyph>
  );
}

export function FullscreenExitIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M10 3h2v7H3V8h7V3Z" />
      <path d="M14 3h2v5h5v2h-7V3Z" />
      <path d="M3 14h7v7H8v-5H3v-2Z" />
      <path d="M14 14h7v2h-5v5h-2v-7Z" />
    </Glyph>
  );
}

/* ---------------------------------------------------------------- brand --- */

/**
 * The product mark.
 *
 * **Drawn here; YouTube's wordmark is not reproduced.** The captured logo
 * (`viewBox="0 0 93 20"`, nine paths) was deliberately not stored in the
 * research dump for exactly this reason, and it would not be used if it had
 * been. What is kept from the measurement is the *lockup metrics* — the badge
 * is a rounded rectangle roughly 4:3 with a centred play triangle, and the
 * whole logo occupies a 93×20 box inside a 129×56 slot in the masthead — and
 * the brand red `#f03`, which is a colour value rather than a mark.
 *
 * The badge below is an original construction and is deliberately *not* the
 * captured silhouette: a plain 28×20 rounded rectangle at radius 6 with a
 * centred play triangle knocked out by `evenodd`, so the triangle takes
 * whatever is behind the mark rather than a hard-coded white. The real badge's
 * outline is a squircle with concave sides — recognisable, and therefore the
 * one thing not to redraw from.
 */
export function PlayBadgeIcon({ size = 20, ...props }: IconProps) {
  return (
    <Glyph size={size} viewBox="0 0 28 20" {...props}>
      <path
        fillRule="evenodd"
        d="M6 0h16a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6Zm5 5.6v8.8L18.6 10 11 5.6Z"
      />
    </Glyph>
  );
}
