import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

/**
 * The member avatar.
 *
 * A circle carrying either an uploaded image or generated initials on a colour
 * derived from the user's id. Deterministic derivation matters more than it
 * sounds: an avatar that picks a colour at render time changes hue between the
 * server render and the client one, then again on every navigation, and the
 * list stops being scannable by colour — which is most of what an 18px avatar
 * is *for*.
 *
 * ## The palette
 *
 * The nine swatches are Linear's own entity palette, read out of its bundle in
 * the order Linear stores them (`research/01-visual-design.md` §1.6). The order
 * is load-bearing: Linear's `stableColorForId()` hashes an id into this list, so
 * keeping the ordering keeps the "random" colours in the same relative family
 * as the real product.
 *
 * {@link AVATAR_COLORS} is the subset used for *people*. It omits the palest
 * swatch (`#f7c8c1`, "Pink"), because Linear paints avatar initials
 * `#ffffff` unconditionally — measured — and white on that swatch is
 * unreadable. Labels keep the full nine via {@link ENTITY_COLORS}; they render
 * their colour as a dot beside dark text, so no contrast question arises.
 *
 * ## Sizes
 *
 * 16 / 20 / 24 / 32. The measured app uses 18px in a list row and 24px in the
 * header; 18 is not on the ramp because a half-step between 16 and 20 buys
 * nothing at these sizes and doubles the ramp. Initials scale at exactly half
 * the diameter, which is the ratio Linear ships (9px text in an 18px circle).
 */

/** Linear's full nine-swatch entity palette, in its stored order. */
export const ENTITY_COLORS: readonly string[] = [
  "#bec2c8", // lightGrey
  "#95a2b3", // darkGrey
  "#5e6ad2", // controlPrimary
  "#26b5ce", // tealBase
  "#4cb782", // greenBase
  "#f2c94c", // yellowBase
  "#f2994a", // orangeBase (label swatch — not the theme token)
  "#f7c8c1", // redBg
  "#eb5757", // redBase
];

/** The subset that carries white initials legibly. */
export const AVATAR_COLORS: readonly string[] = ENTITY_COLORS.filter(
  (hex) => hex !== "#f7c8c1",
);

/**
 * A stable index into a palette, derived from an id.
 *
 * FNV-1a, 32-bit. Chosen over `id.length % n` or a sum of char codes because
 * both of those cluster badly on ids that share a prefix — and every id in this
 * app shares a prefix by design (`usr_`, `tem_`, `prj_`). A weak hash would
 * hand consecutively-created users the same three colours.
 */
export function paletteIndexForId(id: string, size: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % size;
}

/** The deterministic avatar colour for a user id. */
export function avatarColorForId(id: string): string {
  return (
    AVATAR_COLORS[paletteIndexForId(id, AVATAR_COLORS.length)] ??
    AVATAR_COLORS[0] ??
    "#5e6ad2"
  );
}

/**
 * Up to two initials.
 *
 * First letter of the first word plus first letter of the *last* word, so
 * "David Del Rio" reads `DR` rather than `DD`. Falls back to the first two
 * characters for a single-word name, and to `?` for an empty one — an avatar
 * with no glyph at all looks like a rendering bug.
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    return (words[0] ?? "").slice(0, 2).toUpperCase();
  }
  const first = words[0]?.[0] ?? "";
  const last = words[words.length - 1]?.[0] ?? "";
  return `${first}${last}`.toUpperCase();
}

export type AvatarSize = 16 | 20 | 24 | 32;

export interface AvatarProps {
  /** The user id. Drives the fallback colour; never rendered. */
  id: string;
  name: string;
  /** An uploaded image or data URI. Falls back to initials when absent. */
  src?: string | null;
  /** `User.avatarColor` when the row has one; otherwise derived from `id`. */
  color?: string | null;
  size?: AvatarSize;
  /**
   * Drop out of the accessibility tree.
   *
   * Correct in a list row where the assignee's name is already announced, and
   * in a stack where the group carries one label. An avatar is decorative far
   * more often than not.
   */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Avatar({
  id,
  name,
  src,
  color,
  size = 20,
  decorative = false,
  className,
  style,
}: AvatarProps) {
  const background = color ?? avatarColorForId(id);
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": name } as const);

  const box: CSSProperties = {
    width: size,
    height: size,
    ...style,
  };

  if (src) {
    return (
      // A plain <img>: these are 16–32px, frequently data URIs, and always
      // above the fold in the row they belong to, so next/image's loader and
      // srcset machinery would add work and a layout wrapper for no gain.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        {...a11y}
        alt={decorative ? "" : name}
        src={src}
        width={size}
        height={size}
        className={cn(
          "shrink-0 rounded-full object-cover",
          "bg-elevated",
          className,
        )}
        style={box}
      />
    );
  }

  return (
    <span
      {...a11y}
      data-avatar="initials"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full",
        "[color:var(--text-on-accent)] [font-weight:var(--weight-medium)]",
        "leading-none",
        className,
      )}
      style={{
        ...box,
        background,
        // Half the diameter, matching Linear's 9px-in-18px measurement. Set
        // inline rather than as a size class because it is a function of the
        // `size` prop, not one of four hand-written variants.
        fontSize: size / 2,
      }}
    >
      {initialsFor(name)}
    </span>
  );
}

export interface AvatarStackProps {
  members: readonly { id: string; name: string; avatarUrl?: string | null; avatarColor?: string | null }[];
  /** How many to show before collapsing into a `+n`. */
  max?: number;
  size?: AvatarSize;
  /** Announced for the group; the individual avatars go decorative. */
  label: string;
  className?: string;
}

/**
 * Overlapping avatars, as used on the activity feed's subscriber list.
 *
 * The overlap is a quarter of the diameter and the ring is painted in the
 * *panel* colour rather than as a border, so the circles read as cut out of the
 * surface rather than outlined on it — the same trick as the icon knockouts.
 */
export function AvatarStack({
  members,
  max = 3,
  size = 20,
  label,
  className,
}: AvatarStackProps) {
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;

  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex items-center", className)}
    >
      {shown.map((member, index) => (
        <span
          key={member.id}
          className="rounded-full [box-shadow:0_0_0_2px_var(--bg-panel)]"
          style={{ marginLeft: index === 0 ? 0 : -(size / 4) }}
        >
          <Avatar
            id={member.id}
            name={member.name}
            src={member.avatarUrl}
            color={member.avatarColor}
            size={size}
            decorative
          />
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full",
            "bg-elevated text-tertiary [box-shadow:0_0_0_2px_var(--bg-panel)]",
          )}
          style={{
            width: size,
            height: size,
            marginLeft: -(size / 4),
            fontSize: size / 2.4,
          }}
        >
          {`+${overflow}`}
        </span>
      ) : null}
    </span>
  );
}
