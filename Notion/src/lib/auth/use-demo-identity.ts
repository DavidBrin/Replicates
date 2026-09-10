"use client";

/**
 * Read-side hooks that overlay the ephemeral demo name onto the seeded
 * workspace data, without ever writing the demo name into
 * `useWorkspaceStore` itself (see `demo-auth-store.ts` for why).
 */

import { useMemo } from "react";
import { useWorkspaceStore } from "../store/workspace-store";
import { useDemoAuthStore } from "./demo-auth-store";
import type { Id, User } from "../model/types";

/** True when the visitor typed a name and signed in this session. */
export function useIsDemoSignedIn(): boolean {
  return useDemoAuthStore((s) => s.demoName !== null);
}

/**
 * The `User` record to render as "me": the seeded current user overlaid
 * with the typed name (avatarEmoji dropped so Avatar renders the typed
 * name's initials instead of the seeded user's emoji). Returns the seeded
 * record untouched when not signed in.
 */
export function useDemoIdentity(): { user: User | undefined; demoName: string | null } {
  const demoName = useDemoAuthStore((s) => s.demoName);
  const currentUserId = useWorkspaceStore((s) => s.currentUserId);
  const seeded = useWorkspaceStore((s) => s.users[currentUserId]);
  const user = useMemo(() => {
    if (!demoName || !seeded) return seeded;
    return { ...seeded, name: demoName, avatarEmoji: undefined };
  }, [demoName, seeded]);
  return { user, demoName };
}

/**
 * The whole `users` map with the current user overlaid the same way.
 * Returns the store's own object identity when not signed in, so this is
 * a no-op re-render-wise for anyone who never logs in.
 */
export function useDemoUsers(): Record<Id, User> {
  const demoName = useDemoAuthStore((s) => s.demoName);
  const currentUserId = useWorkspaceStore((s) => s.currentUserId);
  const users = useWorkspaceStore((s) => s.users);
  return useMemo(() => {
    if (!demoName) return users;
    const seeded = users[currentUserId];
    if (!seeded) return users;
    return { ...users, [currentUserId]: { ...seeded, name: demoName, avatarEmoji: undefined } };
  }, [demoName, users, currentUserId]);
}
