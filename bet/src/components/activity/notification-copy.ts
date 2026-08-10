import type { NotificationType } from "@/domain/entities";

/**
 * Renders human copy + a deep link for one notification (task-12-brief:
 * "typed icons per notification kind ... each item deep-linking to the
 * relevant market/friend screen"). `payload` shapes vary per producer —
 * grepping every `notifications.insert` call across the tree
 * (`friends/requests/route.ts`, `friends/requests/[id]/route.ts`,
 * `invites/route.ts`, `invites/[id]/route.ts`, `markets/route.ts`,
 * `domain/services/trading.ts`, `domain/services/resolution.ts` — none of
 * them files this task owns) turned up two DIFFERENT shapes for
 * `bet_invite_received` alone (`{marketId, inviterHandle}` from the direct
 * invite route vs. `{marketId, question}` from the wizard's invite step),
 * so every field read here is optional and defensively typed — a missing
 * field degrades to a generic sentence rather than throwing or rendering
 * "undefined". `market_closing_soon` and `chat_mention` are declared in
 * `NotificationType` but nothing in the tree currently produces them
 * (confirmed by the same grep) — handled anyway so a future producer isn't
 * a silent crash here.
 */
export interface ResolvedMarketInfo {
  question: string;
  /** `null` when the market has no group (shouldn't happen for a private
   * market in practice) or the group couldn't be resolved — falls back to
   * a non-market href. */
  groupSlug: string | null;
}

export interface ActivityContent {
  title: string;
  subtitle?: string;
  href: string;
}

const ACTIVITY_FALLBACK_HREF = "/app/activity";

export function buildActivityContent(
  notification: { type: NotificationType; payload: Record<string, unknown> },
  marketsById: ReadonlyMap<string, ResolvedMarketInfo>,
): ActivityContent {
  const payload = notification.payload;
  const str = (key: string): string | undefined =>
    typeof payload[key] === "string" ? (payload[key] as string) : undefined;

  const marketId = str("marketId");
  const resolvedMarket = marketId ? marketsById.get(marketId) : undefined;
  const question = resolvedMarket?.question ?? str("question");
  const marketHref =
    resolvedMarket?.groupSlug && marketId
      ? `/app/g/${resolvedMarket.groupSlug}/m/${marketId}`
      : ACTIVITY_FALLBACK_HREF;

  switch (notification.type) {
    case "friend_request_received": {
      const from = str("fromHandle");
      return {
        title: from ? `@${from} sent you a friend request` : "You have a new friend request",
        href: "/app/friends?tab=requests",
      };
    }
    case "friend_request_accepted": {
      // `friends/requests/[id]/route.ts` names this field `toHandle` even
      // though it's the ACCEPTER's own handle (the recipient of THIS
      // notification is the original sender) — kept as-is, it's not this
      // task's file to rename.
      const accepter = str("toHandle");
      return {
        title: accepter
          ? `@${accepter} accepted your friend request`
          : "Your friend request was accepted",
        href: "/app/friends?tab=friends",
      };
    }
    case "bet_invite_received": {
      const inviter = str("inviterHandle");
      const label = question ? `"${question}"` : "a bet";
      return {
        title: inviter
          ? `@${inviter} invited you to ${label}`
          : `You were invited to ${label}`,
        href: marketHref,
      };
    }
    case "bet_invite_accepted": {
      const invitee = str("inviteeHandle");
      const label = question ? `"${question}"` : "your bet";
      return {
        title: invitee
          ? `@${invitee} accepted your invite to ${label}`
          : "Your invite was accepted",
        href: marketHref,
      };
    }
    case "market_resolved": {
      const winningLabel = str("winningLabel");
      const label = question ? `"${question}"` : "A market";
      return {
        title: winningLabel ? `${label} resolved — ${winningLabel} won` : `${label} resolved`,
        href: marketHref,
      };
    }
    case "market_closing_soon": {
      const label = question ? `"${question}"` : "A market";
      return { title: `${label} is closing soon`, href: marketHref };
    }
    case "chat_message": {
      // `domain/services/trading.ts` sends a ready-made human sentence as
      // `summary` for a trade on a market the recipient participates in
      // (task-12-brief calls this "trade on your market").
      const summary = str("summary");
      return {
        title: summary ?? (question ? `New activity on "${question}"` : "New activity on a bet you're in"),
        subtitle: summary && question ? `"${question}"` : undefined,
        href: marketHref,
      };
    }
    case "chat_mention": {
      const preview = str("preview") ?? str("body");
      return {
        title:
          preview ?? (question ? `You were mentioned in "${question}"` : "You were mentioned in a market chat"),
        href: marketHref,
      };
    }
  }
}
