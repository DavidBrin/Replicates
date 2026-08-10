import type { Metadata } from "next";
import { getContainer } from "@/lib/container";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { SignInButton } from "./SignInButton";

export const metadata: Metadata = {
  title: "Sign in — Bet",
  description: "Pick a demo user to sign in as.",
};

/**
 * `/signin` (SPEC §2/§3): a plain server-rendered grid of seeded demo users
 * as cards. Server Component — it reads straight from the container's
 * `DataStore` (research/stack.md: "fetch data for the initial render in the
 * Server Component ... don't waterfall a client-side fetch"); the only
 * client-side code is the tiny `SignInButton` leaf.
 */
export default async function SignInPage() {
  const { store } = await getContainer();
  const users = await store.users.list();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-10 bg-(--surface-0) px-6 py-16 text-(--text-1)">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-medium tracking-wide text-(--accent-2)">Bet</p>
        <h1 className="text-3xl font-semibold tracking-tight text-(--text-1)">wanna bet?</h1>
        <p className="text-(--text-2)">This is a demo — pick a user to sign in as.</p>
      </div>

      {users.length === 0 ? (
        <p className="text-(--text-3)">No demo users yet.</p>
      ) : (
        <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {users.map((user) => (
            <SignInButton key={user.id} userId={user.id}>
              <Card interactive className="flex flex-col items-center gap-3 py-6 text-center">
                <Avatar initials={user.avatarInitials} color={user.avatarColor} size="lg" />
                <div>
                  <p className="font-medium text-(--text-1)">{user.displayName}</p>
                  <p className="text-sm text-(--text-2) tabular-nums">@{user.handle}</p>
                </div>
              </Card>
            </SignInButton>
          ))}
        </div>
      )}
    </main>
  );
}
