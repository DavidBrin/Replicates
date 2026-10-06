import type { Metadata } from "next";

import LobbyBrowser from "@/components/online/LobbyBrowser";

export const metadata: Metadata = { title: "Online" };

/**
 * `/lobby` — the online lobby browser (SPEC §7).
 *
 * A server component that renders the client shell immediately, so Neon's
 * cold start is invisible: the free tier scales to zero after five minutes
 * idle and the first person through the door pays the few hundred
 * milliseconds of wake-up (§6.4).
 */
export default function LobbyPage() {
  return <LobbyBrowser />;
}
