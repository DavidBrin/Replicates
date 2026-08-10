/**
 * Material-Symbols-alike glyphs, drawn by hand.
 *
 * Every path here is authored from scratch on the 24dp grid Material Symbols
 * uses, with round caps and joins to match the "Rounded" optical style the
 * Google Phone app ships (research/android-call-ui.md §1.4). We do not pull an
 * icon package: the whole point of a skin is that it is a handful of files with
 * no dependency surface, and a font-based icon set would also mean a network
 * fetch on a screen that has to render instantly on a cold boot.
 *
 * The handset is one shape reused twice. `call` is that shape rotated so the
 * receiver runs top-left to bottom-right with the cups facing the speaker's
 * face; `call_end` is the same receiver turned over. Drawing them from one path
 * is not just less code — it is why the two icons read as the same object in
 * two states, which is exactly how Material draws them.
 */

import type { CSSProperties, ReactNode } from "react";

interface IconProps {
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * The handset silhouette: a slim bar with a deep cup at each end, drawn
 * horizontally with the cups hanging down and centred on (12,12) so it can be
 * rotated about the middle of the grid without drifting off it.
 *
 * The cups are deliberately deeper than the bar is thick. A shallower receiver
 * still reads as a phone at 45° but collapses into an anonymous blob at other
 * rotations — which matters here, because the end-call glyph is this same shape
 * turned over.
 */
const HANDSET_PATH =
  "M3.4 10.7C3.4 9.4 4.9 8.5 7 8.5h10c2.1 0 3.6.9 3.6 2.2v3.2c0 .9-.7 1.6-1.6 1.6h-1.8c-.9 0-1.6-.7-1.6-1.6v-2.4H8.4v2.4c0 .9-.7 1.6-1.6 1.6H5c-.9 0-1.6-.7-1.6-1.6z";

function Glyph({ className, style, children }: IconProps & { readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className ?? "h-6 w-6"}
      style={style}
    >
      {children}
    </svg>
  );
}

export function CallIcon({ className, style }: IconProps) {
  return (
    <Glyph className={className} style={style}>
      <path d={HANDSET_PATH} fill="currentColor" transform="rotate(45 12 12)" />
    </Glyph>
  );
}

/**
 * The end-call handset: the same receiver put back down, i.e. turned 135° from
 * the answering angle. Material's own `call_end` adds two small wedges either
 * side to suggest the slam; they are omitted here because at the 32px this
 * renders at they read as noise rather than motion.
 */
export function CallEndIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d={HANDSET_PATH} fill="currentColor" transform="rotate(135 12 12)" />
    </Glyph>
  );
}

export function MicOffIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
        <path d="M4 4 20 20" />
      </g>
    </Glyph>
  );
}

export function MicIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </g>
    </Glyph>
  );
}

export function SpeakerIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 9.5h3L12 5v14L7 14.5H4z" />
        <path d="M16.2 8.6a4.8 4.8 0 0 1 0 6.8" />
        <path d="M19.2 5.6a9 9 0 0 1 0 12.8" />
      </g>
    </Glyph>
  );
}

/** Material's `dialpad`: a 3×3 grid of dots plus the lone "0" below the middle. */
export function DialpadIcon({ className }: IconProps) {
  const columns = [6.5, 12, 17.5];
  const rows = [5.5, 10.5, 15.5];
  return (
    <Glyph className={className}>
      <g fill="currentColor">
        {rows.flatMap((cy) => columns.map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.55} />))}
        <circle cx={12} cy={20.5} r={1.55} />
      </g>
    </Glyph>
  );
}

export function MoreVertIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <g fill="currentColor">
        <circle cx={12} cy={5.2} r={1.75} />
        <circle cx={12} cy={12} r={1.75} />
        <circle cx={12} cy={18.8} r={1.75} />
      </g>
    </Glyph>
  );
}
