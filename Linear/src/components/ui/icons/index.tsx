import type { ReactNode, SVGProps } from "react";

import { cn } from "@/lib/cn";

/**
 * The app's glyph set.
 *
 * Small on purpose. Every icon here earns its place by appearing in the chrome
 * of a screen this project actually ships, and most of them are **transcribed
 * from Linear's own rendered SVG** — the 55 inline glyphs the visual-research
 * lane captured off the issue list and issue detail views live in
 * `research/extracted/app-svgs-issue-detail.json` and
 * `research/extracted/app-list-measurements.json`. Where a path below is
 * verbatim, its doc comment says so; where it is drawn to match, it says that
 * instead.
 *
 * ## Why not an icon library
 *
 * `lucide-react` is in the dependency tree and would cover most of this list.
 * It is not used because Linear's glyphs are not Lucide's: Lucide draws
 * 24×24 **strokes** at 2px on a 1px grid, and Linear draws 16×16 **fills** with
 * 0.75-unit rounded terminals. Mixing the two families is instantly visible —
 * the stroked icons read thin and large next to Linear's dense little fills,
 * and no amount of `size`/`strokeWidth` tuning fixes the difference in
 * construction. Sixteen hand-placed paths cost less than the mismatch.
 *
 * ## Conventions
 *
 * - `viewBox="0 0 16 16"`, `fill="currentColor"`, so an icon inherits the
 *   colour of the control it sits in — Linear's own `Icon` wrapper defaults to
 *   `size=16` and the muted label grey, which is what `text-tertiary` gives.
 * - **No accessible name by default.** An icon in a button is decorative; the
 *   button carries the name. Pass `title` on the rare standalone icon and it
 *   becomes `role="img"` with a `<title>` child instead of `aria-hidden`.
 * - Chevrons are one path plus a `rotate` transform rather than four traced
 *   paths, so the four directions cannot drift apart.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Rendered size in CSS pixels. 16 is Linear's `_iconNormal`; 14 is compact. */
  size?: number;
  /**
   * Accessible name.
   *
   * Supplying it flips the glyph from `aria-hidden` to `role="img"`. Do that
   * only when the icon is the *sole* content of a control, and never when a
   * visible text label already says the same thing.
   */
  title?: string;
}

function createIcon(
  displayName: string,
  body: ReactNode,
  viewBox = "0 0 16 16",
) {
  function Icon({ size = 16, title, className, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("shrink-0", className)}
        role={title ? "img" : undefined}
        aria-hidden={title ? undefined : true}
        focusable="false"
        {...rest}
      >
        {title ? <title>{title}</title> : null}
        {body}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

/* ------------------------------------------------------------ navigation -- */

/** Verbatim from Linear's search field. A 5-unit lens with a 45° handle. */
export const SearchIcon = createIcon(
  "SearchIcon",
  <path d="M7 2C9.76142 2 12 4.23858 12 7C12 8.11012 11.6375 9.13519 11.0254 9.96484L13.7803 12.7197L13.832 12.7764C14.0723 13.0709 14.0549 13.5057 13.7803 13.7803C13.5057 14.0549 13.0709 14.0723 12.7764 13.832L12.7197 13.7803L9.96484 11.0254C9.13519 11.6375 8.11012 12 7 12C4.23858 12 2 9.76142 2 7C2 4.23858 4.23858 2 7 2ZM7 3.5C5.067 3.5 3.5 5.067 3.5 7C3.5 8.933 5.067 10.5 7 10.5C8.933 10.5 10.5 8.933 10.5 7C10.5 5.067 8.933 3.5 7 3.5Z" />,
);

/** Verbatim. The sloped-sided tray with the two notches that Linear uses for Inbox. */
export const InboxIcon = createIcon(
  "InboxIcon",
  <path
    fillRule="evenodd"
    d="M11.0069 1.00879C12.0235 1.09224 12.8967 1.78967 13.1944 2.78027L14.8907 8.42871C15.0034 8.80411 15.0258 9.20103 14.9571 9.58691L14.5069 12.1143L14.4375 12.4219C14.0542 13.8306 12.8312 14.8559 11.378 14.9863L11.0625 15H4.92875L4.6143 14.9863C3.16087 14.8561 1.93819 13.8307 1.55473 12.4219L1.48539 12.1143L1.03422 9.58691C0.974045 9.24914 0.984493 8.90311 1.06352 8.57031L1.1016 8.42871L2.79691 2.78027C3.09453 1.78948 3.96862 1.09214 4.98539 1.00879L5.19047 1H10.8018L11.0069 1.00879ZM2.96098 11.8516C3.13119 12.8053 3.96043 13.4999 4.92875 13.5H11.0625C12.031 13.5 12.8611 12.8054 13.0313 11.8516L13.2715 10.5H11.6211C11.2249 10.5 10.8512 10.6738 10.5957 10.9697L10.4932 11.1035C10.1201 11.6634 9.49195 11.9999 8.81938 12H7.17191C6.54154 11.9998 5.95019 11.7042 5.57133 11.2061L5.49809 11.1035C5.24687 10.7266 4.82396 10.5 4.37113 10.5H2.71977L2.96098 11.8516ZM5.19047 2.5C4.80433 2.50005 4.45748 2.72173 4.29203 3.06055L4.23246 3.21191L2.53715 8.86035C2.5234 8.90613 2.514 8.95293 2.50688 9H4.37113C5.32524 9.00001 6.21689 9.47715 6.74613 10.2715L6.78422 10.3223C6.88083 10.4341 7.02214 10.4998 7.17191 10.5H8.81938C8.99076 10.4999 9.15106 10.4142 9.24613 10.2715L9.34965 10.126C9.88713 9.41919 10.7268 9 11.6211 9H13.4854C13.4785 8.95295 13.4689 8.90616 13.4551 8.86035L11.7588 3.21191C11.6318 2.78947 11.2427 2.50018 10.8018 2.5H5.19047Z"
  />,
);

/**
 * Issues.
 *
 * Drawn, not transcribed: Linear's per-team "Issues" nav glyph was not among
 * the captured SVGs. A 1.5-weight ring with a filled core, which reads as a
 * status mark without being one — the family resemblance is the point, since
 * the nav item leads to a list of exactly those marks.
 */
export const IssuesIcon = createIcon(
  "IssuesIcon",
  <>
    <circle
      cx={8}
      cy={8}
      r={6.25}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    />
    <circle cx={8} cy={8} r={2.25} />
  </>,
);

/**
 * Projects.
 *
 * Linear's own project mark, with the `+` subpath dropped — the captured glyph
 * came from an "Add to project" affordance, where the plus is the *action*
 * rather than the noun. What remains is the isometric solid over its shadow
 * layer, which is the icon proper.
 */
export const ProjectsIcon = createIcon(
  "ProjectsIcon",
  <>
    <path d="M6.97358 1.34476C7.57022 0.885624 8.41055 0.885024 9.00788 1.3433L14.5499 5.59521C15.15 6.05565 15.15 6.94435 14.5499 7.40478L9.00788 11.6567C8.41055 12.115 7.57022 12.1144 6.97358 11.6552L1.44875 7.40374C0.850417 6.94331 0.850415 6.05669 1.44875 5.59625L6.97358 1.34476Z" />
    <path d="M1.15024 9.79849C1.39408 9.46375 1.84872 9.40113 2.16572 9.65862L6.50981 12.9949C7.29068 13.6292 8.37801 13.6292 9.15888 12.9949L13.8344 9.65862C14.1513 9.40113 14.606 9.46375 14.8498 9.79849C15.0937 10.1332 15.0344 10.6133 14.7174 10.8708L10.0419 14.2071C8.74045 15.2643 6.92824 15.2643 5.62678 14.2071L1.28269 10.8708C0.965698 10.6133 0.906397 10.1332 1.15024 9.79849Z" />
  </>,
);

/** Verbatim. Linear's stacked-planes "Views" mark. */
export const ViewsIcon = createIcon(
  "ViewsIcon",
  <>
    <path
      fillRule="evenodd"
      d="M6.93213 2.21398C7.66484 1.90793 8.49512 1.93032 9.21389 2.28028L14.28 4.74739C15.2242 5.20709 15.2441 6.55895 14.3138 7.04673L9.2874 9.6826C8.48012 10.1058 7.51988 10.1058 6.7126 9.6826L1.68618 7.04673C0.75589 6.55895 0.775786 5.20709 1.71995 4.74739L6.78611 2.28028L6.93213 2.21398ZM8.55132 3.67054C8.24643 3.52213 7.89768 3.50303 7.58179 3.61428L7.44868 3.67054L2.83947 5.91363L7.41491 8.31243C7.7819 8.50486 8.2181 8.50486 8.58509 8.31243L13.1595 5.91363L8.55132 3.67054Z"
    />
    <path d="M13.9045 10.0768C14.272 9.90435 14.7242 10.0333 14.9153 10.365C15.1063 10.6966 14.9634 11.1047 14.5959 11.2772L9.49912 13.6693C8.55934 14.1102 7.44077 14.1102 6.50099 13.6693L1.40417 11.2772L1.33776 11.2428C1.01976 11.0547 0.905685 10.676 1.08483 10.365C1.26402 10.054 1.67295 9.92085 2.02626 10.0477L2.0956 10.0768L7.19241 12.468L7.38675 12.5464C7.84801 12.7022 8.36492 12.6757 8.80769 12.468L13.9045 10.0768Z" />
  </>,
);

/** Verbatim. */
export const HomeIcon = createIcon(
  "HomeIcon",
  <path d="M2.75 14.25V6.48a.75.75 0 0 1 .242-.553l4.5-4.136a.75.75 0 0 1 1.016 0l4.5 4.136a.75.75 0 0 1 .242.553v7.77h-3.5v-3.267a1.75 1.75 0 0 0-3.5 0v3.267h-3.5Z" />,
);

/**
 * Settings.
 *
 * Drawn. A 12-unit ring with eight 1.5×2.5 teeth on 45° centres and a 4-unit
 * bore — the classic gear, built from primitives rather than one traced path so
 * the teeth stay on their axis at every rendered size.
 */
export const SettingsIcon = createIcon(
  "SettingsIcon",
  <>
    {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
      <rect
        key={angle}
        x={7.25}
        y={0.75}
        width={1.5}
        height={3}
        rx={0.75}
        transform={`rotate(${angle} 8 8)`}
      />
    ))}
    <circle
      cx={8}
      cy={8}
      r={4.75}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    />
    <circle
      cx={8}
      cy={8}
      r={1.75}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    />
  </>,
);

/* --------------------------------------------------------------- actions -- */

/** Verbatim. A 0.75-weight cross, terminals at x/y 4 and 12. */
export const PlusIcon = createIcon(
  "PlusIcon",
  <path d="M8.75 4C8.75 3.58579 8.41421 3.25 8 3.25C7.58579 3.25 7.25 3.58579 7.25 4V7.25H4C3.58579 7.25 3.25 7.58579 3.25 8C3.25 8.41421 3.58579 8.75 4 8.75H7.25V12C7.25 12.4142 7.58579 12.75 8 12.75C8.41421 12.75 8.75 12.4142 8.75 12V8.75H12C12.4142 8.75 12.75 8.41421 12.75 8C12.75 7.58579 12.4142 7.25 12 7.25H8.75V4Z" />,
);

/** Verbatim, from the toast dismiss button. */
export const CloseIcon = createIcon(
  "CloseIcon",
  <path d="M2.96967 2.96967C3.26256 2.67678 3.73744 2.67678 4.03033 2.96967L8 6.939L11.9697 2.96967C12.2626 2.67678 12.7374 2.67678 13.0303 2.96967C13.3232 3.26256 13.3232 3.73744 13.0303 4.03033L9.061 8L13.0303 11.9697C13.2966 12.2359 13.3208 12.6526 13.1029 12.9462L13.0303 13.0303C12.7374 13.3232 12.2626 13.3232 11.9697 13.0303L8 9.061L4.03033 13.0303C3.73744 13.3232 3.26256 13.3232 2.96967 13.0303C2.67678 12.7374 2.67678 12.2626 2.96967 11.9697L6.939 8L2.96967 4.03033C2.7034 3.76406 2.6792 3.3474 2.89705 3.05379L2.96967 2.96967Z" />,
);

/** Verbatim. The dividing rule between "no value" and a partial selection. */
export const MinusIcon = createIcon(
  "MinusIcon",
  <path d="M3.25 8C3.25 7.58579 3.58579 7.25 4 7.25H12C12.4142 7.25 12.75 7.58579 12.75 8C12.75 8.41421 12.4142 8.75 12 8.75H4C3.58579 8.75 3.25 8.41421 3.25 8Z" />,
);

/**
 * Verbatim, from Linear's 14×14 Done glyph.
 *
 * Kept in its own 14 box rather than rescaled into 16 — the viewBox does the
 * scaling exactly, and re-deriving the control points by hand would introduce
 * rounding into a shape that is already correct.
 */
export const CheckIcon = createIcon(
  "CheckIcon",
  <path d="M10.951 4.24896C11.283 4.58091 11.283 5.11909 10.951 5.45104L5.95104 10.451C5.61909 10.783 5.0809 10.783 4.74896 10.451L2.74896 8.45104C2.41701 8.11909 2.41701 7.5809 2.74896 7.24896C3.0809 6.91701 3.61909 6.91701 3.95104 7.24896L5.35 8.64792L9.74896 4.24896C10.0809 3.91701 10.6191 3.91701 10.951 4.24896Z" />,
  "0 0 14 14",
);

/** Verbatim. Three 1.5-radius dots — the universal "more" affordance. */
export const MoreHorizontalIcon = createIcon(
  "MoreHorizontalIcon",
  <path d="M3 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />,
);

/* ------------------------------------------------------------- chevrons --- */

const CHEVRON_PATH =
  "M4.53 5.47a.75.75 0 0 0-1.06 1.06l4 4a.75.75 0 0 0 1.054.007l4-3.903a.75.75 0 0 0-1.048-1.073l-3.47 3.385L4.53 5.47Z";

/** Verbatim. The other three directions are this one, rotated. */
export const ChevronDownIcon = createIcon(
  "ChevronDownIcon",
  <path d={CHEVRON_PATH} />,
);

export const ChevronUpIcon = createIcon(
  "ChevronUpIcon",
  <path d={CHEVRON_PATH} transform="rotate(180 8 8)" />,
);

export const ChevronRightIcon = createIcon(
  "ChevronRightIcon",
  <path d={CHEVRON_PATH} transform="rotate(-90 8 8)" />,
);

export const ChevronLeftIcon = createIcon(
  "ChevronLeftIcon",
  <path d={CHEVRON_PATH} transform="rotate(90 8 8)" />,
);

/* ------------------------------------------------- list & view controls --- */

/** Verbatim. Three descending rules — 12.5, 7.5 and 2.5 units wide. */
export const FilterIcon = createIcon(
  "FilterIcon",
  <path d="M14.25 3a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5h12.5ZM4 8a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 8Zm2.75 3.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" />,
);

/** Verbatim. Linear's display-options control: two rails with a knob on each. */
export const SlidersIcon = createIcon(
  "SlidersIcon",
  <>
    <path
      fillRule="evenodd"
      d="M7 2.5C8.11933 2.5 9.06613 3.23584 9.38477 4.25H14.75C15.1642 4.25 15.5 4.58579 15.5 5C15.5 5.41421 15.1642 5.75 14.75 5.75H9.38477C9.06613 6.76416 8.11933 7.5 7 7.5C5.88067 7.5 4.93387 6.76416 4.61523 5.75H2.25C1.83579 5.75 1.5 5.41421 1.5 5C1.5 4.58579 1.83579 4.25 2.25 4.25H4.61523C4.93387 3.23584 5.88067 2.5 7 2.5ZM7 4C6.44772 4 6 4.44772 6 5C6 5.55228 6.44772 6 7 6C7.55228 6 8 5.55228 8 5C8 4.44772 7.55228 4 7 4Z"
    />
    <path
      fillRule="evenodd"
      d="M10 13.5C8.88067 13.5 7.93387 12.7642 7.61523 11.75H2.25C1.83579 11.75 1.5 11.4142 1.5 11C1.5 10.5858 1.83579 10.25 2.25 10.25H7.61523C7.93387 9.23584 8.88067 8.5 10 8.5C11.1193 8.5 12.0661 9.23584 12.3848 10.25H14.75C15.1642 10.25 15.5 10.5858 15.5 11C15.5 11.4142 15.1642 11.75 14.75 11.75H12.3848C12.0661 12.7642 11.1193 13.5 10 13.5ZM10 12C10.5523 12 11 11.5523 11 11C11 10.4477 10.5523 10 10 10C9.44772 10 9 10.4477 9 11C9 11.5523 9.44772 12 10 12Z"
    />
  </>,
);

/** Verbatim, from the due-date pill in the issue list. */
export const CalendarIcon = createIcon(
  "CalendarIcon",
  <path
    fillRule="evenodd"
    d="M11 1C13.2091 1 15 2.79086 15 5V11C15 13.2091 13.2091 15 11 15H5C2.79086 15 1 13.2091 1 11V5C1 2.79086 2.79086 1 5 1H11ZM13.5 6H2.5V11C2.5 12.3807 3.61929 13.5 5 13.5H11C12.3807 13.5 13.5 12.3807 13.5 11V6Z"
  />,
);

/**
 * The chain link behind "Copy link".
 *
 * The lower arm is verbatim from Linear's captured glyph; the upper arm is its
 * 180° mirror about the centre and the connecting bar is drawn to match, since
 * only one arm survived the DOM capture.
 */
export const LinkIcon = createIcon(
  "LinkIcon",
  <>
    <path d="M9.30558 10.206C9.57224 10.4726 9.59447 10.8912 9.37225 11.1831L9.30558 11.2594L6.84751 13.7175C5.58692 14.9781 3.54311 14.9781 2.28252 13.7175C1.0654 12.5004 1.02344 10.5531 2.15661 9.28564L2.28252 9.15251L4.74059 6.69443C5.0315 6.40353 5.50315 6.40353 5.79405 6.69443C6.06071 6.9611 6.08294 7.37963 5.86072 7.67161L5.79405 7.74789L3.33598 10.206C2.6572 10.8847 2.6572 11.9853 3.33598 12.664C4.01475 13.3428 5.11528 13.3428 5.79405 12.664L8.25213 10.206C8.54303 9.91512 9.01468 9.91512 9.30558 10.206Z" />
    <path d="M13.7175 2.28252C14.9781 3.54311 14.9781 5.58692 13.7175 6.84751L11.2594 9.30558C10.9685 9.59648 10.4969 9.59648 10.206 9.30558C9.91512 9.01468 9.91512 8.54303 10.206 8.25213L12.664 5.79405C13.3428 5.11528 13.3428 4.01475 12.664 3.33598C11.9853 2.6572 10.8847 2.6572 10.206 3.33598L7.74789 5.79405C7.45699 6.08495 6.98534 6.08495 6.69443 5.79405C6.40353 5.50315 6.40353 5.0315 6.69443 4.74059L9.15251 2.28252C10.4131 1.02193 12.4569 1.02193 13.7175 2.28252Z" />
    <path d="M10.2634 5.73657C10.5559 6.02946 10.5559 6.50434 10.2634 6.79723L6.79723 10.2634C6.50434 10.5559 6.02946 10.5559 5.73657 10.2634C5.44368 9.97052 5.44368 9.49564 5.73657 9.20275L9.20275 5.73657C9.49564 5.44368 9.97052 5.44368 10.2634 5.73657Z" />
  </>,
);

/** Verbatim. The tag mark from the issue detail's Labels rail. */
export const LabelIcon = createIcon(
  "LabelIcon",
  <>
    <path
      fillRule="evenodd"
      d="M12 11.5V13H5.132v-1.5H12Zm1.5-1.5V6a1.5 1.5 0 0 0-1.346-1.492L12 4.5H5.133a.5.5 0 0 0-.303.103l-.08.076-2.382 2.834a.5.5 0 0 0-.11.234l-.008.087v.331a.5.5 0 0 0 .118.321l2.382 2.835a.5.5 0 0 0 .383.179V13l-.22-.012a2 2 0 0 1-1.16-.54l-.15-.16L1.218 9.45a2 2 0 0 1-.46-1.11L.75 8.165v-.331a2 2 0 0 1 .363-1.147l.106-.14 2.383-2.834a2 2 0 0 1 1.312-.701L5.134 3H12a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3v-1.5A1.5 1.5 0 0 0 13.5 10Z"
    />
    <path d="M5.5 8a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" />
  </>,
);

/**
 * Favourite / star.
 *
 * Drawn. A five-point star on a 6.6/2.95 radius pair, optically centred at
 * y = 8.35 — a geometrically centred star reads as sitting high, because more
 * of its area is below the midline than above it.
 */
export const StarIcon = createIcon(
  "StarIcon",
  <path
    d="M8 1.75 L9.734 5.963 L14.277 6.31 L10.806 9.262 L11.879 13.69 L8 11.3 L4.121 13.69 L5.194 9.262 L1.723 6.31 L6.266 5.963Z"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinejoin="round"
  />,
);

/** The filled companion, for a favourite that is already set. */
export const StarFilledIcon = createIcon(
  "StarFilledIcon",
  <path
    d="M8 1.75 L9.734 5.963 L14.277 6.31 L10.806 9.262 L11.879 13.69 L8 11.3 L4.121 13.69 L5.194 9.262 L1.723 6.31 L6.266 5.963Z"
    strokeWidth={1.5}
    stroke="currentColor"
    strokeLinejoin="round"
  />,
);

/**
 * Drag handle.
 *
 * Drawn. Two columns of three 1-unit dots — the grip pattern, sized so the
 * whole glyph occupies the 8px gutter Linear leaves to the left of a row
 * without crowding the priority icon that follows it.
 */
export const DragHandleIcon = createIcon(
  "DragHandleIcon",
  <>
    {[4, 8, 12].map((y) =>
      [5.5, 10.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1} />),
    )}
  </>,
);

/** Verbatim. The activity feed's clock-with-arrow. */
export const HistoryIcon = createIcon(
  "HistoryIcon",
  <>
    <path d="M2.64849 9.64645L4.44209 7.85355C4.7572 7.53857 4.53403 7 4.0884 7H3.04846C3.41252 4.45578 5.60144 2.5 8.24734 2.5C11.148 2.5 13.4994 4.85051 13.4994 7.75C13.4994 10.6495 11.148 13 8.24734 13C6.96107 13 5.78452 12.5388 4.87129 11.7718C4.55402 11.5054 4.08074 11.5465 3.8142 11.8637C3.54766 12.1808 3.58878 12.6539 3.90606 12.9203C5.07954 13.9058 6.595 14.5 8.24734 14.5C11.9767 14.5 15 11.4779 15 7.75C15 4.02208 11.9767 1 8.24734 1C4.77156 1 1.90912 3.62504 1.53589 7H0.5012C0.0555715 7 -0.167599 7.53857 0.147507 7.85355L1.94111 9.64645C2.13645 9.84171 2.45315 9.84171 2.64849 9.64645Z" />
    <path d="M8.37472 5.67742C8.37472 5.30329 8.0676 5 7.68874 5C7.30988 5 7.00276 5.30329 7.00276 5.67742V8.3871C7.00276 8.76122 7.30988 9.06452 7.68874 9.06452H10.4327C10.8115 9.06452 11.1187 8.76122 11.1187 8.3871C11.1187 8.01297 10.8115 7.70968 10.4327 7.70968H8.37472V5.67742Z" />
  </>,
);
