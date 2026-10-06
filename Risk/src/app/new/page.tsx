"use client";

/**
 * `Select a game type` (SPEC §7, `/new`).
 *
 * Three cards in one row — RGD shows five; `Basic Training` and
 * `Ranked 1v1` are out of scope. The footer carries the segmented
 * `FFA | 1v1` toggle and the green `BATTLE` pill, which writes the mode and
 * the format into `sessionConfigStore` and routes to `/new/map`.
 */
import { useRouter } from "next/navigation";

import { GameTypeCard } from "@/components/setup/GameTypeCard";
import { Pill } from "@/components/ui/Pill";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import type { IconName } from "@/components/ui/Icon";
import { sessionConfigStore, useSessionConfig, type GameMode, type MatchFormat } from "@/game/sessionConfig";

interface CardSpec {
  readonly mode: GameMode;
  readonly title: string;
  readonly description: string;
  readonly icon: IconName;
  readonly testId: string;
}

/** Titles and descriptions are verbatim from §7. */
const CARDS: readonly CardSpec[] = [
  { mode: "solo", title: "Solo", description: "Battle the AI", icon: "person", testId: "game-type-solo" },
  {
    mode: "pass-and-play",
    title: "Pass & Play",
    description: "Local, one shared device",
    icon: "screen",
    testId: "game-type-pass-and-play",
  },
  {
    mode: "online",
    title: "Online",
    description: "Casual games with other players",
    icon: "globe",
    testId: "game-type-online",
  },
];

export default function NewGamePage() {
  const router = useRouter();
  const mode = useSessionConfig((s) => s.mode);
  const format = useSessionConfig((s) => s.format);

  return (
    <main
      data-testid="new-game-screen"
      className="relative flex min-h-dvh flex-1 flex-col items-center justify-between gap-6 px-4 py-6"
      style={{ background: "radial-gradient(circle at 50% 35%, var(--chrome-900) 0%, var(--ocean-deep) 100%)" }}
    >
      <h1 className="on-board-text text-center" style={{ fontSize: "clamp(26px, 5vw, 48px)" }}>
        Select a game type
      </h1>

      <div
        role="radiogroup"
        aria-label="Select a game type"
        className="flex flex-wrap items-stretch justify-center gap-4 sm:gap-8"
      >
        {CARDS.map((card) => (
          <GameTypeCard
            key={card.mode}
            title={card.title}
            description={card.description}
            icon={card.icon}
            testId={card.testId}
            selected={mode === card.mode}
            onSelect={() => sessionConfigStore.getState().setMode(card.mode)}
          />
        ))}
      </div>

      <footer className="flex w-full flex-wrap items-center justify-center gap-6 pt-6">
        <SegmentedToggle<MatchFormat>
          testId="format-toggle"
          ariaLabel="Match format"
          value={format}
          options={[{ value: "ffa", label: "FFA" }, { value: "1v1", label: "1v1" }]}
          onChange={(next) => sessionConfigStore.getState().setFormat(next)}
        />
        {/* D115 — Online opens the lobby browser; the map and modifiers come with `Create`. */}
        <Pill label="BATTLE" testId="new-battle" onClick={() => router.push(mode === "online" ? "/lobby" : "/new/map")} />
      </footer>
    </main>
  );
}
