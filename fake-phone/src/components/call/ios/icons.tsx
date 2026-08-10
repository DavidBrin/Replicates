/**
 * Call glyphs, drawn here rather than installed.
 *
 * Apple licenses SF Symbols for software running on Apple platforms only, so
 * the real icons cannot ship inside a web bundle (research/ios-call-ui.md §5) —
 * and an icon package would be a dependency for eleven shapes. These are
 * original paths on a 24×24 grid, matching the shapes iOS uses.
 *
 * Every glyph paints in `currentColor` and carries no size of its own, which is
 * what lets one frosted control invert from a white glyph to a dark one without
 * a second icon set (research/ios-call-ui.md §2.3).
 */

import type { ReactNode, SVGProps } from "react";

/**
 * `rotate` is dropped from the SVG attribute set so the handset can take a
 * plain degrees number instead — the presentation attribute of that name only
 * applies to `<text>` and would never be wanted here.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "children" | "rotate">;

function Glyph({ children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

/**
 * The handset at rest, which is the "answer" orientation. The sweep is
 * deliberately asymmetric so that rotating it actually reads as a different
 * icon — a symmetric dumbbell handset looks identical at 135° and the decline
 * button silently loses its meaning.
 */
const HANDSET =
  "M4.2 3h3.1a1.6 1.6 0 0 1 1.58 1.34l.54 3.28a1.6 1.6 0 0 1-.44 1.4L7.2 10.8a13.6 13.6 0 0 0 6 6l1.78-1.78a1.6 1.6 0 0 1 1.4-.44l3.28.54A1.6 1.6 0 0 1 21 16.7v3.1A1.6 1.6 0 0 1 19.4 21.4C10.9 21.4 2.6 13.1 2.6 4.6A1.6 1.6 0 0 1 4.2 3Z";

export function HandsetIcon({ rotate = 0, ...rest }: IconProps & { rotate?: number }) {
  return (
    <Glyph {...rest}>
      <path
        d={HANDSET}
        fill="currentColor"
        transform={rotate === 0 ? undefined : `rotate(${rotate} 12 12)`}
      />
    </Glyph>
  );
}

/**
 * Decline / end call. 135° is the rotation Apple has used to distinguish
 * "hang up" from "answer" since iOS 7 (research/ios-call-ui.md §2.4).
 */
export function HandsetDownIcon(props: IconProps) {
  return <HandsetIcon rotate={135} {...props} />;
}

export function MessageIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fill="currentColor"
        d="M12 3.4c-5.08 0-9.2 3.24-9.2 7.24 0 2.28 1.34 4.32 3.44 5.66-.24 1.42-1 2.74-2.2 3.74 1.98-.16 3.86-.86 5.36-2 .84.16 1.72.24 2.6.24 5.08 0 9.2-3.24 9.2-7.64S17.08 3.4 12 3.4Z"
      />
    </Glyph>
  );
}

export function AlarmIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="13.4" r="7.4" stroke="currentColor" strokeWidth="1.9" />
      <path
        d="M12 9.4v4.2h3.2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.4 5.6 6.8 2.6M20.6 5.6 17.2 2.6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </Glyph>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="9" y="2.6" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5.4 11.4a6.6 6.6 0 0 0 13.2 0M12 18v3.2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </Glyph>
  );
}

export function MicSlashIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="9" y="2.6" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5.4 11.4a6.6 6.6 0 0 0 13.2 0M12 18v3.2M3.6 2.8 20.4 21.2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </Glyph>
  );
}

export function KeypadIcon(props: IconProps) {
  const centres = [6, 12, 18];
  return (
    <Glyph {...props}>
      {centres.map((y) =>
        centres.map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" fill="currentColor" />),
      )}
    </Glyph>
  );
}

export function SpeakerWavesIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fill="currentColor"
        d="M11.4 4.2 6.9 8H4.2a1.4 1.4 0 0 0-1.4 1.4v5.2A1.4 1.4 0 0 0 4.2 16h2.7l4.5 3.8a.9.9 0 0 0 1.5-.69V4.89a.9.9 0 0 0-1.5-.69Z"
      />
      <path
        d="M16.4 9.2a4.2 4.2 0 0 1 0 5.6M19 6.8a7.8 7.8 0 0 1 0 10.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </Glyph>
  );
}

export function PersonPlusIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="9.4" cy="7.8" r="3.6" fill="currentColor" />
      <path
        fill="currentColor"
        d="M9.4 12.8c-3.6 0-6.6 2.06-6.6 4.7 0 .83.67 1.5 1.5 1.5h9.06a6.4 6.4 0 0 1 2.1-5.62 12.6 12.6 0 0 0-6.06-.58Z"
      />
      <path
        d="M19.2 13.6v5.2M16.6 16.2h5.2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </Glyph>
  );
}

export function VideoIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="2.6" y="6.4" width="12.6" height="11.2" rx="3" fill="currentColor" />
      <path
        fill="currentColor"
        d="M16.8 11.2l3.6-2.6c.66-.48 1.6-.01 1.6.8v5.2c0 .81-.94 1.28-1.6.8l-3.6-2.6z"
      />
    </Glyph>
  );
}

export function PersonCircleIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="10" r="3" fill="currentColor" />
      <path
        fill="currentColor"
        d="M12 14.4c-2.72 0-5.04 1.42-5.84 3.4a9.16 9.16 0 0 0 11.68 0c-.8-1.98-3.12-3.4-5.84-3.4Z"
      />
    </Glyph>
  );
}
