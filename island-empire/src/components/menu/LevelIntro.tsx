"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PixelButton } from "@/components/ui/PixelButton";
import { PlayerDot } from "@/components/ui/PlayerDot";
import { Star, StarRow } from "@/components/ui/StarRow";
import { WoodPanel } from "@/components/ui/WoodPanel";
import { DIFFICULTIES, hasStar, isUnlocked, starsFor } from "@/content/campaign";
import { LEVEL_META, loadLevel, type LevelId } from "@/content/levels/index";
import { PLAYER_COLOURS, type Difficulty, type MapDefinition } from "@/engine/types";
import { useSessionConfig, type SeatConfig } from "@/game/sessionConfig";
import type { Progress } from "@/ports/localProgress";

import { Minimap } from "./Minimap";
import { readLocalProgress, useProgress } from "./useProgress";

/**
 * Level intro (SPEC §7 `/campaign/[levelId]/intro`): name, size, players,
 * hint, a preview, the star per difficulty, the Easy/Normal/Hard picker and
 * Start. Start writes `useSessionConfig` and routes to S2's play screen.
 */
const BIOME_LABEL = { grass: "Grassland", desert: "Desert", snow: "Snow" } as const;

export function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export interface LevelIntroProps {
  levelId: LevelId;
  /** Injected for tests; defaults to `localProgress`. */
  readProgress?: () => Progress;
  /** Injected for tests; defaults to a random seed. */
  seed?: number;
}

export function LevelIntro({ levelId, readProgress = readLocalProgress, seed }: LevelIntroProps) {
  const router = useRouter();
  const setConfig = useSessionConfig((s) => s.setConfig);
  const meta = LEVEL_META[levelId];
  const [map, setMap] = useState<MapDefinition | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  // Default the picker to the first difficulty not yet beaten.
  const progress = useProgress(readProgress, (p) => {
    setDifficulty(DIFFICULTIES.find((d) => !hasStar(p, levelId, d)) ?? "hard");
  });

  useEffect(() => {
    let live = true;
    void loadLevel(levelId).then((m) => {
      if (live) setMap(m);
    });
    return () => {
      live = false;
    };
  }, [levelId]);

  const unlocked = progress ? isUnlocked(progress, levelId) : false;
  const stars = progress ? starsFor(progress, levelId) : 0;

  const start = () => {
    const seats: SeatConfig[] = Array.from({ length: meta.players }, (_, index) => ({
      index,
      kind: index === 0 ? "human" : "ai",
      aiDifficulty: difficulty,
    }));
    setConfig({
      source: { kind: "campaign", levelId },
      seats,
      difficulty,
      seed: seed ?? newSeed(),
    });
    router.push(`/play/campaign/${levelId}`);
  };

  return (
    <main className="ie-sky flex min-h-dvh flex-col items-center px-4 pb-8 pt-4">
      <header className="mb-3 flex w-full max-w-[420px] items-center justify-between">
        <PixelButton href="/campaign" variant="cream" size="sm" aria-label="Back to the island">
          {"<"}
        </PixelButton>
        <div className="ie-outline ie-caps text-sm">Level: {Number(levelId)}</div>
      </header>

      <WoodPanel className="w-full max-w-[420px]" footer={<StarRow count={stars} size={22} />}>
        <h1 className="ie-outline ie-caps mb-2 text-center text-2xl">{meta.name}</h1>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <div className="shrink-0 rounded-md p-1" style={{ background: "var(--ie-card-cream)" }}>
            {map ? (
              <Minimap map={map} size={150} />
            ) : (
              <div className="flex h-[150px] w-[150px] items-center justify-center text-xs" style={{ color: "var(--ie-ink)" }}>
                LOADING…
              </div>
            )}
          </div>

          <dl className="ie-outline grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="ie-caps opacity-80">Size</dt>
            <dd data-testid="intro-size">
              {meta.size.width}×{meta.size.height}
            </dd>
            <dt className="ie-caps opacity-80">Land</dt>
            <dd>{BIOME_LABEL[meta.biome]}</dd>
            <dt className="ie-caps opacity-80">Players</dt>
            <dd className="flex items-center gap-1" data-testid="intro-players">
              {Array.from({ length: meta.players }, (_, i) => (
                <PlayerDot key={i} colour={PLAYER_COLOURS[i]!} title={i === 0 ? "You (blue)" : `${PLAYER_COLOURS[i]} AI`} />
              ))}
              <span className="ml-1">{meta.players}</span>
            </dd>
            <dt className="ie-caps opacity-80">Type</dt>
            <dd>{meta.tutorial ? "Tutorial" : "Puzzle"}</dd>
          </dl>
        </div>

        <p className="ie-bubble mt-4 block w-full text-center" style={{ fontSize: "0.75rem" }}>
          {meta.hint}
        </p>

        <fieldset className="mt-5">
          <legend className="ie-outline ie-caps mb-2 text-sm">Difficulty</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Difficulty">
            {DIFFICULTIES.map((d) => {
              const won = progress ? hasStar(progress, levelId, d) : false;
              const selected = d === difficulty;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`difficulty-${d}`}
                  data-won={won}
                  onClick={() => setDifficulty(d)}
                  className={`ie-btn ie-btn--sm flex-col gap-1 py-2 ${selected ? "ie-btn--yellow" : "ie-btn--wood ie-outline"}`}
                  style={selected ? { outline: "3px solid #fff", outlineOffset: -6 } : undefined}
                >
                  <Star lit={won} size={20} />
                  <span>{d}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-5">
          <PixelButton variant="green" size="lg" block onClick={start} disabled={!unlocked} data-testid="start-level">
            {unlocked ? "Start" : "Locked"}
          </PixelButton>
          {!unlocked && progress && (
            <p className="ie-outline ie-caps mt-2 text-center text-xs">Win the previous level first</p>
          )}
        </div>
      </WoodPanel>
    </main>
  );
}

export default LevelIntro;
