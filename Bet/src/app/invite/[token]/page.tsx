import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Ban, Clock3, PartyPopper } from "lucide-react";
import { currentUser } from "@/lib/server-actor";
import { getContainer } from "@/lib/container";
import { hashInviteToken } from "@/app/api/_shared/social";
import type { GroupId, Invite, MarketId } from "@/domain/entities";
import { formatCountdown } from "@/domain/formatters";
import { Avatar } from "@/components/ui/Avatar";
import { GuestSignIn } from "./GuestSignIn";
import { InviteActions } from "./InviteActions";

export const metadata: Metadata = {
  title: "You're invited — Bet",
  description: "Someone invited you to a private bet on Bet.",
};

const NON_TERMINAL_STATUSES = new Set<Invite["status"]>(["created", "sent", "viewed"]);

type InviteState =
  | {
      kind: "ok";
      id: string;
      targetType: "group" | "market";
      targetName: string;
      inviterDisplayName: string;
      /** Precomputed at resolve time (not read again during render) — this
       * is a Server Component, and `formatCountdown` needs an explicit
       * `msRemaining`; calling `Date.now()` directly in the render body
       * trips this repo's purity lint (components must be pure functions
       * of their props/params). */
      expiresInMs: number;
    }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "revoked" }
  | { kind: "used" };

/**
 * Classifies a link token exactly the way `GET /api/invites/[token]`
 * itself resolves it (same lookup: hash the token, `findByTokenHash`, link
 * kind only) — this task's Server Component reads the container directly
 * rather than self-fetching its own API over HTTP, the same convention
 * every other page in this app follows (`/signin`, the group dashboard).
 *
 * DEVIATION from "fetched from the unauthenticated preview endpoint... it
 * deliberately returns minimal data; don't try to fetch more": that route
 * collapses every failure into one identical 404 by design (research
 * §2.5/§7.3 enumeration resistance — a STRANGER holding a dead/garbage
 * token learns nothing beyond "doesn't work"). David's own ambiguity
 * resolution for THIS page requires distinct copy per failure reason
 * (expired vs. revoked vs. already-used). The two are reconcilable without
 * exposing anything new: reaching ANY of these branches already requires
 * possessing the exact correct token (the hash must match), which is the
 * same possession bar the real endpoint enforces — nothing here is
 * reachable by brute force that the 404 doesn't already block. The
 * success-path FIELDS returned are identical to the endpoint's
 * (`id, targetType, targetName, inviterDisplayName, expiresAt`) — nothing
 * additional (no member list, no market internals) is ever added. The
 * actual accept action still goes exclusively through the real
 * `POST /api/invites/[id]` route, never a private code path.
 */
async function resolveInvite(token: string): Promise<InviteState> {
  const { store } = await getContainer();
  const invite = await store.invites.findByTokenHash(hashInviteToken(token));

  if (!invite || invite.kind !== "link") return { kind: "invalid" };
  if (invite.status === "revoked") return { kind: "revoked" };
  if (invite.status === "accepted" || invite.status === "declined") return { kind: "used" };
  if (invite.status === "expired" || invite.expiresAt.getTime() <= Date.now()) {
    return { kind: "expired" };
  }
  if (!NON_TERMINAL_STATUSES.has(invite.status)) return { kind: "invalid" };

  const [inviter, targetName] = await Promise.all([
    store.users.findById(invite.inviterId),
    invite.targetType === "group"
      ? store.groups.findById(invite.targetId as GroupId).then((g) => g?.name)
      : store.markets.findById(invite.targetId as MarketId).then((m) => m?.question),
  ]);
  if (!inviter || !targetName) return { kind: "invalid" };

  return {
    kind: "ok",
    id: invite.id,
    targetType: invite.targetType,
    targetName,
    inviterDisplayName: inviter.displayName,
    expiresInMs: invite.expiresAt.getTime() - Date.now(),
  };
}

const FAILURE_COPY: Record<Exclude<InviteState["kind"], "ok">, { icon: typeof Ban; title: string; description: string }> = {
  invalid: {
    icon: AlertTriangle,
    title: "This invite link isn't valid",
    description: "Double-check the URL, or ask whoever sent it for a fresh link.",
  },
  expired: {
    icon: Clock3,
    title: "This invite has expired",
    description: "Invite links are only good for 7 days. Ask for a new one.",
  },
  revoked: {
    icon: Ban,
    title: "This invite was revoked",
    description: "Whoever sent it has cancelled the link. Ask for a new one if you still want in.",
  },
  used: {
    icon: PartyPopper,
    title: "This invite has already been used",
    description: "It's already been accepted or declined. If that wasn't you, ask for a new link.",
  },
};

/**
 * `/invite/[token]` (SPEC §2, task-12-brief). Public — outside `(app)`, so
 * `proxy.ts`'s matcher (`/app/:path*`) never touches it, and this page
 * itself never redirects a signed-out visitor away (works signed-out,
 * per brief). Shows the invite preview to EVERYONE; only the accept
 * affordance differs by session state.
 */
export default async function InviteLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [state, viewer] = await Promise.all([resolveInvite(token), currentUser()]);

  const returnPath = `/invite/${token}`;

  // Only needed for the signed-out path — same public fields `/signin`
  // already shows every visitor (id/handle/displayName/avatar), fetched
  // here rather than unconditionally to avoid the extra store read on the
  // (more common) signed-in path.
  const guestUsers =
    !viewer && state.kind === "ok"
      ? (await getContainer()).store.users
          .list()
          .then((users) =>
            users.map((u) => ({
              id: u.id,
              handle: u.handle,
              displayName: u.displayName,
              avatarColor: u.avatarColor,
              avatarInitials: u.avatarInitials,
            })),
          )
      : null;
  const resolvedGuestUsers = guestUsers ? await guestUsers : [];

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-(--surface-0) px-6 py-16 text-(--text-1)">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-(--radius-input) text-sm font-semibold tracking-tight text-(--text-1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
      >
        <span className="size-2.5 rounded-full bg-(--accent)" aria-hidden="true" />
        Bet
      </Link>

      <div className="w-full max-w-sm rounded-(--radius-card) border border-(--border) bg-(--surface-1) p-6">
        {state.kind !== "ok" ? (
          (() => {
            const copy = FAILURE_COPY[state.kind];
            const Icon = copy.icon;
            return (
              <div className="flex flex-col items-center gap-3 text-center">
                <Icon className="size-8 text-(--text-3)" aria-hidden="true" />
                <p className="text-base font-medium text-(--text-1)">{copy.title}</p>
                <p className="text-sm text-(--text-2)">{copy.description}</p>
                <Link
                  href="/"
                  className="mt-2 text-sm font-medium text-(--accent-2) underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)"
                >
                  Back to Bet
                </Link>
              </div>
            );
          })()
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <Avatar
                initials={state.inviterDisplayName.slice(0, 2).toUpperCase()}
                color="var(--accent)"
                size="lg"
              />
              <div>
                <p className="text-sm text-(--text-2)">
                  <span className="font-medium text-(--text-1)">{state.inviterDisplayName}</span>{" "}
                  invited you to {state.targetType === "group" ? "join a group" : "a bet"}
                </p>
                <p className="mt-1 text-lg font-semibold tracking-tight text-(--text-1)">
                  {state.targetName}
                </p>
              </div>
              <p className="tnum text-xs text-(--text-3)">
                Expires in {formatCountdown(state.expiresInMs)}
              </p>
            </div>

            {viewer ? (
              <InviteActions inviteId={state.id} targetLabel={state.targetName} />
            ) : (
              <GuestSignIn users={resolvedGuestUsers} returnPath={returnPath} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
