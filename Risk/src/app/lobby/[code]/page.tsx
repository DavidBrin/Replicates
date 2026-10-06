import type { Metadata } from "next";

import LobbyRoom from "@/components/online/LobbyRoom";

export const metadata: Metadata = { title: "Lobby" };

/** `/lobby/[code]` — the lobby room (SPEC §7). */
export default async function LobbyRoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <LobbyRoom code={code.toUpperCase()} />;
}
