"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { Popover } from "@/components/ui/popover";

import type { DetailReaction } from "./types";

/**
 * Emoji reactions, grouped.
 *
 * The stored row is one reaction per (user, target, emoji); the *rendered* unit
 * is one chip per emoji carrying a count. That grouping is the whole component,
 * and the two things it has to get right are:
 *
 * - **"You reacted" is a distinct state**, not a count of one. A chip you are
 *   part of is outlined in the accent colour and clicking it removes *your*
 *   reaction rather than adding a second — which is why the toggle handler
 *   needs your own reaction's id, not just the emoji.
 * - **Order is first-seen, not alphabetical and not by count.** A chip that
 *   moves when someone else reacts is a chip you click by mistake.
 *
 * The `title` lists who reacted. It is the only affordance that answers "who
 * is the 👍 from", and it costs nothing.
 */

/** The palette. Linear offers all of Unicode; this is the frequent set. */
export const QUICK_EMOJI: readonly string[] = [
  "👍",
  "👎",
  "😄",
  "🎉",
  "😕",
  "❤️",
  "🚀",
  "👀",
];

export interface ReactionGroup {
  readonly emoji: string;
  readonly count: number;
  readonly names: readonly string[];
  /** The viewer's own reaction id, or null when they have not reacted. */
  readonly mine: string | null;
}

/**
 * Group a flat reaction list into chips.
 *
 * Exported because it is the part with a rule in it, and a test that asserts on
 * the grouping directly is worth more than one that infers it from the DOM.
 */
export function groupReactions(
  reactions: readonly DetailReaction[],
  viewerId: string,
): readonly ReactionGroup[] {
  const order: string[] = [];
  const groups = new Map<string, { names: string[]; mine: string | null }>();

  for (const reaction of reactions) {
    let group = groups.get(reaction.emoji);
    if (group === undefined) {
      group = { names: [], mine: null };
      groups.set(reaction.emoji, group);
      order.push(reaction.emoji);
    }
    group.names.push(reaction.userName);
    if (reaction.userId === viewerId) group.mine = reaction.id;
  }

  return order.map((emoji) => {
    const group = groups.get(emoji);
    const names = group?.names ?? [];
    return {
      emoji,
      count: names.length,
      names,
      mine: group?.mine ?? null,
    };
  });
}

export interface ReactionsProps {
  reactions: readonly DetailReaction[];
  viewerId: string;
  /** `existingId` is the viewer's own reaction — non-null means "remove it". */
  onToggle: (emoji: string, existingId: string | null) => void;
  testId?: string;
  disabled?: boolean;
  /** Render the "add reaction" affordance even with no reactions yet. */
  alwaysShowAdd?: boolean;
}

export function Reactions({
  reactions,
  viewerId,
  onToggle,
  testId,
  disabled = false,
  alwaysShowAdd = false,
}: ReactionsProps) {
  const groups = groupReactions(reactions, viewerId);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);

  if (groups.length === 0 && !alwaysShowAdd) return null;

  return (
    <div data-testid={testId} className="flex flex-wrap items-center gap-1">
      {groups.map((group) => (
        <button
          key={group.emoji}
          type="button"
          disabled={disabled}
          data-testid={`reaction-${group.emoji}`}
          data-mine={group.mine !== null}
          aria-pressed={group.mine !== null}
          aria-label={`${group.emoji} ${group.count}${group.mine !== null ? ", you reacted" : ""}`}
          title={group.names.join(", ")}
          onClick={() => onToggle(group.emoji, group.mine)}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full border px-2",
            "text-mini leading-none",
            "disabled:pointer-events-none disabled:opacity-50",
            group.mine !== null
              ? "border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-text)]"
              : "border-default text-tertiary hover:bg-[var(--bg-hover)]",
          )}
        >
          <span aria-hidden>{group.emoji}</span>
          <span>{group.count}</span>
        </button>
      ))}

      <button
        ref={anchor}
        type="button"
        disabled={disabled}
        data-testid={testId ? `${testId}-add` : "reaction-add"}
        aria-label="Add reaction"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-full",
          "text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <SmileyIcon />
      </button>

      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
        aria-label="Pick a reaction"
      >
        <div data-testid="emoji-picker" className="flex gap-1 p-1">
          {QUICK_EMOJI.map((emoji) => {
            const existing = groups.find((group) => group.emoji === emoji);
            return (
              <button
                key={emoji}
                type="button"
                data-testid={`emoji-option-${emoji}`}
                aria-label={emoji}
                onClick={() => {
                  onToggle(emoji, existing?.mine ?? null);
                  setOpen(false);
                }}
                className="inline-flex size-7 items-center justify-center rounded-[var(--radius-md)] text-small hover:bg-[var(--bg-hover)]"
              >
                {emoji}
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}

/** The "add a reaction" glyph. Drawn to match Linear's outlined smiley. */
function SmileyIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <circle cx={8} cy={8} r={6.25} stroke="currentColor" strokeWidth={1.5} />
      <circle cx={5.75} cy={6.5} r={0.9} fill="currentColor" />
      <circle cx={10.25} cy={6.5} r={0.9} fill="currentColor" />
      <path
        d="M5.5 9.75c.6.9 1.45 1.35 2.5 1.35s1.9-.45 2.5-1.35"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}
