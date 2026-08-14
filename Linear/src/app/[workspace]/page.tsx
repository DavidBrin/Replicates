/**
 * `/{workspace}` — a redirect, never a page.
 *
 * Linear opens on the view you were last in; this opens on **My Issues**, which
 * is the closest thing to a universally correct landing place: it is the one
 * screen every role can see, including a guest whose only team is private, and
 * it never 404s because it is scoped to the viewer rather than to a team.
 *
 * Redirecting rather than rendering the same content at two URLs keeps one
 * canonical address per screen — the sidebar's "My Issues" row and this
 * redirect resolve to the same path, so the active-row highlight has one thing
 * to compare against.
 */

import { redirect } from "next/navigation";

export default async function WorkspaceIndex({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  redirect(`/${encodeURIComponent(workspace)}/my-issues`);
}
