"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useToast } from "@/components/ui/Toast";
import { useTradeRefresh } from "@/components/market/TradeRefreshProvider";
import { ApiError, getMessages, postMessage, type ApiMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { PollingRealtimeChannel } from "@/adapters/realtime/polling";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { mergeRoomEntries, type RoomAuthorInfo, type RoomEntry } from "./group-messages";

export interface RoomPanelProps {
  marketId: string;
  currentUserId: string;
  authors: Record<string, RoomAuthorInfo>;
  /** Ascending (oldest first) — the market page's Server Component's first
   * page of messages. */
  initialMessages: RoomEntry[];
  /** `?before=` token to fetch the page older than `initialMessages`, or
   * `null` if that first page was everything there is. */
  initialNextCursor: string | null;
  /** The server's `now` at render time, ISO — used only for the timeline's
   * "Today"/"Yesterday" separators, never re-derived client-side (matches
   * `formatters.ts`'s house discipline: no hidden `Date.now()`). */
  now: string;
  /** Room membership (`computeRoomFacts`'s `isMember`) — creator or a
   * current/former position holder. A bare pending invite can see the
   * market but isn't "in the room" yet. */
  canPost: boolean;
  className?: string;
}

const POLL_LIMIT = 30;

function toRoomEntry(m: ApiMessage): RoomEntry {
  return { id: m.id, authorId: m.authorId, kind: m.kind, body: m.body, at: m.at, clientId: m.clientId };
}

/**
 * The Room (SPEC §5.4): a keyset-paginated, author-grouped message list with
 * inline system-event chips, an optimistic composer, and a live tail
 * powered by `PollingRealtimeChannel` (`src/adapters/realtime/polling.ts`)
 * — every `setInterval`/`document.visibilityState` concern lives there,
 * this component only calls `subscribe`/`send`/`close`.
 */
export function RoomPanel({
  marketId,
  currentUserId,
  authors,
  initialMessages,
  initialNextCursor,
  now,
  canPost,
  className,
}: RoomPanelProps) {
  const toast = useToast();
  const { tick: refreshSignal } = useTradeRefresh();
  const [messages, setMessages] = useState<RoomEntry[]>(initialMessages);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const channelRef = useRef<PollingRealtimeChannel<RoomEntry> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const nowDate = useMemo(() => new Date(now), [now]);

  const fetchLatest = useCallback(async (): Promise<RoomEntry[]> => {
    const res = await getMessages(marketId, { limit: POLL_LIMIT });
    return res.messages.map(toRoomEntry);
  }, [marketId]);

  useEffect(() => {
    const channel = new PollingRealtimeChannel<RoomEntry>({
      fetchLatest,
      sendMessage: async (clientId, body) => {
        const res = await postMessage(marketId, { clientId, body });
        return toRoomEntry(res.message);
      },
    });
    channelRef.current = channel;
    channel.subscribe((incoming) => {
      setMessages((prev) => mergeRoomEntries(prev, incoming));
    });
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [marketId, fetchLatest]);

  // A trade (OrderTicket) or resolution action (ResolutionPanel) elsewhere
  // on the page bumps this — re-poll immediately rather than waiting for
  // the channel's own next scheduled tick, so the new system message
  // appears right away.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    void fetchLatest()
      .then((incoming) => setMessages((prev) => mergeRoomEntries(prev, incoming)))
      .catch(() => {
        // best-effort — the regular poll tick will catch up regardless.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  useEffect(() => {
    // Scroll only the Room's own message list to its latest entry — NOT
    // `Element.scrollIntoView`, which walks every scrollable ancestor
    // (including the page itself) to bring the target into view and, on
    // this page's layout, was dragging the whole market view down to the
    // Room's bottom on every load instead of staying put in its own
    // `overflow-y-auto` container. Setting `scrollTop` directly is scoped
    // to exactly this element.
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function loadEarlier(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await getMessages(marketId, { before: nextCursor, limit: POLL_LIMIT });
      setMessages((prev) => mergeRoomEntries(prev, res.messages.map(toRoomEntry)));
      setNextCursor(res.nextCursor);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't load earlier messages.";
      toast.show({ title: "Couldn't load more", description: message, variant: "error" });
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSend(body: string): Promise<void> {
    const clientId = nanoid();
    const optimistic: RoomEntry = {
      id: clientId,
      authorId: currentUserId,
      kind: "text",
      body,
      at: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => mergeRoomEntries(prev, [optimistic]));
    try {
      await channelRef.current?.send({ clientId, body });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Your message didn't send.";
      toast.show({ title: "Message failed", description: message, variant: "error" });
      setMessages((prev) => prev.filter((m) => m.id !== clientId));
    }
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-(--radius-card) border border-(--border) bg-(--surface-2)",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-(--border) px-4 py-3">
        <h2 className="text-sm font-semibold text-(--text-1)">
          Room <span className="tnum text-(--text-3)">· {Object.keys(authors).length} in</span>
        </h2>
      </div>

      <div ref={scrollContainerRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {nextCursor ? (
          <button
            type="button"
            onClick={loadEarlier}
            disabled={loadingMore}
            className="mx-auto rounded-(--radius-pill) border border-(--border) px-3 py-1 text-xs text-(--text-2) transition-colors hover:border-(--border-2) hover:text-(--text-1) disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load earlier messages"}
          </button>
        ) : null}

        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-(--text-3)">No messages yet — say something.</p>
        ) : (
          <MessageList messages={messages} authors={authors} currentUserId={currentUserId} now={nowDate} />
        )}
      </div>

      <Composer onSend={handleSend} disabled={!canPost} disabledReason="Trade in this market to join the room" />
    </div>
  );
}
