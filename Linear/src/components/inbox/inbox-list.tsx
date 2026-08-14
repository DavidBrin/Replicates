"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { InboxIcon } from "@/components/ui/icons";
import { StatusIcon } from "@/components/ui/icons/status-icon";
import { Shortcut } from "@/components/ui/kbd";
import { useToast } from "@/components/ui/toast-provider";
import type { StateType } from "@/domain/entities";
import { cn } from "@/lib/cn";
import { useKeyboardScope, type BindingInput } from "@/lib/keyboard";

import type { InboxNotification } from "./types";

/**
 * The Inbox.
 *
 * ## The keyboard model is the same one the issue list has
 *
 * `J`/`K` move a cursor that is **not** DOM focus, `U` toggles read, `Alt+U`
 * marks everything read, `H` snoozes and `Backspace` deletes — all registered
 * at the `view` scope, so a modal or a picker above them takes precedence
 * without this component knowing they exist. `research/04-interaction.md` §1.8
 * is the source for every one of those bindings, and they are the same keys the
 * `?` sheet advertises because both read `lib/keyboard/registry.ts`.
 *
 * `Enter` opens. The cursor is drawn with a left accent bar as well as a
 * background tint, because §9.7 requires the focused and selected states to be
 * distinguishable without relying on colour alone — and the app's row/hover
 * contrast is deliberately about two lightness points.
 *
 * ## Optimistic, with the row put back on failure
 *
 * Every mutation patches local state first and reverts only the touched field
 * if the request fails. Marking read is the most-repeated action in the
 * product; waiting a round trip per row for a checkbox to grey out is what
 * makes an inbox feel like a web page.
 *
 * **A rollback restores one notification, never the list.** Rows leave this list
 * for two unrelated reasons — a snooze and a delete — and both are in flight at
 * once the moment somebody works down their inbox at speed. Reverting a failed
 * snooze by re-rendering the array as it was when the snooze started puts every
 * row that has *since* been deleted back on screen, and the server has already
 * agreed those are gone: the next refresh takes them away again, so the user
 * sees a notification they dismissed reappear and then vanish. {@link restoreOne}
 * puts back exactly the row whose request failed, at the index it left from.
 *
 * `markAllRead` is the exception that proves the rule: it is one intention over
 * the whole list, so it is one request, and its rollback restores the whole
 * previous list rather than N individual fields.
 */

export interface InboxListProps {
  workspaceKey: string;
  initial: readonly InboxNotification[];
}

type Filter = "all" | "unread";

export function InboxList({ workspaceKey, initial }: InboxListProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<readonly InboxNotification[]>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [rawCursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  /**
   * Adopt a fresh server render.
   *
   * `router.refresh()` re-runs the page and hands down a new `initial`, and by
   * then every optimistic patch has been acknowledged — so adopting it wholesale
   * is correct. Done by comparing the previous prop *during render* rather than
   * in an effect: an effect would paint the stale list first and then replace
   * it, which is a visible flicker on a list the user is looking at.
   */
  const [adopted, setAdopted] = useState(initial);
  if (adopted !== initial) {
    setAdopted(initial);
    setItems(initial);
  }

  const visible = useMemo(
    () => (filter === "unread" ? items.filter((item) => item.readAt === null) : items),
    [items, filter],
  );

  // Clamped rather than corrected: deleting the last row must move the cursor
  // without a render whose only job is to move it back in range.
  const cursor = Math.min(rawCursor, Math.max(0, visible.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-cursor="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const patch = useCallback(
    (id: string, change: Partial<InboxNotification>) => {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, ...change } : item)),
      );
    },
    [],
  );

  /**
   * Put one notification back where it was.
   *
   * Idempotent — a row already present is left alone, so an undo racing a
   * failure cannot produce two copies — and clamped, because the list it returns
   * to is not the list it left: rows before it may have gone in the meantime.
   */
  const restoreOne = useCallback(
    (item: InboxNotification, index: number) => {
      setItems((current) => {
        if (current.some((entry) => entry.id === item.id)) return current;
        const next = [...current];
        next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
        return next;
      });
    },
    [],
  );

  const drop = useCallback((id: string) => {
    setItems((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const request = useCallback(
    async (
      id: string,
      body: Record<string, unknown>,
      revert: () => void,
      method: "PATCH" | "DELETE" = "PATCH",
    ) => {
      try {
        const response = await fetch(`/api/notifications/${id}`, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspace: workspaceKey, ...body }),
        });
        if (!response.ok) {
          revert();
          toast({ title: "That change did not stick.", variant: "error" });
          return;
        }
        // Only the unread badge in the shell depends on the server's count, so
        // a refresh is cheaper than threading it through a context this slice
        // does not own.
        router.refresh();
      } catch {
        revert();
        toast({ title: "Could not reach the server.", variant: "error" });
      }
    },
    [workspaceKey, router, toast],
  );

  const toggleRead = useCallback(
    (item: InboxNotification) => {
      const nextRead = item.readAt === null;
      const previous = item.readAt;
      patch(item.id, { readAt: nextRead ? new Date().toISOString() : null });
      void request(
        item.id,
        { read: nextRead },
        () => patch(item.id, { readAt: previous }),
      );
    },
    [patch, request],
  );

  const snooze = useCallback(
    (item: InboxNotification) => {
      // Tomorrow at nine. A snooze *menu* with five options is the right
      // product and a wider surface than this slice owns; one sensible default
      // is the honest version of shipping the feature rather than a stub of it.
      const until = new Date();
      until.setDate(until.getDate() + 1);
      until.setHours(9, 0, 0, 0);
      const index = items.findIndex((entry) => entry.id === item.id);

      // Snoozing hides the row, because that is what snoozing *is*: `loadInbox`
      // filters out anything snoozed into the future, so leaving it on screen
      // with a badge would contradict what the next server render returns.
      drop(item.id);
      void request(item.id, { snoozeUntil: until.toISOString() }, () =>
        restoreOne(item, index),
      );
      toast({
        title: `Snoozed until ${until.toLocaleDateString(undefined, {
          weekday: "short",
        })} 9:00`,
        undo: () => {
          restoreOne(item, index);
          void request(item.id, { snoozeUntil: null }, () => drop(item.id));
        },
      });
    },
    [items, drop, request, restoreOne, toast],
  );

  const remove = useCallback(
    (item: InboxNotification) => {
      const index = items.findIndex((entry) => entry.id === item.id);
      drop(item.id);
      void request(item.id, {}, () => restoreOne(item, index), "DELETE");
    },
    [items, drop, request, restoreOne],
  );

  const markAllRead = useCallback(() => {
    const snapshot = items;
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.readAt === null ? { ...item, readAt: now } : item)),
    );

    void (async () => {
      try {
        const response = await fetch("/api/notifications", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspace: workspaceKey, action: "markAllRead" }),
        });
        if (!response.ok) {
          setItems(snapshot);
          toast({ title: "Could not mark everything read.", variant: "error" });
          return;
        }
        router.refresh();
      } catch {
        setItems(snapshot);
        toast({ title: "Could not reach the server.", variant: "error" });
      }
    })();
  }, [items, workspaceKey, router, toast]);

  const open = useCallback(
    (item: InboxNotification) => {
      const href = item.issue?.href ?? item.project?.href;
      if (href === undefined) return;
      if (item.readAt === null) toggleRead(item);
      router.push(href);
    },
    [router, toggleRead],
  );

  const bindings = useMemo<BindingInput[]>(
    () => [
      {
        id: "view.cursorDown",
        run: () =>
          setCursor((current) =>
            visible.length === 0 ? 0 : Math.min(current + 1, visible.length - 1),
          ),
      },
      {
        id: "view.cursorUp",
        run: () => setCursor((current) => Math.max(0, current - 1)),
      },
      { id: "inbox.cursorDown", keys: "arrowdown", run: () => setCursor((c) => (visible.length === 0 ? 0 : Math.min(c + 1, visible.length - 1))) },
      { id: "inbox.cursorUp", keys: "arrowup", run: () => setCursor((c) => Math.max(0, c - 1)) },
      {
        id: "view.open",
        run: () => {
          const item = visible[cursor];
          if (item !== undefined) open(item);
        },
      },
      {
        id: "inbox.toggleRead",
        run: () => {
          const item = visible[cursor];
          if (item !== undefined) toggleRead(item);
        },
      },
      { id: "inbox.markAllRead", run: markAllRead },
      {
        id: "inbox.snooze",
        run: () => {
          const item = visible[cursor];
          if (item !== undefined) snooze(item);
        },
      },
      {
        id: "inbox.delete",
        run: () => {
          const item = visible[cursor];
          if (item !== undefined) remove(item);
        },
      },
    ],
    [cursor, visible, open, toggleRead, snooze, remove, markAllRead],
  );

  useKeyboardScope("view", bindings);

  const unread = items.filter((item) => item.readAt === null).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbox">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-subtle px-4">
        <InboxIcon size={16} className="text-tertiary" />
        <h1 className="text-small text-primary [font-weight:var(--weight-title)]">
          Inbox
        </h1>
        {unread > 0 ? (
          <span
            data-testid="inbox-unread-count"
            className="rounded-full bg-[var(--accent-tint)] px-1.5 text-micro text-accent-text tabular-nums"
          >
            {unread}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          <FilterTab
            active={filter === "all"}
            onClick={() => setFilter("all")}
            testId="inbox-filter-all"
          >
            All
          </FilterTab>
          <FilterTab
            active={filter === "unread"}
            onClick={() => setFilter("unread")}
            testId="inbox-filter-unread"
          >
            Unread
          </FilterTab>

          <Button
            data-testid="inbox-mark-all-read"
            size="sm"
            variant="ghost"
            disabled={unread === 0}
            onClick={markAllRead}
            trailing={<Shortcut keys="alt+u" />}
            className="ml-2 gap-2"
          >
            Mark all read
          </Button>
        </div>
      </header>

      {visible.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24">
          <InboxIcon size={24} className="text-quaternary" />
          <p data-testid="inbox-empty" className="text-small text-tertiary">
            {filter === "unread" ? "Nothing unread." : "Inbox zero."}
          </p>
          <p className="flex items-center gap-2 text-micro text-quaternary">
            Press <Shortcut keys="g i" /> from anywhere to come back.
          </p>
        </div>
      ) : (
        <ul
          ref={listRef}
          data-testid="inbox-list"
          className="min-h-0 flex-1 overflow-y-auto"
          // A grid of rows with a cursor that is not DOM focus: the container is
          // the tab stop and `aria-activedescendant` names the current row, the
          // same pattern the palette uses and for the same reason.
          role="listbox"
          aria-label="Notifications"
          aria-activedescendant={
            visible[cursor] === undefined
              ? undefined
              : `inbox-row-${visible[cursor]?.id}`
          }
          tabIndex={0}
        >
          {visible.map((item, index) => (
            <NotificationRow
              key={item.id}
              item={item}
              cursor={index === cursor}
              onOpen={() => open(item)}
              onHover={() => setCursor(index)}
              onToggleRead={() => toggleRead(item)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* =================================================================== row = */

function NotificationRow({
  item,
  cursor,
  onOpen,
  onHover,
  onToggleRead,
}: {
  item: InboxNotification;
  cursor: boolean;
  onOpen: () => void;
  onHover: () => void;
  onToggleRead: () => void;
}) {
  const unread = item.readAt === null;

  return (
    <li
      id={`inbox-row-${item.id}`}
      data-testid={`notification-${item.id}`}
      data-cursor={cursor}
      role="option"
      aria-selected={cursor}
      onClick={onOpen}
      onMouseEnter={onHover}
      className={cn(
        "relative flex h-11 cursor-pointer items-center gap-3 border-b border-subtle pr-4 pl-4",
        // The cursor gets a left accent bar *and* a tint. Colour alone is not
        // enough at a ~2-point background delta (§9.7).
        cursor && "bg-[var(--bg-selected)] before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-[var(--accent)]",
        !cursor && "hover:bg-[var(--bg-hover)]",
      )}
    >
      <button
        type="button"
        aria-label={unread ? "Mark as read" : "Mark as unread"}
        data-testid={`notification-read-${item.id}`}
        onClick={(event) => {
          // Otherwise the row's own click navigates away from the thing the
          // user just marked read.
          event.stopPropagation();
          onToggleRead();
        }}
        className="grid size-4 shrink-0 place-items-center"
      >
        <span
          className={cn(
            "size-2 rounded-full",
            unread ? "bg-[var(--accent)]" : "bg-transparent ring-1 ring-[var(--border-strong)]",
          )}
        />
      </button>

      <Avatar id={item.actor.id} name={item.actor.name} size={20} decorative />

      {item.issue !== null ? (
        <StatusIcon
          type={item.issue.stateType as StateType}
          {...(item.issue.stateColor === "" ? {} : { color: item.issue.stateColor })}
          size={14}
          decorative
        />
      ) : null}

      <span className="min-w-0 flex-1 truncate text-small">
        <span className={unread ? "text-primary" : "text-tertiary"}>
          <span className="[font-weight:var(--weight-medium)]">
            {item.actor.name}
          </span>{" "}
          {describe(item.type)}{" "}
        </span>
        {item.issue !== null ? (
          <>
            <span className="text-quaternary tabular-nums">
              {item.issue.identifier}
            </span>{" "}
            <span className={unread ? "text-primary" : "text-tertiary"}>
              {item.issue.title}
            </span>
          </>
        ) : (
          <span className={unread ? "text-primary" : "text-tertiary"}>
            {item.project?.name ?? ""}
          </span>
        )}
      </span>

      <time
        dateTime={item.createdAt}
        className="w-14 shrink-0 text-right text-micro text-quaternary tabular-nums"
      >
        {relative(item.createdAt)}
      </time>
    </li>
  );
}

function FilterTab({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-[var(--radius-md)] px-2 py-1 text-mini",
        active ? "bg-[var(--bg-elevated)] text-primary" : "text-tertiary hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The verb for a notification type.
 *
 * A record rather than a switch, so adding a `NotificationType` without a
 * sentence is visible here instead of rendering as a blank in the middle of a
 * row.
 */
function describe(type: InboxNotification["type"]): string {
  const phrases: Readonly<Record<InboxNotification["type"], string>> = {
    issue_assigned: "assigned you",
    issue_unassigned: "unassigned you from",
    issue_status_changed: "changed the status of",
    issue_commented: "commented on",
    comment_replied: "replied on",
    issue_mentioned: "mentioned you in",
    comment_mentioned: "mentioned you in a comment on",
    project_update: "posted an update on",
    issue_due_soon: "— due soon:",
  };
  return phrases[type];
}

/** Compact relative time. `3d`, `2h`, `now` — the width a list row can spare. */
function relative(iso: string): string {
  const delta = Date.now() - Date.parse(iso);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
