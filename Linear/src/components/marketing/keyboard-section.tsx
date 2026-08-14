import { Shortcut } from "@/components/ui/kbd";
import { SHORTCUTS, type ShortcutSpec } from "@/lib/keyboard";
import { cn } from "@/lib/cn";

/**
 * The keyboard section — and it is generated from the registry.
 *
 * The rows below are `lib/keyboard/registry.ts` filtered by id. Not a
 * transcription: the same array the dispatcher binds and the `?` sheet renders.
 * A marketing page that advertises a shortcut the app does not have is a
 * specific and embarrassing kind of wrong, and it is the default outcome of
 * writing the marketing copy by hand.
 *
 * The four highlighted rows are the ones where the obvious guess is wrong
 * (`research/04-interaction.md` §1.10) — `Cmd+B` is the layout toggle rather
 * than the sidebar, due date is `Shift+D`, priority is shifted because bare
 * digits belong to Triage, and `M` is a prefix that is never pressed alone.
 * Leading with the corrections rather than with `C` for "create" is a claim
 * that the keymap was researched, which is the claim worth making here.
 */

const HIGHLIGHTS: readonly string[] = [
  "app.palette",
  "app.search",
  "issue.status",
  "issue.assignee",
  "view.layout",
  "app.sidebar",
  "issue.dueDate",
  "issue.priority.urgent",
  "nav.inbox",
  "issue.blockedBy",
  "issue.create",
  "app.help",
];

function pick(ids: readonly string[]): ShortcutSpec[] {
  // Ordered by `ids`, not by registry order: this list is a narrative and the
  // registry is a reference.
  return ids.flatMap((id) => SHORTCUTS.filter((entry) => entry.id === id));
}

export function KeyboardSection() {
  const rows = pick(HIGHLIGHTS);

  return (
    <section
      id="keyboard"
      className="scroll-mt-20 border-y border-[var(--bg-translucent)] px-6 py-20"
    >
      <div className="mx-auto grid max-w-[1024px] gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <h2
            className={cn(
              "max-w-[18ch] text-primary [font-weight:510]",
              "text-[clamp(1.5rem,4vw,2rem)] leading-[1.125] [letter-spacing:-0.022em]",
            )}
          >
            The keyboard is the interface
          </h2>
          <p className="mt-4 max-w-[52ch] text-regular leading-[1.6] text-tertiary">
            A scope stack, a chord buffer with a timeout, an IME guard and an
            Escape ladder that closes one thing per press. Single letters are the
            fast path, which is only possible because shortcuts are suppressed
            the moment a text field takes focus.
          </p>
          <p className="mt-4 max-w-[52ch] text-small leading-[1.6] text-quaternary">
            The map was assembled from Linear&rsquo;s own documentation — it
            publishes no shortcuts page — and cross-checked against third-party
            sheets, several of which are stale. Where they disagreed, the
            documentation won.
          </p>
          <p className="mt-6 flex flex-wrap items-center gap-2 text-small text-tertiary">
            Press <Shortcut keys="?" /> inside the app for the whole map,
            searchable.
          </p>
        </div>

        <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className={cn(
                "flex items-baseline gap-3 border-b border-[var(--bg-translucent)] py-2",
                "last:border-b-0",
              )}
            >
              <dt className="min-w-0 flex-1 truncate text-small text-secondary">
                {row.label}
              </dt>
              <dd className="shrink-0">
                <Shortcut keys={row.keys} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/**
 * The permissions section.
 *
 * Kept in this file because it is the same shape — a claim on the left, a small
 * piece of evidence on the right — and splitting it would produce two files
 * with one component each and no reason to differ.
 */
export function PermissionsSection() {
  return (
    <section id="permissions" className="scroll-mt-20 px-6 py-20">
      <div className="mx-auto grid max-w-[1024px] gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2
            className={cn(
              "max-w-[20ch] text-primary [font-weight:510]",
              "text-[clamp(1.5rem,4vw,2rem)] leading-[1.125] [letter-spacing:-0.022em]",
            )}
          >
            Guests see what they were added to, and nothing else
          </h2>
          <p className="mt-4 max-w-[52ch] text-regular leading-[1.6] text-tertiary">
            Workspace roles, team roles and project membership resolve as a
            union — the highest applicable grant wins. Discoverability is a
            permission too: a team a guest is not in is not listable, not
            readable, and does not appear in search.
          </p>
          <p className="mt-4 max-w-[52ch] text-small leading-[1.6] text-quaternary">
            The last owner cannot be removed or demoted, and the check runs
            inside a transaction that locks the workspace row first — two
            concurrent demotions each reading &ldquo;two owners&rdquo; would
            otherwise both succeed.
          </p>
        </div>

        <ul className="flex flex-col gap-3">
          {[
            { role: "Owner", scope: "Everything, including deleting the workspace." },
            { role: "Admin", scope: "Everything except that. Implicitly a team admin." },
            { role: "Member", scope: "Public teams, and any team they belong to." },
            { role: "Guest", scope: "Only their explicit team and project memberships." },
          ].map((entry) => (
            <li
              key={entry.role}
              className={cn(
                "flex items-baseline gap-4 rounded-[var(--radius-lg)] border border-subtle",
                "bg-[var(--bg-panel)] px-4 py-3",
              )}
            >
              <span className="w-16 shrink-0 text-small text-primary [font-weight:var(--weight-medium)]">
                {entry.role}
              </span>
              <span className="min-w-0 text-small text-tertiary">{entry.scope}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
