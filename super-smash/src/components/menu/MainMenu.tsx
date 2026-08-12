"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { FighterBust } from "@/components/ui/FighterBust";
import { SkewPanel, SkewTag } from "@/components/ui/SkewPanel";
import { Tile } from "@/components/ui/Tile";
import { SmashEmblem } from "./TitleScreen";
import { useRoster } from "@/lib/matchConfig";

interface Mode {
  id: string;
  label: string;
  sublabel: string;
  colour: string;
  href?: string;
}

/**
 * Ultimate's five modes, in Ultimate's order.
 *
 * Four of them are out of scope and stay on the screen anyway (SPEC §12). The
 * alternative — a main menu with one tile on it — would misrepresent the game
 * being reproduced, and would hide the fact that the omission is a decision
 * rather than an oversight. They are dimmed, they say why, and they do
 * nothing.
 */
const MODES: readonly Mode[] = [
  {
    id: "smash",
    label: "Smash",
    sublabel: "2–4 fighters · stock or timed · Smash Ball",
    // The lit red, not the ground red: the tile has to separate from the
    // banner it sits on, and at #AD0000 on #AD0000 it simply vanishes.
    colour: "var(--color-smash-red-lit)",
    href: "/rules",
  },
  { id: "spirits", label: "Spirits", sublabel: "Not built", colour: "var(--color-mode-spirits)" },
  { id: "games", label: "Games & More", sublabel: "Not built", colour: "var(--color-mode-games)" },
  { id: "vault", label: "Vault", sublabel: "Not built", colour: "var(--color-mode-vault)" },
  { id: "online", label: "Online", sublabel: "Not built", colour: "var(--color-mode-online)" },
];

const OUT_OF_SCOPE =
  "Deliberately out of scope — SPEC §12. This build is the versus mode only, which is what makes a faithful one reachable.";

export function MainMenu() {
  const router = useRouter();
  const roster = useRoster();
  const [cursor, setCursor] = useState(0);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * A roving tabindex rather than five tab stops: the real menu is driven with
   * a stick, one press moves one tile, and Tab landing on a dimmed Vault tile
   * three times on the way to the only live one would be a worse keyboard
   * experience than the console has.
   */
  const move = (delta: number) => {
    const next = (cursor + delta + MODES.length) % MODES.length;
    setCursor(next);
    tiles.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        setCursor(0);
        tiles.current[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        setCursor(MODES.length - 1);
        tiles.current[MODES.length - 1]?.focus();
        break;
      default:
        break;
    }
  };

  return (
    <main className="red-ground relative flex min-h-dvh flex-col overflow-hidden">
      {/* The lighter diagonal band that runs behind Ultimate's mode row… */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-[-20%] left-[18%] w-[26%] bg-smash-red-lit opacity-60"
        style={{ transform: "skewX(-12deg)" }}
      />
      {/* …and a band of shadow across the middle of it, so the tiles sit on
          something darker than they are and read as raised plates. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[16%] bottom-[16%]"
        style={{ background: "linear-gradient(180deg, transparent, rgb(0 0 0 / 0.4) 30%, rgb(0 0 0 / 0.4) 70%, transparent)" }}
      />

      <header className="relative z-10 flex items-center gap-4 px-6 pt-6 sm:px-10">
        <SmashEmblem className="w-10" />
        <SkewTag
          className="border-[3px] border-panel-ink bg-panel-ink"
          innerClassName="px-4 py-1 font-display text-lg tracking-[0.2em] text-white uppercase"
        >
          Super Smash
        </SkewTag>
        <SkewTag
          className="ml-auto border-[3px] border-panel-ink bg-smash-yellow"
          innerClassName="px-4 py-1 font-display text-sm tracking-[0.18em] text-panel-ink uppercase"
        >
          Main Menu
        </SkewTag>
      </header>

      <div className="relative z-10 flex flex-1 items-center px-4 py-8 sm:px-10">
        <div className="relative w-full">
          <ul className="flex h-[clamp(15rem,44vh,25rem)] w-full items-stretch gap-2 sm:gap-3">
            {MODES.map((mode, i) => (
              <li key={mode.id} className={mode.id === "smash" ? "flex-[1.7]" : "flex-1"}>
                <Tile
                  buttonRef={(el) => {
                    tiles.current[i] = el;
                  }}
                  className="h-full w-full"
                  label={mode.label}
                  sublabel={mode.sublabel}
                  colour={mode.colour}
                  disabled={!mode.href}
                  tooltip={mode.href ? undefined : OUT_OF_SCOPE}
                  tabIndex={cursor === i ? 0 : -1}
                  onFocus={() => setCursor(i)}
                  onKeyDown={onKeyDown}
                  onActivate={() => mode.href && router.push(mode.href)}
                  icon={mode.id === "smash" ? <SmashEmblem decorative className="w-10 opacity-90" /> : undefined}
                />
              </li>
            ))}
          </ul>

          {/* The medallion: a circular collage that overlaps the tile row
              rather than sitting beside it, which is what stops the row
              reading as a plain toolbar. It is decorative — every fighter in
              it is on the character select, announced properly.

              Sits high and left of centre on purpose. Every tile carries its
              label along its bottom edge, so a medallion centred on the row
              lands squarely on the second tile's name — which it did, and
              "SPIRITS" was unreadable underneath it. Riding above the label
              line keeps the overlap that makes the row read as depth without
              eating a word. */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-[38%] left-[25%] hidden aspect-square w-[clamp(9rem,18vw,15rem)] -translate-x-1/2 -translate-y-1/2 sm:block"
          >
            <div className="h-full w-full overflow-hidden rounded-full border-[6px] border-panel-ink shadow-[0_12px_0_rgb(0_0_0/0.4)]">
              <div className="grid h-full w-full grid-cols-3 grid-rows-2">
                {roster.fighters.slice(0, 6).map((fighter) => (
                  <FighterBust key={fighter.id} fighter={fighter} className="h-full w-full" />
                ))}
              </div>
            </div>
            <div className="absolute inset-[6px] rounded-full border-[4px] border-smash-yellow/80" />
          </div>
        </div>
      </div>

      <footer className="relative z-10 flex flex-wrap items-center gap-3 px-6 pb-6 sm:px-10">
        <SkewPanel
          className="border-[3px] border-panel-ink bg-panel-ink/70"
          innerClassName="px-4 py-2 text-xs font-bold tracking-wide text-white/80"
        >
          ← → to move · Enter to choose
        </SkewPanel>
        <Link
          href="/controls"
          className="border-[3px] border-panel-ink bg-panel-bone px-4 py-2 font-display text-sm tracking-[0.16em] text-panel-ink uppercase transition hover:bg-smash-yellow"
          style={{ transform: "skewX(-12deg)" }}
        >
          <span className="inline-block" style={{ transform: "skewX(12deg)" }}>
            Controls
          </span>
        </Link>
      </footer>
    </main>
  );
}
