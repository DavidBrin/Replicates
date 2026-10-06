"use client";

/**
 * The roster / portrait disc (SPEC §7.1, §7.2 `Get Ready`, §7.2 `Victory!`).
 *
 * A coloured disc carrying the seat's initials, plus the four decorations the
 * SPEC attaches to it: a **gold laurel wreath ring** for the viewer and the
 * winner, a **robot chip** for a bot seat, a dark disc with a white **skull**
 * when the seat is eliminated, and the `YOU` pill beneath.
 *
 * No original art is used or required (§8): the portrait is the initials.
 */
import clsx from "clsx";

import type { PlayerColour } from "@/engine/types";

import { Icon } from "./Icon";

export interface AvatarProps {
  readonly name: string;
  readonly colour: PlayerColour;
  /** Disc diameter in px. */
  readonly size?: number;
  /** The gold laurel wreath ring. */
  readonly laurel?: boolean;
  /** The robot chip at 4 o'clock. */
  readonly bot?: boolean;
  /** Replaces the portrait with a dark disc and a white skull. */
  readonly eliminated?: boolean;
  /** The `YOU` pill beneath the disc. */
  readonly you?: boolean;
  readonly testId?: string;
  readonly className?: string;
}

/**
 * Up to two initials, from the first and last word of the display name.
 *
 * The generated `<Adjective> <Noun> <NN>` names (§7) end in a number, and a
 * digit is not an initial: `Northern Warden 21` reads `NW`, not `N2`.
 */
export function initialsOf(name: string): string {
  const all = name.trim().split(/\s+/).filter(Boolean);
  const letters = all.filter((word) => /\p{L}/u.test(word));
  const words = letters.length > 0 ? letters : all;
  if (words.length === 0) return "?";
  const first = words[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1] ?? "") : "";
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
}

export function Avatar({
  name,
  colour,
  size = 76,
  laurel = false,
  bot = false,
  eliminated = false,
  you = false,
  testId,
  className,
}: AvatarProps) {
  const chip = Math.round(size * 0.34);
  return (
    <div
      data-testid={testId ?? "avatar"}
      data-colour={colour}
      data-eliminated={eliminated ? "true" : "false"}
      data-bot={bot ? "true" : "false"}
      className={clsx("relative inline-flex flex-col items-center", className)}
      style={{ width: size }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <div
          data-testid="avatar-disc"
          className="flex h-full w-full items-center justify-center rounded-full"
          style={{
            background: eliminated ? "var(--chrome-800)" : `var(--p-${colour})`,
            border: `3px solid ${eliminated ? "var(--stroke-dark)" : `var(--p-${colour}-wall)`}`,
            color: eliminated ? "var(--text)" : `var(--p-${colour}-on)`,
            boxShadow: "var(--sh-chip)",
          }}
        >
          {eliminated ? (
            <Icon name="skull" size={Math.round(size * 0.56)} title="Eliminated" />
          ) : (
            <span
              data-testid="avatar-initials"
              className="font-head font-black"
              style={{ fontSize: Math.round(size * 0.4), letterSpacing: ".02em" }}
            >
              {initialsOf(name)}
            </span>
          )}
        </div>

        {laurel ? (
          <span
            data-testid="avatar-laurel"
            className="pointer-events-none absolute inset-[-12%] flex items-center justify-center"
            style={{ color: "var(--gold)" }}
            aria-hidden
          >
            <Icon name="laurel" size={Math.round(size * 1.24)} />
          </span>
        ) : null}

        {bot ? (
          <span
            data-testid="avatar-bot-chip"
            className="absolute flex items-center justify-center rounded-full"
            style={{
              width: chip,
              height: chip,
              right: -chip * 0.15,
              bottom: -chip * 0.15,
              background: "var(--chrome-800)",
              border: "2px solid var(--text)",
              color: "var(--text)",
            }}
            aria-hidden
          >
            <Icon name="robot" size={Math.round(chip * 0.66)} />
          </span>
        ) : null}
      </div>

      {you ? (
        <span
          data-testid="avatar-you"
          className="mt-[-6px] rounded-full px-2 font-head font-bold"
          style={{
            background: "var(--chrome-800)",
            border: "2px solid var(--text)",
            color: "var(--text)",
            fontSize: Math.max(10, Math.round(size * 0.17)),
            letterSpacing: ".08em",
          }}
        >
          YOU
        </span>
      ) : null}
    </div>
  );
}

export default Avatar;
