"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { UserCard, type UserCardPerson } from "./UserCard";
import { mutualGroupCount, type MyGroupMembership } from "./mutual-groups";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export interface FriendEntry {
  user: UserCardPerson;
  mutualGroups: number;
  subtitle: string;
}

export interface RequestEntry {
  id: string;
  user: UserCardPerson;
  mutualGroups: number;
  subtitle: string;
}

interface SearchResult extends UserCardPerson {
  isFriend: boolean;
  hasPendingRequest: boolean;
}

export interface FriendsBoardProps {
  initialFriends: FriendEntry[];
  initialIncoming: RequestEntry[];
  initialOutgoing: RequestEntry[];
  myGroups: MyGroupMembership[];
}

type Envelope<T> = { data: T } | { error: { code: string; message: string } };

async function postJson<T>(url: string, body: unknown): Promise<Envelope<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Envelope<T>;
    return json;
  } catch {
    return { error: { code: "internal", message: "Network error — try again." } };
  }
}

/**
 * The Friends page's interactive core (SPEC §3.5): a debounced `@handle`
 * search, `Friends | Requests | Sent` tabs with counts, and Add / Accept /
 * Decline / Cancel actions — every one optimistic with rollback-on-failure
 * plus a toast (task-12-brief's ambiguity resolution, verbatim). Initial
 * data for all three tabs is server-rendered (`page.tsx`, reading straight
 * from the container like every other page in this app); this component
 * only takes over once the visitor starts interacting.
 *
 * Never renders another user's friend list, friend count, or anything
 * derived from it (D5) — `mutualGroups` is the one allowed cross-user
 * signal, computed from the VIEWER's own group memberships
 * (`mutual-groups.ts`), both for the server-supplied initial rows and for
 * live search results (search itself never returns it, so it's derived
 * here, client-side, from data the viewer already owns).
 */
export function FriendsBoard({
  initialFriends,
  initialIncoming,
  initialOutgoing,
  myGroups,
}: FriendsBoardProps) {
  const { show } = useToast();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const validTabs = new Set(["friends", "requests", "sent"]);
  const startTab = initialTab && validTabs.has(initialTab) ? initialTab : "friends";

  const [friends, setFriends] = useState(initialFriends);
  const [incoming, setIncoming] = useState(initialIncoming);
  const [outgoing, setOutgoing] = useState(initialOutgoing);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [addPendingHandle, setAddPendingHandle] = useState<string | null>(null);
  const [requestActionPendingId, setRequestActionPendingId] = useState<string | null>(null);

  // `searchOutcome.query` records which query the CURRENT `results`/`error`
  // belong to. "Pending" and "stale results should be hidden" are both
  // derived from comparing it to `debouncedQuery` at render time, rather
  // than tracked as their own `useState` — every actual `setState` call
  // below lives inside the fetch promise's `.then`/`.catch` (a real
  // callback boundary), never as a bare statement in the effect body
  // (this repo's `react-hooks/set-state-in-effect` purity rule forbids
  // that shape — see `RoomPanel.tsx`'s `channel.subscribe(callback)` for
  // the same pattern elsewhere in this codebase).
  const [searchOutcome, setSearchOutcome] = useState<{
    query: string;
    results: SearchResult[];
    error: string | null;
  }>({ query: "", results: [], error: null });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LENGTH) return;
    let cancelled = false;
    fetch(`/api/users/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((res) => res.json())
      .then((body: { data?: { results: SearchResult[] }; error?: { message?: string } }) => {
        if (cancelled) return;
        if (body.error) {
          setSearchOutcome({ query: debouncedQuery, results: [], error: body.error.message ?? "Search failed." });
        } else {
          setSearchOutcome({ query: debouncedQuery, results: body.data?.results ?? [], error: null });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSearchOutcome({ query: debouncedQuery, results: [], error: "Search failed. Try again." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const showResults = debouncedQuery.length >= MIN_QUERY_LENGTH;
  const searchSettledForCurrentQuery = searchOutcome.query === debouncedQuery;
  const searchPending = showResults && !searchSettledForCurrentQuery;
  const results = searchSettledForCurrentQuery ? searchOutcome.results : [];
  const searchError = searchSettledForCurrentQuery ? searchOutcome.error : null;

  async function sendRequest(target: SearchResult) {
    setAddPendingHandle(target.handle);
    const prevOutcome = searchOutcome;
    setSearchOutcome((prev) => ({
      ...prev,
      results: prev.results.map((r) => (r.id === target.id ? { ...r, hasPendingRequest: true } : r)),
    }));
    const res = await postJson<{
      request: { id: string; createdAt: string; to: UserCardPerson };
    }>("/api/friends/requests", { toHandle: target.handle });
    setAddPendingHandle(null);
    if ("error" in res) {
      setSearchOutcome(prevOutcome);
      show({
        title: "Couldn't send friend request",
        description: res.error.message,
        variant: "error",
      });
      return;
    }
    setOutgoing((prev) => [
      {
        id: res.data.request.id,
        user: res.data.request.to,
        mutualGroups: mutualGroupCount(target.id, myGroups),
        subtitle: "Just now",
      },
      ...prev,
    ]);
  }

  async function respondToRequest(request: RequestEntry, action: "accept" | "decline") {
    setRequestActionPendingId(request.id);
    const prevIncoming = incoming;
    const prevFriends = friends;
    setIncoming((prev) => prev.filter((r) => r.id !== request.id));
    if (action === "accept") {
      setFriends((prev) => [
        { user: request.user, mutualGroups: request.mutualGroups, subtitle: "Just now" },
        ...prev,
      ]);
    }
    const res = await postJson<unknown>(`/api/friends/requests/${request.id}`, { action });
    setRequestActionPendingId(null);
    if ("error" in res) {
      setIncoming(prevIncoming);
      setFriends(prevFriends);
      show({
        title: action === "accept" ? "Couldn't accept request" : "Couldn't decline request",
        description: res.error.message,
        variant: "error",
      });
    }
  }

  async function cancelRequest(request: RequestEntry) {
    setRequestActionPendingId(request.id);
    const prevOutgoing = outgoing;
    setOutgoing((prev) => prev.filter((r) => r.id !== request.id));
    const res = await postJson<unknown>(`/api/friends/requests/${request.id}`, {
      action: "cancel",
    });
    setRequestActionPendingId(null);
    if ("error" in res) {
      setOutgoing(prevOutgoing);
      show({
        title: "Couldn't cancel request",
        description: res.error.message,
        variant: "error",
      });
    }
  }

  const tabs = useMemo(
    () => [
      { id: "friends", label: `Friends (${friends.length})` },
      { id: "requests", label: `Requests (${incoming.length})` },
      { id: "sent", label: `Sent (${outgoing.length})` },
    ],
    [friends.length, incoming.length, outgoing.length],
  );
  const [activeTab, setActiveTab] = useState(startTab);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-(--text-3)"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by @handle or name…"
            aria-label="Search for people"
            className="pl-9"
          />
        </div>

        {showResults ? (
          <div className="flex flex-col gap-2 rounded-(--radius-card) border border-(--border) bg-(--surface-1) p-2">
            {searchPending ? (
              <div className="flex flex-col gap-2 p-1">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : searchError ? (
              <p className="p-2 text-sm text-(--no)">{searchError}</p>
            ) : results.length === 0 ? (
              <p className="p-2 text-sm text-(--text-3)">No one found for &ldquo;{debouncedQuery}&rdquo;.</p>
            ) : (
              results.map((result) => (
                <UserCard
                  key={result.id}
                  user={result}
                  mutualGroups={mutualGroupCount(result.id, myGroups)}
                  actions={
                    result.isFriend ? (
                      <Badge tone="accent">Friends</Badge>
                    ) : result.hasPendingRequest ? (
                      <Badge tone="neutral">Requested</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={addPendingHandle === result.handle}
                        onClick={() => sendRequest(result)}
                      >
                        <UserPlus className="size-3.5" aria-hidden="true" />
                        Add
                      </Button>
                    )
                  }
                />
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <Tabs tabs={tabs} value={activeTab} onChange={setActiveTab} />

        {activeTab === "friends" ? (
          friends.length === 0 ? (
            <EmptyState
              icon={<UserPlus className="size-8" aria-hidden="true" />}
              title="No friends yet"
              description="Search for someone above to send a friend request."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {friends.map((f) => (
                <UserCard
                  key={f.user.id}
                  user={f.user}
                  mutualGroups={f.mutualGroups}
                  subtitle={`Friends since ${f.subtitle}`}
                />
              ))}
            </div>
          )
        ) : null}

        {activeTab === "requests" ? (
          incoming.length === 0 ? (
            <EmptyState title="No pending requests" description="Incoming friend requests will show up here." />
          ) : (
            <div className="flex flex-col gap-2">
              {incoming.map((r) => (
                <UserCard
                  key={r.id}
                  user={r.user}
                  mutualGroups={r.mutualGroups}
                  subtitle={r.subtitle}
                  actions={
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        loading={requestActionPendingId === r.id}
                        onClick={() => respondToRequest(r, "accept")}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={requestActionPendingId === r.id}
                        onClick={() => respondToRequest(r, "decline")}
                      >
                        Decline
                      </Button>
                    </>
                  }
                />
              ))}
            </div>
          )
        ) : null}

        {activeTab === "sent" ? (
          outgoing.length === 0 ? (
            <EmptyState title="No sent requests" description="Requests you send will show up here until they're answered." />
          ) : (
            <div className="flex flex-col gap-2">
              {outgoing.map((r) => (
                <UserCard
                  key={r.id}
                  user={r.user}
                  mutualGroups={r.mutualGroups}
                  subtitle={r.subtitle}
                  actions={
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={requestActionPendingId === r.id}
                      onClick={() => cancelRequest(r)}
                    >
                      Cancel
                    </Button>
                  }
                />
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
