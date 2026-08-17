import { z } from "zod";

import { database } from "@/adapters/db";
import {
  CannotSubscribeToOwnChannelError,
  ChannelNotFoundError,
  setNotifications,
  subscribe,
  unsubscribe,
} from "@/adapters/repositories/subscriptions";
import { currentViewerId } from "@/lib/auth/guard";

/**
 * Subscribe, unsubscribe, and set the bell.
 *
 * Three actions rather than a boolean, because the measured control has three
 * states and not two: R9 §9.1 records the subscribed button as an icon-only
 * bell-plus-chevron pill whose whole purpose is to open the notification-level
 * menu — All / Personalised / None / Unsubscribe. A `{subscribed: boolean}`
 * body could not express the middle three.
 *
 * `setNotifications` is deliberately separate from `subscribe` in the
 * repository, and this route keeps that separation: setting a level on a
 * channel you do not follow returns `false` there and **does not** quietly
 * subscribe you. This maps that to a 404 rather than inventing a subscription.
 *
 * ## The literal union is the seam
 *
 * `SubscriptionLevel` in `components/channel/channel-header.tsx` re-declares
 * `"all" | "personalised" | "none"` because that component cannot import a
 * `server-only` module. The two are tied together *here*: the `z.enum` below is
 * passed straight to `subscribe`/`setNotifications`, whose parameter is the
 * repository's own `NotificationLevel`. A divergence is a type error in this
 * file, which is exactly where it should be.
 */

const Level = z.enum(["all", "personalised", "none"]);

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("subscribe"),
    channelId: z.string().min(1),
    /** Defaults to `personalised`, matching the repository's own default. */
    notifications: Level.optional(),
  }),
  z.object({
    action: z.literal("unsubscribe"),
    channelId: z.string().min(1),
  }),
  z.object({
    action: z.literal("notifications"),
    channelId: z.string().min(1),
    notifications: Level,
  }),
]);

export async function POST(request: Request): Promise<Response> {
  const viewerId = await currentViewerId(request);
  if (viewerId === null) {
    return Response.json(
      { error: "Sign in to subscribe to channels." },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Expected subscribe, unsubscribe or notifications with a channelId.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const command = parsed.data;
  const db = await database();

  try {
    switch (command.action) {
      case "subscribe": {
        const created = await subscribe(
          db,
          viewerId,
          command.channelId,
          command.notifications ?? "personalised",
        );
        return Response.json(created);
      }
      case "unsubscribe": {
        // `false` when there was nothing to remove. Pressing Unsubscribe twice
        // is not an error — the repository says so, and so does the response.
        const removed = await unsubscribe(db, viewerId, command.channelId);
        return Response.json({ subscribed: false, removed });
      }
      case "notifications": {
        const changed = await setNotifications(
          db,
          viewerId,
          command.channelId,
          command.notifications,
        );
        if (!changed) {
          return Response.json(
            { error: "You are not subscribed to that channel." },
            { status: 404 },
          );
        }
        return Response.json({ notifications: command.notifications });
      }
    }
  } catch (cause) {
    if (cause instanceof ChannelNotFoundError) {
      return Response.json({ error: "No such channel." }, { status: 404 });
    }
    if (cause instanceof CannotSubscribeToOwnChannelError) {
      // The repository raises this as a domain rule rather than a UI nicety:
      // a self-subscription makes every channel's count start at one. The UI
      // hides the button; this is the backstop for a caller that did not.
      return Response.json(
        { error: "You cannot subscribe to your own channel." },
        { status: 409 },
      );
    }
    throw cause;
  }
}
