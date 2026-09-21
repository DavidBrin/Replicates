"use client";

import { Suspense, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import type { Difficulty } from "@/engine/types";
import { PlayPage } from "@/components/game/PlayPage";
import { useSessionConfig, type SessionConfig } from "@/game/sessionConfig";

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

/**
 * `/play/custom/[mapId]` (SPEC §7): sourced from `GET /api/maps/[id]`.
 * `?challenge=<weekKey>` marks a weekly-challenge attempt so a win records
 * a medal instead of nothing.
 */
function CustomPlayPageInner() {
  const params = useParams<{ mapId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const stored = useSessionConfig((s) => s.config);
  const mapId = params.mapId;
  const weekKey = search.get("challenge");

  const config = useMemo<SessionConfig>(() => {
    if (stored && (stored.source.kind === "custom" || stored.source.kind === "challenge") && stored.source.mapId === mapId) {
      if (weekKey && stored.source.kind !== "challenge") return { ...stored, source: { kind: "challenge", mapId, weekKey } };
      return stored;
    }
    const q = search.get("difficulty");
    const difficulty = DIFFICULTIES.includes(q as Difficulty) ? (q as Difficulty) : "normal";
    return {
      source: weekKey ? { kind: "challenge", mapId, weekKey } : { kind: "custom", mapId },
      seats: [],
      difficulty,
      seed: 1,
    };
  }, [stored, mapId, weekKey, search]);

  return <PlayPage config={config} onQuit={() => router.push(weekKey ? "/challenges" : `/maps/${encodeURIComponent(mapId)}`)} />;
}

export default function CustomPlayPage() {
  return (
    <Suspense fallback={null}>
      <CustomPlayPageInner />
    </Suspense>
  );
}
