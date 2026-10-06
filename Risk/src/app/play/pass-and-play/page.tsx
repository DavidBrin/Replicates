"use client";

/**
 * `/play/pass-and-play` — hot-seat 2–6 on one device (SPEC §7, §5.4).
 *
 * The same screen as `/play/solo`; the session raises the hand-off overlay
 * between two human turns, and `hidden` is what keeps the outgoing player
 * from reading the incoming player's fog.
 */
import { PlayPage } from "@/components/game/PlayPage";

export default function PassAndPlayPage() {
  return <PlayPage mode="pass-and-play" />;
}
