import clsx from "clsx";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * The universal button.
 *
 * Modern YouTube renders essentially every interactive atom through one
 * component — `ytSpecButtonShapeNext` — whose class grammar is a matrix of
 * variant × palette × size × icon-mode (`research/09-youtube-signedin-surfaces.md`
 * §2.1). Sign in, Subscribe, Share, Save, Download, the like/dislike pair, the
 * card's overflow kebab, the masthead's Create button and the guide's sign-in
 * promo are all this one shape with different modifiers. Building four
 * different buttons is how a clone ends up with four slightly different
 * paddings.
 *
 * ## The one thing that must not be simplified
 *
 * **This button does not change its background on hover.** The product paints
 * an absolutely-positioned sibling — `yt-touch-feedback-shape`, containing a
 * `Stroke` div and a `Fill` div — and raises the Fill's *opacity* from 0 to
 * 0.05 (hover) or 0.1 (pressed). The result composites over whatever the
 * button already is: a Tonal button hovered is `rgba(255,255,255,0.1)` *plus*
 * white at 5%, which is not the same colour as any single token, and a Filled
 * button's overlay is black rather than white because the polarity flips with
 * the surface. R9 §14 names getting this wrong as "the most visible 'not quite
 * YouTube' tell", and a naive `:hover { background: … }` is instantly wrong to
 * anyone who uses the product.
 *
 * The Fill's colour and opacity are therefore driven through two custom
 * properties set on the host, so the whole state machine is CSS and the
 * component ships no hover JavaScript.
 *
 * ## Motion
 *
 * There is none, and that is measured rather than skipped: every button
 * sampled computes `transition: all 0s ease`
 * (`research/extracted/theme-light-dark-hover-motion.json`, and R8 §6 lists
 * "guide entry / chip / card / button hover" as instant). The player has a
 * real motion language; the app chrome does not.
 */

export type ButtonVariant = "filled" | "tonal" | "text" | "outline";

/**
 * `mono` is the default page surface. `overlay` is for controls sitting on
 * artwork or video, where the surface underneath is unknown and the palette
 * stops being theme-dependent. `callToAction` is the blue outline pair — the
 * masthead's Sign in button and nothing else in the logged-out chrome.
 */
export type ButtonPalette = "mono" | "overlay" | "callToAction";

export type ButtonSize = "s" | "m" | "l" | "xl";

/** One half of a segmented pair — the like/dislike control, and only that. */
export type ButtonSegment = "start" | "end";

export interface ButtonAppearance {
  variant?: ButtonVariant;
  palette?: ButtonPalette;
  size?: ButtonSize;
  segment?: ButtonSegment;
  /**
   * Render at the icon-only footprint (a square, or a circle at SizeM).
   *
   * Requires an `aria-label` — there is no text to name the control. It cannot
   * be enforced in the type system without making every text button's props
   * awkward, so it is enforced in review and in the test.
   */
  iconOnly?: boolean;
  /**
   * Keep the icons, drop the label.
   *
   * This is a real measured mode, not a convenience: the *subscribed* state of
   * the Subscribe button is `IconLeadingTrailingNoText` — a bell and a chevron
   * with no words, 74×40 (R9 §9.1). The label still has to be passed, because
   * it is what the `aria-label` should say.
   */
  hideLabel?: boolean;
}

/**
 * Height, radius and type per size, measured on live buttons (R9 §2.1).
 *
 * The radius is always exactly half the height, so every size is a pill — the
 * *chip* is the thing in this design system that is not, at 32px tall with an
 * 8px radius. Text padding is 16px at SizeM and 12px at SizeS; L and XL had no
 * text instance to measure and inherit M's, which is flagged below rather than
 * asserted.
 */
const SIZES: Readonly<Record<ButtonSize, string>> = {
  s: "h-8 rounded-[16px] text-[12px] leading-[32px] px-3",
  m: "h-10 rounded-[20px] text-[14px] leading-[40px] px-4",
  // L and XL were only ever measured as icon-only footprints; their text
  // padding is **assumed** to follow M rather than invented.
  l: "h-12 rounded-[24px] text-[18px] leading-[48px] px-4",
  xl: "h-14 rounded-[28px] text-[24px] leading-[56px] px-4",
};

const ICON_ONLY_SIZES: Readonly<Record<ButtonSize, string>> = {
  s: "size-8 rounded-[16px] px-0",
  // Measured as `radius: 20px / 50%` — identical results on a square, and the
  // percentage is what the product writes.
  m: "size-10 rounded-full px-0",
  l: "size-12 rounded-[24px] px-0",
  xl: "size-14 rounded-[28px] px-0",
};

/**
 * Fill and ink per variant × palette.
 *
 * `outline` is a `text` button plus a hairline and **15px** of padding rather
 * than 16 — the border eats a pixel, and the product compensates. That single
 * pixel is the kind of thing that makes a side-by-side screenshot diff light
 * up.
 */
function surfaceClasses(
  variant: ButtonVariant,
  palette: ButtonPalette,
): string {
  const overlay = palette === "overlay";
  switch (variant) {
    case "filled":
      return overlay
        ? "bg-white text-black"
        : "bg-inverted text-primary-inverse";
    case "tonal":
      return overlay
        ? "bg-[var(--yt-overlay-button-secondary)] text-overlay-primary"
        : "bg-additive text-primary";
    case "outline":
      return clsx(
        "border border-outline bg-transparent",
        palette === "callToAction"
          ? "text-cta"
          : overlay
            ? "text-overlay-primary"
            : "text-primary",
      );
    case "text":
      return clsx(
        "bg-transparent",
        palette === "callToAction"
          ? "text-cta"
          : overlay
            ? "text-overlay-primary"
            : "text-primary",
      );
  }
}

/**
 * The interaction overlay's two custom properties.
 *
 * A Filled button is already near-white on a dark page, so its overlay has to
 * *darken*: `touch-response-inverse` at the `state-mono-filled-*` opacities.
 * Everything else lightens. Both pairs are 0.05 / 0.1, which is why the tokens
 * are opacities rather than four more colours.
 */
function overlayClasses(variant: ButtonVariant): string {
  const filled = variant === "filled";
  return clsx(
    filled
      ? "[--yt-fill-color:var(--yt-touch-response-inverse)]"
      : "[--yt-fill-color:var(--yt-touch-response)]",
    "[--yt-fill-opacity:0]",
    filled
      ? "hover:[--yt-fill-opacity:var(--yt-state-filled-hover-opacity)] active:[--yt-fill-opacity:var(--yt-state-filled-press-opacity)]"
      : "hover:[--yt-fill-opacity:var(--yt-state-hover-opacity)] active:[--yt-fill-opacity:var(--yt-state-press-opacity)]",
    "[--yt-stroke-opacity:0]",
    filled
      ? "active:[--yt-stroke-opacity:var(--yt-state-filled-press-opacity)]"
      : "active:[--yt-stroke-opacity:var(--yt-state-press-opacity)]",
  );
}

/** Segmented pairs square off the joining edge; there is no gap and no divider. */
function segmentClasses(segment: ButtonSegment | undefined): string {
  if (!segment) return "";
  return segment === "start" ? "rounded-r-none" : "rounded-l-none";
}

/**
 * The host's classes, exported so a caller that must render some other element
 * — a Next `<Link>`, a `<label>` — can wear the same shape without this file
 * growing a polymorphic `as` prop.
 */
export function buttonClassName({
  variant = "tonal",
  palette = "mono",
  size = "m",
  segment,
  iconOnly = false,
  className,
}: ButtonAppearance & { className?: string }): string {
  return clsx(
    "relative inline-flex shrink-0 select-none items-center justify-center",
    "font-[var(--yt-weight-medium)] whitespace-nowrap",
    // `isolate` gives the overlay a stacking context of its own, so a Fill at
    // 5% never paints over a sibling button's shadow.
    "isolate overflow-hidden",
    "disabled:pointer-events-none disabled:text-disabled",
    iconOnly ? ICON_ONLY_SIZES[size] : SIZES[size],
    // The outline variant's 15px, replacing whatever the size set.
    variant === "outline" && !iconOnly && "px-[15px]",
    surfaceClasses(variant, palette),
    overlayClasses(variant),
    segmentClasses(segment),
    className,
  );
}

/**
 * The touch-feedback sibling.
 *
 * Both children are always rendered, at opacity 0, exactly as the product does
 * — `Stroke` is a 1px rim and `Fill` a flat wash, and they are separate
 * elements so a press can show a rim without doubling the wash.
 *
 * **The Stroke's trigger is assumed.** It measured `opacity: 0` in every state
 * that was sampled, so nothing in the research says when it comes up. It is
 * bound to `:active` here, which is the only interaction state in the token
 * set that the Fill does not already fully express.
 */
function TouchFeedback() {
  return (
    <span
      aria-hidden="true"
      data-touch-feedback=""
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
    >
      <span
        data-touch-stroke=""
        className="absolute inset-0 rounded-[inherit] border border-[var(--yt-fill-color)]"
        style={{ opacity: "var(--yt-stroke-opacity)" }}
      />
      <span
        data-touch-fill=""
        className="absolute inset-0 rounded-[inherit] bg-[var(--yt-fill-color)]"
        style={{ opacity: "var(--yt-fill-opacity)" }}
      />
    </span>
  );
}

export interface ButtonContentProps extends ButtonAppearance {
  leading?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}

/**
 * Label and icons.
 *
 * The leading icon's `margin: 0 6px 0 -6px` is measured off the watch page's
 * like button (R9 §9.2): the negative left margin pulls the glyph back into
 * the 16px padding so the *optical* inset matches a text-only button's. The
 * trailing icon mirrors it.
 */
function ButtonContent({
  leading,
  trailing,
  hideLabel = false,
  children,
}: ButtonContentProps) {
  const showLabel = !hideLabel && children !== undefined && children !== null;
  return (
    <>
      {leading ? (
        <span
          data-button-icon="leading"
          className={clsx(
            "inline-flex shrink-0 items-center",
            showLabel && "-ml-1.5 mr-1.5",
          )}
        >
          {leading}
        </span>
      ) : null}
      {showLabel ? (
        <span data-button-label="" className="inline-block">
          {children}
        </span>
      ) : null}
      {trailing ? (
        <span
          data-button-icon="trailing"
          className={clsx(
            "inline-flex shrink-0 items-center",
            showLabel && "-mr-1.5 ml-1.5",
          )}
        >
          {trailing}
        </span>
      ) : null}
      <TouchFeedback />
    </>
  );
}

export interface ButtonProps
  extends ButtonAppearance,
    Omit<ComponentPropsWithoutRef<"button">, "color"> {
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function Button({
  variant,
  palette,
  size,
  segment,
  iconOnly,
  hideLabel,
  leading,
  trailing,
  className,
  children,
  // Defaults to "submit" inside a form, which turns a stray toolbar control
  // into an accidental submit. Defaulting it here removes the whole class of
  // bug rather than relying on every call site.
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({
        variant,
        palette,
        size,
        segment,
        iconOnly,
        className,
      })}
      {...rest}
    >
      <ButtonContent
        leading={leading}
        trailing={trailing}
        hideLabel={hideLabel}
      >
        {children}
      </ButtonContent>
    </button>
  );
}

export interface ButtonLinkProps
  extends ButtonAppearance,
    Omit<ComponentPropsWithoutRef<"a">, "color"> {
  leading?: ReactNode;
  trailing?: ReactNode;
}

/**
 * The same shape as an anchor.
 *
 * Not a convenience: the masthead's Sign in control *is* an `<a>` carrying the
 * full `ytSpecButtonShapeNextHost … Outline CallToAction SizeM IconLeading`
 * class list (measured, `home-1920.json` `masthead.signInButton`). A button
 * that navigates should be a link, and forcing every navigating control
 * through `<button onClick={router.push}>` breaks middle-click, "open in new
 * tab" and the status bar.
 */
export function ButtonLink({
  variant,
  palette,
  size,
  segment,
  iconOnly,
  hideLabel,
  leading,
  trailing,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <a
      className={buttonClassName({
        variant,
        palette,
        size,
        segment,
        iconOnly,
        className,
      })}
      {...rest}
    >
      <ButtonContent
        leading={leading}
        trailing={trailing}
        hideLabel={hideLabel}
      >
        {children}
      </ButtonContent>
    </a>
  );
}
