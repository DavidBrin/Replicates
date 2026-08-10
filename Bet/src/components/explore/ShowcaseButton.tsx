"use client";

import { useState } from "react";
import type { MouseEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import type { ButtonSize, ButtonVariant } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { ShowcaseDialog } from "./ShowcaseDialog";

export interface ShowcaseButtonProps {
  label: string;
  /** `"yes"`/`"no"` render the Button primitive's tinted probability-action
   * variant; `"team"` renders a solid-filled button in `teamColor`
   * (Polymarket's per-team trading-button skin, research/polymarket.md
   * §2.3's "two colored team buttons"). */
  tone: "yes" | "no" | "team";
  teamColor?: string;
  size?: ButtonSize;
  className?: string;
}

/**
 * The Yes/No (or per-team) action button everywhere on Explore. Per DECISIONS
 * D14 / SPEC §3.6, Explore is read-only — clicking never trades. Instead it
 * opens a small popover explaining that plainly, with a link back into the
 * real (private) trading surface. Client component: it owns the open/closed
 * popover state. Uses `ShowcaseDialog` rather than `@/components/ui/Modal`
 * — see that component's doc comment: `Modal` portals to `document.body`,
 * which breaks out of the `[data-surface="explore"]` scope and would render
 * this dialog in Bet's indigo accent instead of Explore's mint.
 */
export function ShowcaseButton({ label, tone, teamColor, size = "sm", className }: ShowcaseButtonProps) {
  const [open, setOpen] = useState(false);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  }

  const variant: ButtonVariant = tone === "team" ? "secondary" : tone;
  const teamStyle =
    tone === "team" && teamColor
      ? { backgroundColor: teamColor, borderColor: teamColor, color: "var(--surface-0)" }
      : undefined;

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={handleClick}
        className={cn("pointer-events-auto", tone === "team" && "border-none", className)}
        style={teamStyle}
      >
        {label}
      </Button>
      <ShowcaseDialog open={open} onClose={() => setOpen(false)} title="This is a showcase market">
        <div className="flex flex-col gap-4 text-sm text-(--text-2)">
          <p>
            Explore is a read-only showcase of simulated public markets — nothing here
            actually trades. Real trading happens inside your groups, against your
            friends&rsquo; credits.
          </p>
          <Link
            href="/app"
            className="inline-flex h-10 items-center justify-center rounded-(--radius-input) bg-(--accent) px-4 text-sm font-medium text-(--surface-0) transition-colors hover:bg-(--accent-2)"
            onClick={() => setOpen(false)}
          >
            Go to your groups
          </Link>
        </div>
      </ShowcaseDialog>
    </>
  );
}
