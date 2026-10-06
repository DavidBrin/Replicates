"use client";

/** `/play/solo` — one human against 1–5 bots (SPEC §7). */
import { PlayPage } from "@/components/game/PlayPage";

export default function SoloPlayPage() {
  return <PlayPage mode="solo" />;
}
