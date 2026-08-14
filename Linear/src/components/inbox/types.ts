/**
 * The Inbox's wire shape.
 *
 * Separate from `data.ts` because that module is `server-only` — it reads the
 * database — and `inbox-list.tsx` is a client component. Importing the type
 * from there would drag the adapter into the browser bundle, which the
 * `server-only` package turns into a build error rather than a shipped
 * database driver. So the shape lives here, where both sides may see it, and
 * `data.ts` produces it.
 */

import type { NotificationType } from "@/domain/entities";

export interface InboxNotification {
  readonly id: string;
  readonly type: NotificationType;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly snoozedUntilAt: string | null;
  readonly actor: { readonly name: string; readonly id: string };
  /** Null for a project notification, which carries no issue. */
  readonly issue: {
    readonly id: string;
    readonly identifier: string;
    readonly title: string;
    readonly stateType: string;
    readonly stateColor: string;
    readonly teamName: string;
    readonly href: string;
  } | null;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly href: string;
  } | null;
}
