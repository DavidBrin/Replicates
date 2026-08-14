import { Avatar } from "@/components/ui/avatar";
import { LabelChip } from "@/components/ui/badge";
import { PriorityIcon } from "@/components/ui/icons/priority-icon";
import { StatusIcon } from "@/components/ui/icons/status-icon";
import { Shortcut } from "@/components/ui/kbd";
import type { Priority, StateType } from "@/domain/entities";
import { cn } from "@/lib/cn";

/**
 * The hero's product shot — rendered, not screenshotted.
 *
 * A marketing page for a design-led tool lives or dies on whether the picture
 * above the fold looks like the product. Two ways to get one: paste a PNG, or
 * render the real components. This renders them — `StatusIcon`, `PriorityIcon`,
 * `LabelChip` and `Avatar` are the same components the issue list uses, at the
 * same 44px row height and the same 13px body size.
 *
 * The payoff is not effort saved; it is that this **cannot go stale**. A
 * screenshot is a claim about the product on the day it was taken, and it
 * silently stops being true the first time a token moves. This is the product,
 * with fixture data in it.
 *
 * The rows are the seeded workspace's own issues (`src/lib/seed.ts`), so the
 * page and the demo a visitor signs into say the same thing.
 */

interface PreviewRow {
  readonly identifier: string;
  readonly title: string;
  readonly state: StateType;
  readonly priority: Priority;
  readonly labels: readonly { readonly name: string; readonly color: string }[];
  readonly assignee: { readonly id: string; readonly name: string } | null;
  readonly date: string;
}

const ROWS: readonly PreviewRow[] = [
  {
    identifier: "ENG-1",
    title: "Issue list drops manual order after a bulk status change",
    state: "started",
    priority: 1,
    labels: [
      { name: "Bug", color: "#eb5757" },
      { name: "Frontend", color: "#bb87fc" },
    ],
    assignee: { id: "usr_dana", name: "Dana Ortega" },
    date: "Mar 7",
  },
  {
    identifier: "ENG-2",
    title: "Cursor poll returns duplicate events across a reconnect",
    state: "started",
    priority: 1,
    labels: [{ name: "Backend", color: "#4ea7fc" }],
    assignee: { id: "usr_mira", name: "Mira Castellanos" },
    date: "Mar 2",
  },
  {
    identifier: "ENG-3",
    title: "Command palette does not scope to the selected issues",
    state: "unstarted",
    priority: 2,
    labels: [{ name: "Feature", color: "#5e6ad2" }],
    assignee: { id: "usr_aziz", name: "Aziz Rahman" },
    date: "Mar 11",
  },
  {
    identifier: "ENG-4",
    title: "Add keyboard shortcut map to the help sheet",
    state: "backlog",
    priority: 4,
    labels: [{ name: "Documentation", color: "#f2c94c" }],
    assignee: null,
    date: "Feb 23",
  },
  {
    identifier: "ENG-5",
    title: "Sub-issue progress donut counts canceled children as complete",
    state: "completed",
    priority: 2,
    labels: [{ name: "Bug", color: "#eb5757" }],
    assignee: { id: "usr_dana", name: "Dana Ortega" },
    date: "Feb 18",
  },
];

export function AppPreview() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "w-full overflow-hidden rounded-[var(--radius-xl)] border border-default",
        "bg-[var(--bg-panel)]",
        "shadow-[var(--shadow-high)]",
      )}
    >
      {/* The window chrome: a 44px header, exactly the app's. */}
      <div className="flex h-11 items-center gap-2 border-b border-subtle bg-[var(--bg-sidebar)] px-3">
        <span className="flex gap-1.5">
          <Dot />
          <Dot />
          <Dot />
        </span>
        <span className="ml-2 text-mini text-tertiary">Engineering</span>
        <span className="text-quaternary">›</span>
        <span className="text-mini text-secondary">All issues</span>
        <span className="ml-auto flex items-center gap-1.5 text-quaternary">
          <span className="text-micro">Command menu</span>
          <Shortcut keys="mod+k" />
        </span>
      </div>

      {/* Group header, 36px — `--group-header-height`. */}
      <div className="flex h-9 items-center gap-2 bg-[var(--bg-elevated)] px-3">
        <StatusIcon type="started" size={14} decorative />
        <span className="text-mini text-secondary [font-weight:var(--weight-medium)]">
          In Progress
        </span>
        <span className="text-micro text-quaternary tabular-nums">2</span>
      </div>

      <ul className="flex flex-col">
        {ROWS.map((row, index) => (
          <li
            key={row.identifier}
            className={cn(
              "flex h-11 items-center gap-2.5 border-b border-subtle px-3 last:border-b-0",
              // One row painted as the keyboard cursor, because the cursor is
              // the product: a still image of this app with nothing focused
              // looks like a table.
              index === 1 && "bg-[var(--bg-selected)]",
            )}
          >
            <PriorityIcon priority={row.priority} size={14} muted decorative />
            <span className="shrink-0 text-mini text-quaternary tabular-nums">
              {row.identifier}
            </span>
            <StatusIcon type={row.state} size={14} decorative />
            <span className="min-w-0 flex-1 truncate text-small text-primary">
              {row.title}
            </span>
            <span className="hidden shrink-0 items-center gap-1 sm:flex">
              {row.labels.map((label) => (
                <LabelChip key={label.name} name={label.name} color={label.color} />
              ))}
            </span>
            <span className="hidden w-12 shrink-0 text-right text-micro text-quaternary tabular-nums md:block">
              {row.date}
            </span>
            {row.assignee === null ? (
              <span className="size-5 shrink-0 rounded-full border border-dashed border-strong" />
            ) : (
              <Avatar
                id={row.assignee.id}
                name={row.assignee.name}
                size={20}
                decorative
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Dot() {
  return <span className="size-2 rounded-full bg-[var(--border-strong)]" />;
}
