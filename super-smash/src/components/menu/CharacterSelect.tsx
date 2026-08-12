"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Cursor, GridCursor } from "@/components/ui/Cursor";
import { FighterBust } from "@/components/ui/FighterBust";
import { ModeTab, ScreenBanner } from "@/components/ui/Panel";
import { SkewArtWell, SkewButton, SkewCard, SkewPanel, SkewTag, Unskew } from "@/components/ui/SkewPanel";
import { Stepper } from "@/components/ui/Stepper";
import { cn } from "@/lib/cn";
import {
  MAX_CPU_LEVEL,
  MAX_PLAYERS,
  MIN_CPU_LEVEL,
  MIN_PLAYERS,
  RANDOM_FIGHTER,
  SCHEME_INFO,
  allPortsReady,
  findFighter,
  portColour,
  portTag,
  useMatchConfig,
  useRoster,
  type MenuFighter,
  type PlayerSlot,
} from "@/lib/matchConfig";

/**
 * Five, which puts the eight fighters and the random slot into two rows.
 *
 * Ultimate's grid is wide and short — the whole roster is visible at once and
 * the player panels sit under it without scrolling. With nine entries, five
 * columns is the arrangement that keeps that property on a laptop screen.
 */
const COLUMNS = 5;

/**
 * Character select — the screen the whole interface is judged on.
 *
 * The layout is Ultimate's: a red angled banner with the mode tab, the
 * portrait grid ordered by fighter number, and one sheared player panel per
 * port along the bottom, each carrying a white hand cursor with its port tag.
 *
 * Two players, one keyboard, and a cursor each is the console's model; a
 * browser page has exactly one focus ring, so the "which port am I choosing
 * for" question is answered by an explicit active port rather than by four
 * independent cursors. Pressing 1–4 switches port, and confirming a fighter
 * advances to the next empty panel, which is the same sequence the console
 * produces when players take turns.
 */
export function CharacterSelect() {
  const router = useRouter();
  const roster = useRoster();

  const players = useMatchConfig((s) => s.players);
  const setFighter = useMatchConfig((s) => s.setFighter);
  const addPlayer = useMatchConfig((s) => s.addPlayer);
  const removePlayer = useMatchConfig((s) => s.removePlayer);

  const [gridIndex, setGridIndex] = useState(0);
  const [requestedPort, setActivePort] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);

  /**
   * Clamped during render rather than corrected in an effect. Removing the
   * fourth player while their panel is the active one leaves the stored port
   * pointing past the end of the list; deriving the real one here means there
   * is never a frame rendered against a panel that does not exist, and no
   * cascading re-render to fix it afterwards.
   */
  const activePort = Math.min(requestedPort, players.length - 1);

  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  // Ultimate orders the grid by fighter number, and so does this — sorted here
  // rather than trusted from the roster module, because the order is a visible
  // property of the screen and should not depend on how the table was written.
  const fighters = useMemo(
    () => [...roster.fighters].sort((a, b) => a.number - b.number),
    [roster.fighters],
  );
  const entries: (MenuFighter | null)[] = useMemo(() => [...fighters, null], [fighters]);

  const ready = allPortsReady(players);
  const hoveredFighter = findFighter(roster, hovered);
  const activeFighter = findFighter(roster, players[activePort]?.fighterId ?? null);
  const previewFighter = hoveredFighter ?? activeFighter;

  const assign = useCallback(
    (fighterId: string) => {
      setFighter(activePort, fighterId);
      // Hand the cursor to the next empty panel, so filling four ports is four
      // presses rather than four presses and three port switches.
      const next = players.find((p) => p.port !== activePort && p.fighterId === null);
      if (next) setActivePort(next.port);
    },
    [activePort, players, setFighter],
  );

  const focusTile = useCallback((index: number) => {
    setGridIndex(index);
    tiles.current[index]?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inControl = Boolean(target?.closest?.("button, input, select, textarea, a[href]"));

      switch (event.key) {
        case "ArrowRight":
        case "ArrowLeft":
        case "ArrowDown":
        case "ArrowUp": {
          const delta =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? COLUMNS : -COLUMNS;
          const next = gridIndex + delta;
          if (next < 0 || next >= entries.length) return;
          event.preventDefault();
          focusTile(next);
          return;
        }
        case "Enter":
        case " ": {
          // A focused tile already handles its own activation; intervening
          // here as well would confirm the pick twice.
          if (inControl) return;
          event.preventDefault();
          assign(entries[gridIndex]?.id ?? RANDOM_FIGHTER);
          return;
        }
        case "Backspace":
          if (inControl) return;
          event.preventDefault();
          setFighter(activePort, null);
          return;
        case "+":
        case "=":
          event.preventDefault();
          addPlayer();
          return;
        case "-":
        case "_":
          event.preventDefault();
          removePlayer();
          return;
        default:
          break;
      }

      const port = Number(event.key) - 1;
      if (Number.isInteger(port) && port >= 0 && port < players.length) {
        setActivePort(port);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePort, addPlayer, assign, entries, focusTile, gridIndex, players.length, removePlayer, setFighter]);

  return (
    // A fixed-height column with the grid as the only scrolling part: the
    // player panels are where the screen is operated from, and a page that
    // pushes them below the fold makes the most important control on the most
    // important screen invisible until you scroll.
    <main className="flex h-dvh flex-col overflow-hidden bg-[#101215]">
      <ScreenBanner
        onBack={() => router.push("/stage")}
        backLabel="Back to stage select"
        tab={<ModeTab label="Smash" />}
      >
        <SkewTag
          className="hidden border-[3px] border-panel-ink bg-panel-ink sm:inline-block"
          innerClassName="px-4 py-1 text-xs font-bold tracking-wide text-white/75"
        >
          {players.length} fighters
        </SkewTag>
      </ScreenBanner>

      <div className="mx-auto grid w-full max-w-7xl min-h-0 flex-1 items-center gap-5 overflow-y-auto px-4 py-3 lg:grid-cols-[1fr_18rem] sm:px-8">
        <section aria-label="Fighters">
          <ul className="mx-auto grid max-w-3xl grid-cols-5 gap-2 sm:gap-3">
            {entries.map((fighter, i) => {
              const id = fighter?.id ?? RANDOM_FIGHTER;
              const owners = players.filter((p) => p.fighterId === id);
              const onCursor = gridIndex === i;
              return (
                <li key={id}>
                  <button
                    ref={(el) => {
                      tiles.current[i] = el;
                    }}
                    type="button"
                    // Deliberately not "fighter number": a locator for the
                    // READY TO FIGHT button matches on /fight/, and "fighter"
                    // contains it. Nine portraits answering to the same query
                    // as the button that starts the match is a real ambiguity,
                    // not a test detail.
                    aria-label={
                      fighter
                        ? `${fighter.name}, number ${fighter.number}, ${fighter.series}`
                        : "Random"
                    }
                    onMouseEnter={() => setHovered(id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => {
                      setGridIndex(i);
                      setHovered(id);
                    }}
                    onBlur={() => setHovered(null)}
                    onClick={() => assign(id)}
                    className={cn(
                      "group relative block aspect-square w-full overflow-visible border-[3px] transition-transform duration-150",
                      onCursor
                        ? "border-smash-yellow shadow-[0_0_0_3px_var(--panel-ink)] -translate-y-1"
                        : "border-panel-ink hover:-translate-y-1",
                    )}
                  >
                    <span className="absolute inset-0 overflow-hidden">
                      {fighter ? (
                        <FighterBust fighter={fighter} className="h-full w-full" />
                      ) : (
                        <span className="grid h-full w-full place-items-center bg-[#22262e] font-display text-5xl text-smash-yellow">
                          ?
                        </span>
                      )}
                    </span>

                    {fighter ? (
                      <span className="absolute top-0 left-0 z-10 bg-panel-ink/80 px-1.5 py-0.5 font-display text-[0.7rem] leading-none text-white/85">
                        {String(fighter.number).padStart(2, "0")}
                      </span>
                    ) : null}

                    <span className="absolute inset-x-0 bottom-0 z-10 bg-panel-ink/85 px-1.5 py-1">
                      <span className="block truncate text-[0.62rem] leading-tight font-black tracking-[0.06em] text-white uppercase">
                        {fighter?.name ?? "Random"}
                      </span>
                    </span>

                    {/* Which ports already hold this fighter. Ultimate stacks
                        the port tags on the portrait; four small chips read the
                        same and survive a tile a quarter the size. */}
                    {owners.length ? (
                      <span className="absolute top-1 right-1 z-10 flex gap-0.5">
                        {owners.map((p) => (
                          <span
                            key={p.port}
                            className="grid size-4 place-items-center border-2 border-panel-ink text-[0.5rem] leading-none font-black text-panel-ink"
                            style={{ backgroundColor: portColour(p.port) }}
                          >
                            {p.port + 1}
                          </span>
                        ))}
                      </span>
                    ) : null}

                    {onCursor ? <GridCursor port={activePort} /> : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 text-xs text-white/40">
            Arrows move · Enter chooses · 1–4 switches port · Backspace clears · + / − adds and removes a
            player
          </p>
        </section>

        {/* The preview slides in from the right on hover, which is where
            Ultimate puts the big art. Keyed on the fighter so the animation
            replays for each new hover rather than only on the first. */}
        <aside aria-label="Fighter preview" className="hidden max-h-full self-stretch overflow-y-auto lg:block">
          {previewFighter ? (
            <div key={previewFighter.id} className="anim-slide-in-right sticky top-2">
              <SkewCard className="border-[3px] border-panel-ink bg-[#181b20]">
                <SkewArtWell className="aspect-[4/3] w-full">
                  <FighterBust fighter={previewFighter} className="h-full w-full" />
                </SkewArtWell>
              </SkewCard>
              <SkewCard className="mt-3 border-[3px] border-panel-ink bg-panel-bone text-panel-ink">
                <div className="px-7 py-3">
                  <Unskew className="font-display text-xs tracking-[0.2em] text-panel-ink/50">
                    № {String(previewFighter.number).padStart(2, "0")}
                  </Unskew>
                  <h2 className="font-display text-2xl leading-none tracking-[0.03em] uppercase">
                    <Unskew>{previewFighter.name}</Unskew>
                  </h2>
                  <Unskew className="mt-0.5 text-[0.65rem] font-black tracking-[0.1em] text-smash-red uppercase">
                    {previewFighter.series}
                  </Unskew>
                  <p className="mt-2 text-xs leading-snug text-panel-ink/75">
                    <Unskew>{previewFighter.blurb}</Unskew>
                  </p>
                </div>
              </SkewCard>
            </div>
          ) : (
            <SkewPanel
              className="border-[3px] border-dashed border-white/20"
              innerClassName="grid h-40 place-items-center px-6 text-center text-sm text-white/40"
            >
              Hover or focus a portrait to see the fighter.
            </SkewPanel>
          )}
        </aside>
      </div>

      <footer className="border-t-[3px] border-panel-ink bg-[#16181c]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-stretch gap-3 px-4 py-4 sm:px-8">
          {players.map((player) => (
            <PlayerPanel
              key={player.port}
              player={player}
              fighter={findFighter(roster, player.fighterId)}
              active={player.port === activePort}
              onActivate={() => setActivePort(player.port)}
            />
          ))}

          <div className="flex flex-col justify-center gap-2">
            <button
              type="button"
              aria-label="Add a player"
              disabled={players.length >= MAX_PLAYERS}
              onClick={addPlayer}
              className="grid size-10 place-items-center border-[3px] border-panel-ink bg-smash-yellow font-display text-2xl text-panel-ink disabled:bg-[#2a2d33] disabled:text-white/25"
              style={{ transform: "skewX(-12deg)" }}
            >
              <span style={{ transform: "skewX(12deg)" }}>+</span>
            </button>
            <button
              type="button"
              aria-label="Remove a player"
              disabled={players.length <= MIN_PLAYERS}
              onClick={removePlayer}
              className="grid size-10 place-items-center border-[3px] border-panel-ink bg-smash-yellow font-display text-2xl text-panel-ink disabled:bg-[#2a2d33] disabled:text-white/25"
              style={{ transform: "skewX(-12deg)" }}
            >
              <span style={{ transform: "skewX(12deg)" }}>−</span>
            </button>
          </div>

          <div className="ml-auto flex items-center">
            <SkewButton
              onClick={() => router.push("/play")}
              disabled={!ready}
              aria-disabled={!ready}
              className={cn(
                "border-[4px] border-panel-ink px-8 py-4 shadow-[0_8px_0_rgb(0_0_0/0.45)] transition-transform",
                ready
                  ? "bg-smash-yellow text-panel-ink hover:-translate-y-1"
                  : "bg-[#2a2d33] text-white/30",
              )}
              innerClassName="font-display text-xl leading-none tracking-[0.16em] uppercase sm:text-2xl"
            >
              Ready to Fight
            </SkewButton>
          </div>
        </div>
      </footer>
    </main>
  );
}

function PlayerPanel({
  player,
  fighter,
  active,
  onActivate,
}: {
  player: PlayerSlot;
  fighter: MenuFighter | null;
  active: boolean;
  onActivate: () => void;
}) {
  const setCpuLevel = useMatchConfig((s) => s.setCpuLevel);
  const togglePlayerKind = useMatchConfig((s) => s.togglePlayerKind);

  const isCpu = player.kind === "cpu";
  const colour = portColour(player.port);
  const tag = portTag(player.port);
  const random = player.fighterId === RANDOM_FIGHTER;

  return (
    <SkewCard
      className={cn(
        "w-[12rem] shrink-0 border-[4px] transition-transform",
        active ? "-translate-y-1 shadow-[0_8px_0_rgb(0_0_0/0.45)]" : "",
      )}
      style={{
        borderColor: colour,
        backgroundColor: isCpu ? "var(--cpu-grey)" : "#1d2027",
        // The lift rides in the transform beside the shear, since one replaces
        // the other.
        transform: `skewX(-12deg)${active ? " translateY(-4px)" : ""}`,
      }}
    >
      {/* The art well: the hand cursor sits here until a fighter is chosen,
          which is exactly what an empty panel looks like on the console. */}
      <button
        type="button"
        onClick={onActivate}
        aria-label={`Choose for ${tag}`}
        aria-pressed={active}
        className="relative block h-28 w-full"
        style={{ backgroundColor: isCpu ? "var(--cpu-grey-lit)" : "#12151a" }}
      >
        {fighter ? (
          <SkewArtWell className="h-full w-full">
            <FighterBust fighter={fighter} className="h-full w-full" />
          </SkewArtWell>
        ) : random ? (
          <Unskew className="grid h-full w-full place-items-center font-display text-5xl" style={{ color: colour }}>
            ?
          </Unskew>
        ) : null}
        {/* The hand is this port's cursor and stays with its panel, but it
            steps aside once a fighter is in it rather than standing over the
            portrait it was pointing at. */}
        <span
          className={cn(
            "absolute transition-all duration-200",
            fighter ? "bottom-1 left-2 h-12 w-8" : "inset-y-1 left-4 w-11",
          )}
          style={{ transform: "skewX(12deg)" }}
        >
          <Cursor port={player.port} />
        </span>
      </button>

      <div
        className="border-y-[3px] border-panel-ink px-4 py-1"
        style={{ backgroundColor: isCpu ? "var(--cpu-grey-dim)" : "#0f1116" }}
      >
        <Unskew
          className={cn(
            "block max-w-full truncate font-display text-sm tracking-[0.08em] uppercase",
            isCpu ? "text-panel-ink" : "text-white",
          )}
        >
          {fighter?.name ?? (random ? "Random" : "— — —")}
        </Unskew>
      </div>

      <div className="flex h-11 items-center justify-between gap-2 px-4">
        {isCpu ? (
          <>
            <Unskew className="font-display text-[0.7rem] tracking-[0.1em] text-panel-ink uppercase">
              CPU Lv.
            </Unskew>
            <Stepper
              size="sm"
              tone="red"
              label={`CPU level for ${tag}`}
              value={player.cpuLevel}
              min={MIN_CPU_LEVEL}
              max={MAX_CPU_LEVEL}
              inheritShear
              onChange={(next) => setCpuLevel(player.port, next)}
            />
          </>
        ) : (
          <Unskew className="max-w-full truncate text-[0.65rem] font-bold text-white/65">
            {SCHEME_INFO[player.scheme].name}
          </Unskew>
        )}
      </div>

      <div className="flex items-stretch px-4 pb-2">
        <KindTab label="CPU" active={isCpu} port={player.port} onSelect={() => togglePlayerKind(player.port)} />
        <KindTab label="HMN" active={!isCpu} port={player.port} onSelect={() => togglePlayerKind(player.port)} />
      </div>

      <div
        className="flex items-center justify-between border-t-[3px] border-panel-ink px-4 py-1"
        style={{ backgroundColor: colour }}
      >
        <Unskew className="font-display text-lg leading-none text-panel-ink">{tag}</Unskew>
        <Unskew className="text-[0.6rem] font-black tracking-[0.14em] text-panel-ink/70 uppercase">
          {isCpu ? "Computer" : "Human"}
        </Unskew>
      </div>
    </SkewCard>
  );
}

function KindTab({
  label,
  active,
  port,
  onSelect,
}: {
  label: string;
  active: boolean;
  port: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${label} for ${portTag(port)}`}
      onClick={() => {
        if (!active) onSelect();
      }}
      className={cn(
        "flex-1 border-[2px] border-panel-ink py-1 font-display text-[0.7rem] tracking-[0.1em]",
        active ? "text-panel-ink" : "bg-transparent text-panel-ink/35",
      )}
      style={{ backgroundColor: active ? "var(--smash-yellow)" : undefined }}
    >
      <Unskew>{label}</Unskew>
    </button>
  );
}
