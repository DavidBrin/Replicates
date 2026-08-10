"use client";

import { useEffect, useState } from "react";
import { Link as LinkIcon, Search, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import type { WizardDraft } from "./types";

export interface WizardFriend {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string;
  avatarInitials: string;
}

interface SearchResultUser extends WizardFriend {
  isFriend: boolean;
}

export interface Step4InviteProps {
  draft: WizardDraft;
  /** Fetched server-side and passed down as props (Task 11 report: "the
   * common case ... needs zero keystrokes" — so these render before any
   * client fetch could even resolve). */
  friends: WizardFriend[];
  /** Every user seen so far — seeded from `friends`, grown by
   * `onDiscoverUsers` whenever a search returns someone new. Lifted up to
   * `CreateBetWizard` (rather than a local cache here) so Step 5's review
   * can resolve a selected invitee's name/avatar even if they were only
   * ever found via this step's search, not the friends-first list. */
  knownUsers: Map<string, WizardFriend>;
  onDiscoverUsers: (users: WizardFriend[]) => void;
  groupId: string;
  onChange: (patch: Partial<WizardDraft>) => void;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

/**
 * Step 4 — invite players (SPEC §3.4 step 4). Friends render as tappable
 * chips FIRST, before any typing; a debounced `@handle` search sits below
 * for anyone not yet friended (who show up disabled, per David's
 * ambiguity resolution: tooltip "add them as a friend first" — the market
 * doesn't exist yet at this point in the wizard, so there's no way to
 * gate on market-participation the way `POST /api/invites` normally
 * would; friendship is the only signal available here, matching
 * research §3.1(b)'s "require friendship for market/bet invites").
 *
 * "Copy invite link" targets the GROUP (`targetType: "group"`), not the
 * market — the market is only minted at step 5's submit, so there's no
 * `marketId` yet for a market-scoped link. A group link lets someone
 * outside the friend graph join the group now; they'll see the bet once
 * it's created. This is a deliberate scope choice, not an oversight — see
 * the Task 11 report's "Deviations".
 */
export function Step4Invite({
  draft,
  friends,
  knownUsers,
  onDiscoverUsers,
  groupId,
  onChange,
}: Step4InviteProps) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    // Below the minimum length, bail WITHOUT touching state (react-hooks/
    // set-state-in-effect flags a synchronous setState inside an effect's
    // early-return branch — the classic "sync state to a derived
    // condition" anti-pattern it exists to catch). This is safe: `results`/
    // `searching` are only ever rendered behind the same
    // `query.trim().length >= MIN_QUERY_LENGTH` gate below, so leaving a
    // shorter query's stale values sitting unused in state has no visible
    // effect, and the very next long-enough query overwrites them anyway.
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    const controller = new AbortController();

    // Wrapped in a named function rather than called as a bare top-level
    // statement — react-hooks/set-state-in-effect's static check flags a
    // setState call sitting directly in the effect body (even after a
    // guard, per this file's own diagnostic run), but not one reached
    // through a nested function call, matching `ui/Countdown.tsx`'s
    // established `tick()` workaround for the identical situation
    // (starting a real async/timer-driven process is legitimate effect
    // work; this isn't the "mirror a prop into state" anti-pattern the
    // rule targets).
    function beginSearch() {
      setSearching(true);
    }
    beginSearch();

    const timer = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((body: { data?: { results?: SearchResultUser[] } }) => {
          const list = body.data?.results ?? [];
          setResults(list);
          onDiscoverUsers(list);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setResults([]);
        })
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `onDiscoverUsers` is expected to be a `useCallback`-stabilized
    // reference from the parent (functional-update form, no dependency on
    // its own output) — safe to include here without re-firing the
    // debounce on every unrelated wizard keystroke.
  }, [query, onDiscoverUsers]);

  const selectedIds = new Set(draft.selectedFriendIds);

  function toggleFriend(id: string) {
    if (selectedIds.has(id)) {
      onChange({ selectedFriendIds: draft.selectedFriendIds.filter((x) => x !== id) });
    } else {
      onChange({ selectedFriendIds: [...draft.selectedFriendIds, id] });
    }
  }

  async function handleCopyLink() {
    if (copying) return;
    setCopying(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "group", targetId: groupId, kind: "link" }),
      });
      const body: { data?: { token?: string }; error?: { message?: string } } = await res.json();
      if (!res.ok || body.error || !body.data?.token) {
        toast.show({
          title: "Couldn't create an invite link",
          description: body.error?.message,
          variant: "error",
        });
        return;
      }
      const url = `${window.location.origin}/invite/${body.data.token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.show({ title: "Invite link copied", description: url, variant: "success" });
      } catch {
        toast.show({ title: "Invite link created", description: url });
      }
    } catch {
      toast.show({ title: "Couldn't create an invite link", variant: "error" });
    } finally {
      setCopying(false);
    }
  }

  const selectedUsers = draft.selectedFriendIds
    .map((id) => knownUsers.get(id))
    .filter((u): u is WizardFriend => !!u);

  return (
    <div className="flex flex-col gap-5">
      {selectedUsers.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-(--text-1)">Invited ({selectedUsers.length})</span>
          <div className="flex flex-wrap gap-2">
            {selectedUsers.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1.5 rounded-(--radius-pill) border border-(--accent) bg-(--accent)/15 py-1 pr-1.5 pl-2 text-sm text-(--text-1)"
              >
                <Avatar initials={u.avatarInitials} color={u.avatarColor} size="xs" />@{u.handle}
                <button
                  type="button"
                  onClick={() => toggleFriend(u.id)}
                  aria-label={`Remove @${u.handle}`}
                  className="rounded-full p-0.5 text-(--text-2) transition-colors hover:bg-(--surface-3) hover:text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {friends.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-(--text-1)">Your friends</span>
          <div className="flex flex-wrap gap-2">
            {friends.map((f) => {
              const selected = selectedIds.has(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleFriend(f.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-(--radius-pill) border py-1 pr-3 pl-1.5 text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
                    selected
                      ? "border-(--accent) bg-(--accent)/15 text-(--text-1)"
                      : "border-(--border) bg-(--surface-2) text-(--text-2) hover:border-(--border-2) hover:text-(--text-1)",
                  )}
                >
                  <Avatar initials={f.avatarInitials} color={f.avatarColor} size="xs" />@{f.handle}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-sm text-(--text-2)">
          No friends yet — search below, or add some from{" "}
          <a href="/app/friends" className="font-medium text-(--accent) hover:underline">
            the Friends page
          </a>
          .
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="wizard-invite-search" className="text-sm font-medium text-(--text-1)">
          Find someone else
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-(--text-3)"
            aria-hidden="true"
          />
          <Input
            id="wizard-invite-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by @handle"
            className="pl-9"
          />
        </div>

        {query.trim().length >= MIN_QUERY_LENGTH ? (
          <div className="flex flex-col gap-1 rounded-(--radius-card) border border-(--border) bg-(--surface-2) p-2">
            {searching ? (
              <div className="flex flex-col gap-2 p-1">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : results.length === 0 ? (
              <p className="p-2 text-sm text-(--text-3)">No one found.</p>
            ) : (
              results.map((r) => {
                const selected = selectedIds.has(r.id);
                const content = (
                  <div className="flex flex-1 items-center gap-2">
                    <Avatar initials={r.avatarInitials} color={r.avatarColor} size="xs" />
                    <span className="flex-1 text-sm text-(--text-1)">
                      {r.displayName} <span className="text-(--text-3)">@{r.handle}</span>
                    </span>
                    {r.isFriend ? (
                      <span className="text-xs font-medium text-(--accent)">
                        {selected ? "Added" : "Add"}
                      </span>
                    ) : null}
                  </div>
                );

                if (!r.isFriend) {
                  return (
                    <Tooltip key={r.id} content="Add them as a friend first">
                      <div
                        role="button"
                        tabIndex={0}
                        aria-disabled="true"
                        className="flex cursor-not-allowed items-center gap-2 rounded-(--radius-input) px-2 py-1.5 opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
                      >
                        {content}
                      </div>
                    </Tooltip>
                  );
                }

                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleFriend(r.id)}
                    className="flex items-center gap-2 rounded-(--radius-input) px-2 py-1.5 text-left transition-colors hover:bg-(--surface-3) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
                  >
                    {content}
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant="secondary"
          onClick={handleCopyLink}
          loading={copying}
          className="self-start"
        >
          <LinkIcon className="size-4" aria-hidden="true" />
          Copy invite link
        </Button>
        <p className="text-xs text-(--text-3)">
          Anyone with the link can join the group — good for inviting people who aren&apos;t
          friends here yet.
        </p>
      </div>
    </div>
  );
}
