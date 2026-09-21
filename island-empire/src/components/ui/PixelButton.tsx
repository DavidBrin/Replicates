import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

/**
 * The chunky pixel button of the HUD and menus (SPEC §8): 3 px warm-black
 * border, a 4 px drop "ledge" that collapses on press, white outlined caps.
 * Renders a `<Link>` when `href` is given, otherwise a `<button>`; the
 * visual and props are otherwise identical so menus can mix both.
 *
 * S5's local stand-in uses `variant: "green" | "wood" | "neutral"` — those
 * three are supported here with the same meaning.
 */
export type PixelButtonVariant = "yellow" | "green" | "blue" | "red" | "wood" | "neutral" | "cream";
export type PixelButtonSize = "sm" | "md" | "lg";

interface CommonProps {
  variant?: PixelButtonVariant;
  size?: PixelButtonSize;
  /** Stretch to the container's width. */
  block?: boolean;
  children: ReactNode;
  className?: string;
}

type AnchorRest = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children">;
type ButtonRest = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

export type PixelButtonProps = CommonProps &
  (({ href: string } & AnchorRest) | ({ href?: undefined } & ButtonRest));

export function PixelButton(props: PixelButtonProps) {
  const { variant = "wood", size = "md", block = false, className, children, ...rest } = props;
  const classes = clsx(
    "ie-btn",
    `ie-btn--${variant}`,
    size !== "md" && `ie-btn--${size}`,
    block && "ie-btn--block",
    variant !== "yellow" && variant !== "cream" && "ie-outline",
    className,
  );

  if (typeof rest.href === "string") {
    const { href, ...anchor } = rest as { href: string } & AnchorRest;
    return (
      <Link href={href} className={classes} {...anchor}>
        {children}
      </Link>
    );
  }

  const { href: _omit, type, ...button } = rest as { href?: undefined } & ButtonRest;
  void _omit;
  return (
    <button type={type ?? "button"} className={classes} {...button}>
      {children}
    </button>
  );
}

export default PixelButton;
