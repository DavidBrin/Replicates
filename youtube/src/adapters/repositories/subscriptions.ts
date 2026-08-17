import "server-only";

import type { SqlExecutor, SqlRow } from "@/adapters/db/driver";
import type { Channel, VideoCard } from "@/domain/types";

import {
  bool,
  first,
  nullableText,
  num,
  placeholders,
  text,
  timestamp,
} from "./shared";
import { toCard } from "./videos";

/**
 * The social graph: who follows whom, and what that produces to watch.
 *
 * There is no `subscriber_count` column. It is counted from the table on every
 * read, which is the deliberate opposite of the choice made for `view_count`,
 * and the difference is what the number is for. A view count is a display
 * figure nobody can audit and is written millions of times; a subscriber count
 * is the thing a creator checks against their own subscriber list, and a
 * denormalised copy that drifts by one is a bug report that cannot be closed.
 * Counting stays correct by construction and costs one index scan on an index
 * the schema already carries for the reverse lookup.
 */

export type NotificationLevel = "all" | "personalised" | "none";

export interface Subscription {
  readonly channelId: string;
  readonly notifications: NotificationLevel;
  readonly createdAt: Date;
}

/**
 * Subscribing to your own channel.
 *
 * YouTube hides the button rather than refusing the action, which is a UI
 * decision; refusing here makes it a rule, because the subscriber count is the
 * one number a creator compares against reality and a self-subscription makes
 * every channel's count start at one.
 */
export class CannotSubscribeToOwnChannelError extends Error {
  constructor(readonly channelId: string) {
    super(`A channel's owner cannot subscribe to it: ${channelId}`);
    this.name = "CannotSubscribeToOwnChannelError";
  }
}

export class ChannelNotFoundError extends Error {
  constructor(readonly channelId: string) {
    super(`No such channel: ${channelId}`);
    this.name = "ChannelNotFoundError";
  }
}

/**
 * Subscribe, or change the bell on an existing subscription.
 *
 * One statement, and it diagnoses its own failure. The ownership check has to
 * happen against the row as it is at write time — reading the channel first and
 * then inserting is a check whose answer can be stale by the time it is used,
 * and the two-statement version also costs a round trip on the common path to
 * pay for a case that almost never happens.
 */
export async function subscribe(
  sql: SqlExecutor,
  subscriberId: string,
  channelId: string,
  notifications: NotificationLevel = "personalised",
): Promise<Subscription> {
  const rows = await sql.query(
    `with target as (
       select id, owner_id from channels where id = $2
     ), upserted as (
       insert into subscriptions (subscriber_id, channel_id, notifications)
       select $1, $2, $3 from target where owner_id <> $1
       on conflict (subscriber_id, channel_id)
         do update set notifications = excluded.notifications
       returning notifications, created_at
     )
     select (select count(*) from target) as channel_exists,
            (select notifications from upserted) as notifications,
            (select created_at from upserted) as created_at`,
    [subscriberId, channelId, notifications],
  );

  const row = first(rows);
  if (!row || num(row, "channel_exists") === 0) {
    throw new ChannelNotFoundError(channelId);
  }
  // The insert selected no row, so the only surviving explanation is the
  // ownership guard in its `where`.
  if (row.notifications === null) {
    throw new CannotSubscribeToOwnChannelError(channelId);
  }

  return {
    channelId,
    notifications: text(row, "notifications") as NotificationLevel,
    createdAt: timestamp(row.created_at),
  };
}

/** `false` when there was nothing to unsubscribe from — pressing it twice is not an error. */
export async function unsubscribe(
  sql: SqlExecutor,
  subscriberId: string,
  channelId: string,
): Promise<boolean> {
  const removed = await sql.execute(
    `delete from subscriptions
      where subscriber_id = $1 and channel_id = $2`,
    [subscriberId, channelId],
  );
  return removed > 0;
}

/**
 * The bell. Distinct from {@link subscribe} because the UI offers it as a
 * separate control on an existing subscription, and because setting it on a
 * channel you do not follow should do nothing rather than quietly subscribe you.
 */
export async function setNotifications(
  sql: SqlExecutor,
  subscriberId: string,
  channelId: string,
  notifications: NotificationLevel,
): Promise<boolean> {
  const changed = await sql.execute(
    `update subscriptions set notifications = $3
      where subscriber_id = $1 and channel_id = $2`,
    [subscriberId, channelId, notifications],
  );
  return changed > 0;
}

export async function getSubscription(
  sql: SqlExecutor,
  subscriberId: string | null,
  channelId: string,
): Promise<Subscription | null> {
  if (!subscriberId) return null;

  const rows = await sql.query(
    `select channel_id, notifications, created_at
       from subscriptions
      where subscriber_id = $1 and channel_id = $2`,
    [subscriberId, channelId],
  );
  const row = first(rows);
  return row
    ? {
        channelId: text(row, "channel_id"),
        notifications: text(row, "notifications") as NotificationLevel,
        createdAt: timestamp(row.created_at),
      }
    : null;
}

/**
 * Which of these channels the viewer follows, in one query.
 *
 * The subscribe button appears beside every card in a search result and on
 * every row of a channel list, and asking per row is the same N+1 the feed
 * projection exists to avoid — just one that hides in a component instead of in
 * a repository.
 */
export async function filterSubscribed(
  sql: SqlExecutor,
  subscriberId: string | null,
  channelIds: readonly string[],
): Promise<Set<string>> {
  if (!subscriberId || channelIds.length === 0) return new Set();

  const rows = await sql.query(
    `select channel_id from subscriptions
      where subscriber_id = $1
        and channel_id in (${placeholders(channelIds.length, 2)})`,
    [subscriberId, ...channelIds],
  );
  return new Set(rows.map((row) => text(row, "channel_id")));
}

export async function countSubscribers(
  sql: SqlExecutor,
  channelId: string,
): Promise<number> {
  const rows = await sql.query(
    `select count(*) as n from subscriptions where channel_id = $1`,
    [channelId],
  );
  const row = first(rows);
  return row ? num(row, "n") : 0;
}

/**
 * The subscription list in the sidebar: every channel the viewer follows, with
 * the two counts its row shows, in one statement.
 *
 * Scalar subqueries rather than two `group by` joins. A left join to
 * `subscriptions` for the count and another to `videos` for the count would
 * multiply the two aggregates against each other and inflate both — a bug that
 * only appears once a channel has more than one of each, which is to say never
 * in the fixture that was used to write it.
 */
export async function listSubscriptions(
  sql: SqlExecutor,
  subscriberId: string | null,
): Promise<Channel[]> {
  if (!subscriberId) return [];

  const rows = await sql.query(
    `select c.id, c.owner_id, c.handle, c.name, c.description,
            c.avatar_key, c.banner_key, c.verified, c.created_at,
            (select count(*) from subscriptions s2 where s2.channel_id = c.id)
              as subscriber_count,
            (select count(*) from videos v
               where v.channel_id = c.id
                 and v.visibility = 'public'
                 and v.upload_status = 'ready'
                 and v.published_at is not null) as video_count
       from subscriptions s
       join channels c on c.id = s.channel_id
      where s.subscriber_id = $1
      order by lower(c.name), c.id`,
    [subscriberId],
  );
  return rows.map(toChannel);
}

export interface SubscriptionFeedOptions {
  readonly limit?: number;
  readonly offset?: number;
  /** Shorts have their own shelf on the subscriptions page, as on the home page. */
  readonly includeShorts?: boolean;
}

/**
 * Everything the viewer's subscriptions have published, newest first.
 *
 * The viewer and the subscriber are the same person here by definition, so
 * `$1` serves as both the watch-progress key and the subscription key — one
 * parameter, and no way for a caller to pass a feed of someone else's
 * subscriptions carrying their own resume positions.
 *
 * A signed-out viewer gets an empty feed rather than an error: `$1` is null,
 * the `in` matches nothing, and the page renders its sign-in prompt.
 */
export async function listSubscriptionFeed(
  sql: SqlExecutor,
  viewerId: string | null,
  options: SubscriptionFeedOptions = {},
): Promise<VideoCard[]> {
  const { limit = 40, offset = 0, includeShorts = false } = options;
  if (!viewerId) return [];

  const rows = await sql.query(
    `select v.id, v.title, v.channel_id,
            c.name       as channel_name,
            c.handle     as channel_handle,
            c.avatar_key as channel_avatar_key,
            c.verified   as channel_verified,
            v.thumbnail_key, v.preview_key, v.duration_seconds,
            v.view_count, v.published_at, v.is_short,
            wp.position_seconds as watched_seconds
       from videos v
       join channels c on c.id = v.channel_id
       join subscriptions s
         on s.channel_id = v.channel_id and s.subscriber_id = $1
       left join watch_progress wp
         on wp.video_id = v.id and wp.user_id = $1
      where v.visibility = 'public'
        and v.upload_status = 'ready'
        and v.published_at is not null
        ${includeShorts ? "" : "and not v.is_short"}
      order by v.published_at desc, v.id desc
      limit $2 offset $3`,
    [viewerId, limit, offset],
  );
  return rows.map(toCard);
}

function toChannel(row: SqlRow): Channel {
  return {
    id: text(row, "id"),
    ownerId: text(row, "owner_id"),
    handle: text(row, "handle"),
    name: text(row, "name"),
    description: text(row, "description"),
    avatarKey: nullableText(row, "avatar_key"),
    bannerKey: nullableText(row, "banner_key"),
    verified: bool(row, "verified"),
    subscriberCount: num(row, "subscriber_count"),
    videoCount: num(row, "video_count"),
    createdAt: timestamp(row.created_at),
  };
}
