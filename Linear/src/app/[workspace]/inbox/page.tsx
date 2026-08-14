import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { loadInbox } from "@/components/inbox/data";
import { InboxList } from "@/components/inbox/inbox-list";
import { accessForPage } from "@/components/members/workspace-access";
import { currentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Inbox" };

/**
 * `/[workspace]/inbox`.
 *
 * ## Server-rendered, then hydrated
 *
 * The first list comes from the server render rather than a `useEffect` fetch:
 * the inbox is a landing surface — `G` `I` from anywhere — and a screen that
 * shows a skeleton for a round trip on every visit is a screen that feels slower
 * than the product it is copying. Mutations from then on are client-side and
 * optimistic, reconciled by `router.refresh()`.
 *
 * ## Why not signed in is a redirect and not a member is a 404
 *
 * They are different failures. Not signed in has an obvious remedy and the
 * remedy is a page, so it redirects. Not a member of this workspace must be
 * indistinguishable from the workspace not existing, or the URL becomes a way
 * to enumerate which workspace keys are real — so it is `notFound()`, exactly
 * as `accessForPage` documents.
 */
export default async function InboxPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;

  const user = await currentUser();
  if (user === null) redirect("/signin");

  const access = await accessForPage(workspace);
  if (access === null) notFound();

  const notifications = await loadInbox(
    access.db,
    access.actor,
    access.user,
    access.workspace.id,
  );

  return (
    <InboxList
      workspaceKey={access.workspace.urlKey}
      initial={notifications}
    />
  );
}
