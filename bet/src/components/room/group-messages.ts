/**
 * Pure timeline-building logic for the Room (SPEC §5.4): "messages grouped
 * by author with time separators, system trade events rendered as inline
 * chips, not bubbles." Deliberately factored out of `RoomPanel.tsx` so the
 * grouping rules (day separators, the consecutive-same-author window,
 * system messages always breaking a group) are unit-testable without
 * mounting React.
 *
 * No React, no I/O, no `next`/`react` import (consistent with the rest of
 * the codebase's "pure logic lives in a plain .ts sibling" pattern, e.g.
 * `domain/chart.ts` next to `ProbabilityChart.tsx`).
 */

/** Just enough about a participant to render an avatar/name in the timeline
 * — the market page's Server Component builds one of these per known
 * creator/holder and hands the map down as a plain prop. */
export interface RoomAuthorInfo {
  id: string;
  displayName: string;
  avatarInitials: string;
  avatarColor: string;
}

export interface RoomEntry {
  /** For a `pending` (optimistic, not-yet-echoed) entry, this IS the
   * client-generated id — there is no server id yet. */
  id: string;
  authorId: string | null;
  kind: "text" | "system";
  body: string;
  /** ISO timestamp. */
  at: string;
  /** Present on a real (server-persisted) row that was sent with a
   * client-generated id — used by `mergeRoomEntries` to reconcile it
   * against the matching pending optimistic entry. */
  clientId?: string;
  /** Set by `RoomPanel` for an optimistic send not yet echoed back by the
   * server — purely a rendering hint (e.g. reduced opacity), never affects
   * grouping/separator logic. */
  pending?: boolean;
}

export type RoomTimelineItem =
  | { type: "separator"; label: string; key: string }
  | { type: "system"; entry: RoomEntry; key: string }
  | { type: "group"; authorId: string; entries: RoomEntry[]; key: string };

/** Consecutive text messages from the same author within this window merge
 * into one visual group (one avatar/name/time header, stacked bodies) —
 * the common chat-UI convention. */
export const GROUP_GAP_MS = 5 * 60 * 1000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDaySeparator(d: Date, now: Date): string {
  const day = dayKey(d);
  if (day === dayKey(now)) return "Today";
  if (day === dayKey(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(d);
}

/**
 * Builds the ordered render timeline from `messages` (must already be
 * sorted ascending by `at` — oldest first, as displayed top-to-bottom).
 * `now` is explicit (never a hidden `Date.now()`, matching
 * `domain/formatters.ts`'s house discipline) so "Today"/"Yesterday" labels
 * stay deterministic and testable.
 */
export function buildRoomTimeline(messages: RoomEntry[], now: Date): RoomTimelineItem[] {
  const items: RoomTimelineItem[] = [];
  let lastDayKey: string | null = null;
  let currentGroup: { authorId: string; entries: RoomEntry[] } | null = null;

  function flushGroup(): void {
    if (currentGroup && currentGroup.entries.length > 0) {
      items.push({
        type: "group",
        authorId: currentGroup.authorId,
        entries: currentGroup.entries,
        key: `group-${currentGroup.entries[0]!.id}`,
      });
    }
    currentGroup = null;
  }

  for (const message of messages) {
    const at = new Date(message.at);
    const dk = dayKey(at);
    if (dk !== lastDayKey) {
      flushGroup();
      items.push({ type: "separator", label: formatDaySeparator(at, now), key: `sep-${dk}` });
      lastDayKey = dk;
    }

    if (message.kind === "system") {
      flushGroup();
      items.push({ type: "system", entry: message, key: `sys-${message.id}` });
      continue;
    }

    const authorId = message.authorId ?? "unknown";
    const last = currentGroup?.entries[currentGroup.entries.length - 1];
    const withinGroupWindow =
      !!currentGroup &&
      currentGroup.authorId === authorId &&
      !!last &&
      at.getTime() - new Date(last.at).getTime() <= GROUP_GAP_MS;

    if (withinGroupWindow && currentGroup) {
      currentGroup.entries.push(message);
    } else {
      flushGroup();
      currentGroup = { authorId, entries: [message] };
    }
  }
  flushGroup();

  return items;
}

/**
 * De-duplicates and orders a message list for display. `existing` is the
 * current local state (may include pending optimistic entries); `incoming`
 * is a freshly-fetched batch (from the initial load, a poll tick, or a
 * "load earlier" page). A real `incoming` row whose `clientId` matches a
 * still-pending local entry's `id` (see `RoomEntry`'s doc comment) replaces
 * that pending entry rather than appearing alongside it — this is the
 * "optimistic send, reconciled when the server echoes it back" behavior
 * (SPEC §5.4). Result sorts ascending by `(at, id)`.
 */
export function mergeRoomEntries(existing: RoomEntry[], incoming: RoomEntry[]): RoomEntry[] {
  const byKey = new Map<string, RoomEntry>();
  const keyFor = (e: RoomEntry) => (e.pending ? `pending:${e.id}` : `id:${e.id}`);

  for (const e of existing) byKey.set(keyFor(e), e);

  for (const e of incoming) {
    if (e.clientId) byKey.delete(`pending:${e.clientId}`);
    byKey.set(keyFor(e), e);
  }

  return [...byKey.values()].sort((a, b) => {
    const diff = new Date(a.at).getTime() - new Date(b.at).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}
