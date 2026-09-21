"use client";

import { Suspense, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import type { Difficulty } from "@/engine/types";
import { PlayPage } from "@/components/game/PlayPage";
import { useSessionConfig, type SessionConfig } from "@/game/sessionConfig";

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

/**
 * `/play/campaign/[levelId]` (SPEC §7): the level intro writes the session
 * config; a cold deep link builds one from the URL (`?difficulty=`), and the
 * map's own seat kinds apply.
 */
function CampaignPlayPageInner() {
  const params = useParams<{ levelId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const stored = useSessionConfig((s) => s.config);
  const levelId = params.levelId;

  const config = useMemo<SessionConfig>(() => {
    if (stored && stored.source.kind === "campaign" && stored.source.levelId === levelId) return stored;
    const q = search.get("difficulty");
    const difficulty = DIFFICULTIES.includes(q as Difficulty) ? (q as Difficulty) : "normal";
    return { source: { kind: "campaign", levelId }, seats: [], difficulty, seed: 1 };
  }, [stored, levelId, search]);

  const levelNumber = Number.parseInt(levelId, 10);
  const nextId = Number.isFinite(levelNumber) && levelNumber < 12 ? String(levelNumber + 1).padStart(2, "0") : null;

  return (
    <PlayPage
      config={config}
      title={Number.isFinite(levelNumber) ? `Level: ${levelNumber}` : levelId}
      onQuit={() => router.push("/campaign")}
      onNextLevel={nextId ? () => router.push(`/campaign/${nextId}/intro`) : null}
    />
  );
}

export default function CampaignPlayPage() {
  return (
    <Suspense fallback={null}>
      <CampaignPlayPageInner />
    </Suspense>
  );
}
