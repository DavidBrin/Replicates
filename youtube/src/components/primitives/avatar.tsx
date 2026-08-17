import clsx from "clsx";
import type { ComponentPropsWithoutRef } from "react";

/**
 * The channel avatar.
 *
 * Always a circle, always one of eleven measured diameters. The t-shirt names
 * are `--yt-sys-measurement--avatar-size-*` verbatim, because the same names
 * recur across surfaces and keeping them is what lets a later slice write
 * `size="cozy"` and be right by construction rather than by looking up a
 * number:
 *
 * | name | px | where it is used (measured) |
 * |---|---|---|
 * | `mini` | 16 | — |
 * | `condensed` | 24 | comment composer, reply author, guide subscription rows |
 * | `compact` | 32 | the masthead's account button |
 * | `cozy` | 36 | the video card, and top-level comment authors |
 * | `comfortable` | 40 | the watch page's owner row |
 * | `expanded` | 48 | — |
 * | `prominent` | 56 | — |
 * | `hero` | 72 | — |
 * | `legend` / `huge` / `max` | 120 / 144 / 160 | channel headers |
 *
 * The two that surprise: the comment *composer*'s avatar is 24px while the
 * reply composer inside a thread is 40, and the card's is 36 inside a 40px box
 * — a 2px ring of space on every side that is easy to mistake for a 40px
 * avatar (R9 §2.3, §9.4).
 */

export type AvatarSize =
  | "mini"
  | "condensed"
  | "compact"
  | "cozy"
  | "comfortable"
  | "expanded"
  | "prominent"
  | "hero"
  | "legend"
  | "huge"
  | "max";

const SIZE_PX: Readonly<Record<AvatarSize, number>> = {
  mini: 16,
  condensed: 24,
  compact: 32,
  cozy: 36,
  comfortable: 40,
  expanded: 48,
  prominent: 56,
  hero: 72,
  legend: 120,
  huge: 144,
  max: 160,
};

export function avatarSizePx(size: AvatarSize): number {
  return SIZE_PX[size];
}

/**
 * The fallback palette.
 *
 * **Not measured.** No channel without an avatar was captured, so the
 * letter-on-colour fallback is this file's invention. The six colours are the
 * measured `--yt-sys-color-baseline--add-on-*-primary` ramp rather than
 * arbitrary hues, so a fallback avatar is at least a colour the product
 * actually ships; the *choice* to render one is the assumption.
 */
const FALLBACK_COLOURS = [
  "var(--yt-avatar-fallback-1)",
  "var(--yt-avatar-fallback-2)",
  "var(--yt-avatar-fallback-3)",
  "var(--yt-avatar-fallback-4)",
  "var(--yt-avatar-fallback-5)",
  "var(--yt-avatar-fallback-6)",
] as const;

/**
 * A stable index from a name.
 *
 * Deliberately not `Math.random` and not an index into a list: the same
 * channel must get the same colour on the server and on the client, or
 * hydration mismatches, and on every page it appears on, or it looks like a
 * different channel.
 */
function fallbackIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % FALLBACK_COLOURS.length;
}

export interface AvatarProps
  extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  size?: AvatarSize;
  /** Absent or failed → the letter fallback. */
  src?: string | null;
  /** The channel name. Supplies the fallback letter and the image's alt text. */
  name: string;
  /**
   * Whether the avatar names the link it sits in.
   *
   * A card's avatar sits next to the channel name in the same metadata block,
   * so announcing it again is noise — that is the common case and the default.
   * Pass `false` where the avatar is the only thing identifying the channel.
   */
  decorative?: boolean;
}

export function Avatar({
  size = "cozy",
  src,
  name,
  decorative = true,
  className,
  style,
  ...rest
}: AvatarProps) {
  const px = SIZE_PX[size];
  const letter = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        "bg-additive select-none",
        className,
      )}
      style={{ width: px, height: px, ...style }}
      {...rest}
    >
      {src ? (
        // A plain <img>, not `next/image`: the blob store and its URL shape
        // belong to another slice, and `next/image` needs its remote patterns
        // configured against a host this component cannot know. Swapping it in
        // later is a one-line change here and a config change there.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={decorative ? "" : name}
          width={px}
          height={px}
          className="size-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span
          aria-hidden={decorative ? "true" : undefined}
          className="font-[var(--yt-weight-medium)] text-overlay-primary"
          style={{
            background: FALLBACK_COLOURS[fallbackIndex(name)],
            width: px,
            height: px,
            // The letter is set at half the diameter, which holds its optical
            // weight from 16px through 160px without a second scale.
            fontSize: Math.round(px * 0.5),
            lineHeight: `${px}px`,
            textAlign: "center",
          }}
        >
          {letter}
        </span>
      )}
    </span>
  );
}
