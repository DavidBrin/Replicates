import "server-only";

import { getRepositories } from "@/adapters/repositories";
import type { SessionUser } from "@/lib/auth/current-user";

/**
 * Where a signed-in visitor belongs.
 *
 * Every auth screen and the marketing page ask this, and none of them can
 * answer it themselves: the destination is `/{workspace}/my-issues`, and the
 * workspace is a property of the account that has just been established rather
 * than of the page the visitor was on. `/api/auth/signin` returns only the user
 * — deliberately, since the cookie is the payload — so the lookup happens on
 * the next server render.
 *
 * That is why the forms navigate to `/` and let it redirect, rather than
 * computing a destination on the client: the client cannot see the `httpOnly`
 * cookie it was just given, and a second round trip to ask "which workspaces am
 * I in?" would be a route whose only purpose is to work around that.
 *
 * ## The workspaceless case
 *
 * A brand-new account with no workspace and no accepted invitation has nowhere
 * to go. It gets `null`, and the caller shows the marketing page — which is the
 * only screen that makes sense for someone with a session and no membership,
 * and is a great deal better than an empty shell with no teams in it.
 */
export async function homeHref(user: SessionUser | null): Promise<string | null> {
  if (user === null) return null;
  const workspaces = await getRepositories().workspaces.listForUser(user.id);
  const first = workspaces[0];
  return first === undefined ? null : `/${first.urlKey}/my-issues`;
}

/**
 * The seeded demo accounts, for the sign-in page's one-click panel.
 *
 * Transcribed here rather than imported from `src/lib/seed.ts` because that
 * module is the fixture *builder*: it pulls in the schema, the ordering keys
 * and a scrypt implementation, none of which belong in a page's module graph.
 * `__tests__/demo-accounts.test.ts` reads the seed's source and fails if an
 * address here stops appearing in it, which is the drift that would matter.
 *
 * The team memberships below are read off `src/lib/seed.ts`'s `TEAMS` table and
 * **not** off `e2e/README.md`, whose summary is stale: it puts the member in
 * Design and the guest in Design only, while the fixture puts the member in
 * Engineering and Operations and the guest in Engineering alone. Design is the
 * private team, which is what makes it the interesting one to be outside of.
 */
export const DEMO_PASSWORD = "demo1234";

export const DEMO_ACCOUNTS = [
  { email: "owner@demo.test", label: "Owner", role: "all three teams" },
  { email: "admin@demo.test", label: "Admin", role: "Engineering, Design" },
  { email: "member@demo.test", label: "Member", role: "Engineering, Operations" },
  { email: "guest@demo.test", label: "Guest", role: "Engineering only" },
] as const;
