import type { Metadata } from "next";

import OnlineGame from "@/components/online/OnlineGame";

export const metadata: Metadata = { title: "Online game" };

/**
 * `/play/online/[gameId]` — the same `GameScreen` with the online props
 * supplied (SPEC §7).
 *
 * S5 **composes**; it builds no game UI. The route resolves the id and hands
 * it to the one client component that creates the `SyncPort`.
 */
export default async function OnlineGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <OnlineGame gameId={gameId} />;
}
