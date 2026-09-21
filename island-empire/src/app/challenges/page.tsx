"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { localProgress } from "@/adapters/localStorage/progress";
import { PixelText } from "@/components/editor/ui";
import type { Difficulty, MapDefinition, MapSummary } from "@/engine/types";
import { useSessionConfig } from "@/game/sessionConfig";
import { formatCountdown, hashSeed, nextMondayUtc } from "@/lib/weekly";

import { ChallengeCard } from "./ChallengeCard";

interface Current {
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  maps: MapSummary[];
}

/**
 * Weekly challenges (SPEC §7, `play-06.png`): three wood cards on the blue
 * background, medals from `localProgress`, and a countdown to the next
 * Monday 00:00 UTC computed on the client (D33).
 */
export default function ChallengesPage() {
  const router = useRouter();
  const setConfig = useSessionConfig((s) => s.setConfig);
  const [current, setCurrent] = useState<Current | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [medals, setMedals] = useState<Record<string, Difficulty[]>>({});
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/challenges/current")
      .then(async (response) => {
        if (!response.ok) throw new Error(`challenges unavailable (${response.status})`);
        const body = (await response.json()) as Current;
        if (cancelled) return;
        // Medals are keyed by "<weekKey>:<mapId>", so they are read once the
        // week is known — and here, in a callback, never during the effect body
        // (the server render has no localStorage to disagree with).
        setMedals(localProgress.read().challengeMedals);
        setCurrent(body);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCountdown(formatCountdown(nextMondayUtc(now).getTime() - now.getTime()));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const play = (map: MapDefinition, difficulty: Difficulty) => {
    if (!current || !map.id) return;
    const seed = hashSeed(current.weekKey);
    setConfig({
      source: { kind: "challenge", mapId: map.id, weekKey: current.weekKey },
      seats: map.players.map((p) => ({
        index: p.index,
        kind: p.index === 0 ? "human" : "ai",
        aiDifficulty: difficulty,
      })),
      difficulty,
      seed,
    });
    router.push(`/play/custom/${encodeURIComponent(map.id)}?challenge=${encodeURIComponent(current.weekKey)}&difficulty=${difficulty}`);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4" data-testid="challenges">
      <header className="flex flex-col items-center gap-1">
        <Link href="/" className="self-start text-white underline-offset-2 hover:underline">
          <PixelText>&lt; Menu</PixelText>
        </Link>
        <PixelText as="h1" className="text-center text-4xl text-[#52C73F] md:text-5xl">
          Weekly Challenges
        </PixelText>
        {current ? (
          <PixelText className="text-xs" >
            Week <span data-testid="challenge-week">{current.weekKey}</span>
          </PixelText>
        ) : null}
      </header>

      {error ? (
        <p className="rounded bg-[#1A1010]/40 p-3 text-sm text-[#FFB4A8]" data-testid="challenges-error">
          {error}
        </p>
      ) : null}

      {current && current.maps.length === 0 ? (
        <p className="rounded bg-[#1A1010]/40 p-3 text-sm text-[#F1E2B2]" data-testid="challenges-empty">
          No maps in the pool yet — save one in the <Link href="/editor" className="underline">editor</Link>.
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        {current?.maps.map((summary, i) => (
          <ChallengeCard
            key={summary.id}
            rank={i + 1}
            summary={summary}
            medals={medals[`${current.weekKey}:${summary.id}`] ?? []}
            countdown={countdown}
            onPlay={play}
          />
        ))}
      </div>
    </main>
  );
}
