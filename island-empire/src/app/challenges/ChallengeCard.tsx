"use client";

import { useEffect, useState } from "react";

import { MapThumbnail } from "@/components/editor/MapThumbnail";
import { UI } from "@/components/editor/palette";
import { PixelButton, PixelText } from "@/components/editor/ui";
import type { Difficulty, MapDefinition, MapSummary } from "@/engine/types";
import { parseMapDefinition } from "@/lib/mapSchema";

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };

/** Trophy (#1), silver cup (#2), hourglass (#3) — pixel-ish inline SVGs. */
function RankIcon({ rank }: { rank: number }) {
  const common = { width: 40, height: 40, viewBox: "0 0 16 16", shapeRendering: "crispEdges" as const, "aria-hidden": true };
  if (rank === 1) {
    return (
      <svg {...common}>
        <path d="M3 2h10v1h1v3h-1v2h-1v1h-1v1h-1v2h2v2H4v-2h2v-2H5V9H4V8H3V6H2V3h1z" fill="#1A1010" />
        <path d="M4 3h8v3h-1v2h-1v1H6V8H5V6H4z" fill="#FED942" />
        <path d="M5 4h2v3H5z" fill="#FFF3A0" />
        <path d="M6 12h4v1H6z" fill="#D7A800" />
      </svg>
    );
  }
  if (rank === 2) {
    return (
      <svg {...common}>
        <path d="M3 2h10v1h1v3h-1v2h-1v1h-1v1h-1v2h2v2H4v-2h2v-2H5V9H4V8H3V6H2V3h1z" fill="#1A1010" />
        <path d="M4 3h8v3h-1v2h-1v1H6V8H5V6H4z" fill="#AFB9D2" />
        <path d="M5 4h2v3H5z" fill="#E6EAF2" />
        <path d="M6 12h4v1H6z" fill="#838A9C" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 1h10v2h-1v3h-1v1h-1v2h1v1h1v3h1v2H3v-2h1v-3h1V9h1V7H5V6H4V3H3z" fill="#1A1010" />
      <path d="M4 2h8v1H4zM4 13h8v1H4z" fill="#C08A4F" />
      <path d="M5 3h6v2H5zM6 5h4v1H6zM7 6h2v1H7z" fill="#F07C2A" />
      <path d="M7 9h2v1H7zM6 10h4v1H6zM5 11h6v2H5z" fill="#F0CE70" />
    </svg>
  );
}

function MedalDots({ won }: { won: Difficulty[] }) {
  return (
    <div className="flex items-center gap-1.5" data-testid="medal-dots" aria-label={`${won.length} of 3 medals`}>
      {DIFFICULTIES.map((difficulty) => {
        const has = won.includes(difficulty);
        return (
          <span
            key={difficulty}
            data-testid={`medal-${difficulty}`}
            data-won={has ? "true" : "false"}
            title={`${DIFFICULTY_LABEL[difficulty]}: ${has ? "won" : "not yet"}`}
            className="inline-block h-6 w-6 rounded-full border-2 border-white shadow-[0_0_0_2px_#1A1010]"
            style={{ background: has ? UI.medalGreen : UI.medalGrey }}
          />
        );
      })}
    </div>
  );
}

export function ChallengeCard({
  rank,
  summary,
  medals,
  countdown,
  onPlay,
}: {
  rank: number;
  summary: MapSummary;
  medals: Difficulty[];
  countdown: string;
  onPlay: (map: MapDefinition, difficulty: Difficulty) => void;
}) {
  const [map, setMap] = useState<MapDefinition | null>(null);
  const [failed, setFailed] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");

  useEffect(() => {
    // The parent keys each card by map id, so a new id remounts this
    // component — the state below starts fresh without a synchronous reset.
    let cancelled = false;
    fetch(`/api/maps/${encodeURIComponent(summary.id)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const parsed = parseMapDefinition(await response.json());
        if (!parsed.ok) throw new Error(parsed.errors[0]);
        if (!cancelled) setMap(parsed.map);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [summary.id]);

  return (
    <article
      data-testid="challenge-card"
      data-map-id={summary.id}
      className="overflow-hidden rounded-xl border-4 shadow-[0_6px_0_#1A1010]"
      style={{ background: UI.woodDark, borderColor: UI.woodLight }}
    >
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-stretch">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <RankIcon rank={rank} />
              <PixelText as="h2" className="text-3xl">
                #{rank}
              </PixelText>
            </div>
            <MedalDots won={medals} />
          </div>
          <div className="text-sm leading-tight">
            <PixelText as="p" className="truncate">
              Creator: <span data-testid="challenge-author">{summary.author}</span>
            </PixelText>
            <PixelText as="p" className="truncate">
              ID: <span data-testid="challenge-id">{summary.id}</span>
            </PixelText>
            <p className="truncate text-xs text-[#F1E2B2]">
              {summary.name} · {summary.width}×{summary.height} · {summary.players} players
            </p>
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-2">
            <PixelButton
              tone="green"
              className="px-8 py-2 text-xl"
              data-testid="challenge-play"
              disabled={!map}
              onClick={() => map && onPlay(map, difficulty)}
            >
              Play
            </PixelButton>
            <div className="flex rounded-md border-2 border-[#1A1010] bg-[#1A1010]/40 p-0.5" role="radiogroup" aria-label="Difficulty">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={difficulty === d}
                  data-testid={`difficulty-${d}`}
                  onClick={() => setDifficulty(d)}
                  className="rounded px-2 py-1 text-xs font-bold text-white"
                  style={{ background: difficulty === d ? UI.green : "transparent" }}
                >
                  {DIFFICULTY_LABEL[d]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className="flex shrink-0 items-center justify-center self-center rounded-lg border-4 p-1"
          style={{ borderColor: UI.khaki, background: UI.cream, width: 176, height: 176 }}
        >
          {map ? (
            <MapThumbnail map={map} size={160} testId="challenge-thumbnail" />
          ) : (
            <span className="text-xs text-[#1A1010]">{failed ? "Unavailable" : "Loading…"}</span>
          )}
        </div>
      </div>
      <footer className="py-1.5 text-center" style={{ background: UI.woodFooter }}>
        <PixelText className="text-sm" >
          Available <span data-testid="challenge-countdown">{countdown}</span>
        </PixelText>
      </footer>
    </article>
  );
}
