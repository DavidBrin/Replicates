import "server-only";

import { cookies } from "next/headers";

import { database } from "@/adapters/db";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import { listSubscriptions } from "@/adapters/repositories/subscriptions";
import { createUsersRepository } from "@/adapters/repositories/users";
import type { GuideSubscription } from "@/components/layout/guide";
import { thumbnailSrc } from "@/components/video";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth";

/**
 * Everything the app chrome needs about the current viewer.
 *
 * Extracted from `(main)/layout.tsx` when `/watch` needed the same thing. The
 * watch route sits outside the `(main)` group — its theatre mode is measured
 * full-bleed at 1920, which cannot nest inside a content column that has a
 * guide inset — so it cannot inherit that layout and has to build its own.
 * Two layouts resolving a session and loading a subscription list is one
 * function, not two copies that drift the first time the avatar rule changes.
 *
 * A plain `.ts` module beside the layouts rather than a route: only
 * `page`/`layout`/`route` files create routes, so this is invisible to the
 * router.
 */

export interface Chrome {
  readonly account: {
    readonly name: string;
    readonly avatarUrl: string | null;
  } | null;
  readonly subscriptions: readonly GuideSubscription[];
}

/**
 * A signed-out viewer costs one session lookup and nothing else:
 * `listSubscriptions` short-circuits on a null subscriber rather than running a
 * query that matches nothing, so the branch below is about not asking for a
 * user record and a channel that cannot exist.
 *
 * The account's picture comes from the viewer's **channel**, not from the user
 * row — `users` has no avatar column, because in this schema a picture belongs
 * to a channel and a user may own more than one. The first is used, which is
 * the same choice Studio's `studioContext` makes and the same one the product
 * makes when it puts a single avatar in the masthead.
 */
export async function loadChrome(): Promise<Chrome> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  const session = await resolveSession(token);
  if (!session) return { account: null, subscriptions: [] };

  const db = await database();
  const [user, channels, subscriptions] = await Promise.all([
    createUsersRepository(db).findById(session.userId),
    createChannelsRepository(db).listForOwner(session.userId),
    listSubscriptions(db, session.userId),
  ]);

  const own = channels[0];

  return {
    account: {
      // A session whose user row has been deleted resolves — the `sessions`
      // row is the grant, and nothing cascades it — so the name has a
      // fallback rather than an assertion. "You" is what the watch page uses
      // for the same case.
      name: user?.displayName ?? own?.name ?? "You",
      avatarUrl: own?.avatarKey ? thumbnailSrc(own.avatarKey) : null,
    },
    subscriptions: subscriptions.map(
      (channel): GuideSubscription => ({
        id: channel.id,
        name: channel.name,
        // `Channel.handle` is stored without the `@`, and `/@handle` is the
        // URL the card family already builds (`video-card.tsx`).
        href: `/@${encodeURIComponent(channel.handle)}`,
        avatarUrl: channel.avatarKey ? thumbnailSrc(channel.avatarKey) : null,
      }),
    ),
  };
}
