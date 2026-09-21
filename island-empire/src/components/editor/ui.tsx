"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

import { PIXEL_TEXT_SHADOW, UI } from "./palette";

/** Wood-panel + chunky-button primitives shared by the S4 screens. */

export function WoodPanel({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={clsx("rounded-lg border-4 p-3 shadow-[0_6px_0_#1A1010]", className)}
      style={{ background: UI.woodDark, borderColor: UI.woodLight }}
    >
      {children}
    </section>
  );
}

export function PixelText({
  children,
  className,
  as: Tag = "span",
}: {
  children: ReactNode;
  className?: string;
  as?: "span" | "h1" | "h2" | "h3" | "p" | "div" | "label";
}) {
  return (
    <Tag className={clsx("font-bold text-white", className)} style={{ textShadow: PIXEL_TEXT_SHADOW }}>
      {children}
    </Tag>
  );
}

type Tone = "green" | "wood" | "red" | "yellow";

const TONES: Record<Tone, { bg: string; fg: string }> = {
  green: { bg: UI.green, fg: "#FFFFFF" },
  wood: { bg: UI.woodLight, fg: "#FFFFFF" },
  red: { bg: UI.red, fg: "#FFFFFF" },
  yellow: { bg: UI.cardYellow, fg: UI.outline },
};

export function PixelButton({
  tone = "wood",
  active = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; active?: boolean }) {
  const { bg, fg } = TONES[tone];
  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        "rounded-md border-2 px-3 py-1.5 font-bold leading-none transition-transform",
        "active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-50",
        active ? "ring-2 ring-white" : "",
        className,
      )}
      style={{
        background: bg,
        color: fg,
        borderColor: UI.outline,
        boxShadow: active ? "0 0 0 2px #FFFFFF, 0 3px 0 #1A1010" : "0 3px 0 #1A1010",
        textShadow: tone === "yellow" ? undefined : PIXEL_TEXT_SHADOW,
        ...rest.style,
      }}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1 text-sm">
      <PixelText className="text-xs uppercase tracking-wide">{label}</PixelText>
      {children}
    </label>
  );
}

export const inputClass =
  "rounded border-2 border-[#1A1010] bg-[#F1E2B2] px-2 py-1 text-[#1A1010] outline-none focus:ring-2 focus:ring-white";
