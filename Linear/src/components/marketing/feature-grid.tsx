import type { ReactNode } from "react";

import {
  FilterIcon,
  InboxIcon,
  IssuesIcon,
  ProjectsIcon,
  SearchIcon,
  SettingsIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/**
 * What the product does, in six claims.
 *
 * Each one is a thing this codebase actually ships, phrased as the mechanism
 * rather than the benefit — "a fractional-index string, so a drag writes one
 * row" instead of "blazing fast reordering". For a tool sold to engineers the
 * mechanism *is* the benefit, and a page of adjectives is the tell that there
 * is nothing underneath.
 *
 * Six, in a 3×2 grid at 1024px. Not eight: the last two of an eight-card grid
 * are always the two nobody could think of.
 */

interface Feature {
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
}

const FEATURES: readonly Feature[] = [
  {
    icon: <IssuesIcon size={16} />,
    title: "Issues that hold their order",
    body:
      "Manual order is a base-62 fractional index, not a float. Dropping an " +
      "issue between two others writes exactly one row, and there is no " +
      "rebalancing pass waiting to run at the wrong moment.",
  },
  {
    icon: <SearchIcon size={16} />,
    title: "A command menu that reads the room",
    body:
      "⌘K offers what applies to what you have selected. Pick “Change " +
      "status…” and it opens the statuses instead of guessing — a sub-menu, " +
      "not a second dialog.",
  },
  {
    icon: <SettingsIcon size={16} />,
    title: "Permissions as one table",
    body:
      "Workspace, team and project roles resolve through a single declarative " +
      "matrix. A missing cell is a compile error, and there is a test that " +
      "greps the codebase for role comparisons written anywhere else.",
  },
  {
    icon: <ProjectsIcon size={16} />,
    title: "Projects across teams",
    body:
      "Lead, members, milestones, health and updates. One private team on a " +
      "project hides the project — visibility is computed, never stored, so it " +
      "cannot drift from the memberships that decide it.",
  },
  {
    icon: <InboxIcon size={16} />,
    title: "An inbox with a snooze that is a timestamp",
    body:
      "Notifications come back because a comparison changed its mind, not " +
      "because a scheduled job woke up. Nothing here needs a background worker " +
      "to be correct.",
  },
  {
    icon: <FilterIcon size={16} />,
    title: "Views that survive a reload",
    body:
      "List or board, grouped by status, assignee, priority, project or label, " +
      "with display options and filters — saved, shared, and restored exactly " +
      "as you left them.",
  },
];

export function FeatureGrid() {
  return (
    <section id="features" className="scroll-mt-20 px-6 py-20">
      <div className="mx-auto max-w-[1024px]">
        <h2
          className={cn(
            "max-w-[20ch] text-primary [font-weight:510]",
            "text-[clamp(1.5rem,4vw,2rem)] leading-[1.125] [letter-spacing:-0.022em]",
          )}
        >
          Built the way the original was, down to the measurements
        </h2>
        <p className="mt-4 max-w-[62ch] text-regular leading-[1.6] text-tertiary">
          Every colour, size and duration in this interface was measured off the
          running application rather than guessed. The greys are violet, body
          text is 13px at weight 450, and nothing animates for longer than 350ms.
        </p>

        <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <span
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-[var(--radius-lg)]",
                  "bg-[var(--accent-tint)] text-[var(--accent-text)]",
                )}
              >
                {feature.icon}
              </span>
              <h3 className="mt-4 text-regular text-primary [font-weight:var(--weight-title)] [letter-spacing:-0.012em]">
                {feature.title}
              </h3>
              <p className="mt-2 text-small leading-[1.6] text-tertiary">
                {feature.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
