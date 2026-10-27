"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { FighterBust } from "@/components/ui/FighterBust";
import { ModeTab, ScreenBanner } from "@/components/ui/Panel";
import { SkewArtWell, SkewButton, SkewCard, SkewPanel, SkewTag, Unskew } from "@/components/ui/SkewPanel";
import { cn } from "@/lib/cn";
import {
  findFighter,
  portColour,
  portTag,
  rulesLabel,
  useMatchConfig,
  useRoster,
  type MatchResult,
  type PlayerResultStat,
} from "@/lib/matchConfig";
import { ONLINE_RESULT_LINGER_MS, leaveOnline } from "@/lib/onlineStore";

const ORDINALS = ["1st", "2nd", "3rd", "4th"] as const;

const OUTCOME_LABELS: Record<MatchResult["kind"], string> = {
  stockOut: "Game Set",
  timeUp: "Time Up",
  suddenDeath: "Sudden Death",
  connectionLost: "Connection Lost",
  desync: "Out of Sync",
};

/** What the status line says about an online match that could not finish. */
const UNFINISHED_STATUS: Partial<Record<MatchResult["kind"], string>> = {
  connectionLost: "The connection to the other player was lost before the match finished. Nobody wins this one.",
  desync: "The two games went out of sync, so this match can't count.",
};

/**
 * Results.
 *
 * The winner's plate is the largest and the placings step down from it, which
 * is how Ultimate reports a match: the ranking is legible from across the room
 * before any of the numbers are read. Falls and self-destructs are shown apart
 * from KOs because they are different failures — one is the opponent's work
 * and the other is yours, and a single "deaths" column would hide that.
 */
export function Results() {
  const router = useRouter();
  const roster = useRoster();
  const result = useMatchConfig((s) => s.result);
  const rules = useMatchConfig((s) => s.rules);

  const online = result?.online === true;
  /** Lost, or out of sync: no placings, and nobody wins. */
  const unfinished = result ? UNFINISHED_STATUS[result.kind] : undefined;
  /**
   * Nobody is left to wait for when the connection is gone. After a desync
   * the other machine is still there, and the match page's runner re-sends
   * the hash that shows it during the grace, so the room stays open for it.
   */
  const leaveAtOnce = result?.kind === "connectionLost";

  // An online result holds the room open until it is left, and it is left once:
  // by the grace running out, by Quit or Back, or by the screen going away,
  // whichever comes first. The ref is what makes the later ones no-ops.
  const left = useRef(false);
  const leaveRoom = useCallback(() => {
    if (left.current) return;
    left.current = true;
    leaveOnline();
  }, []);

  // Always mounted, and filled a moment after the screen arrives: a status
  // region announces a change to one it already knows, not one that arrives
  // with its text already in it.
  const [status, setStatus] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setStatus(unfinished ?? ""), 0);
    return () => clearTimeout(timer);
  }, [unfinished]);

  useEffect(() => {
    if (!online) return;
    if (leaveAtOnce) leaveRoom();
    const grace = leaveAtOnce ? undefined : setTimeout(leaveRoom, ONLINE_RESULT_LINGER_MS);
    return () => {
      clearTimeout(grace);
      leaveRoom();
    };
  }, [online, leaveAtOnce, leaveRoom]);

  if (!result) {
    return (
      <main className="flex min-h-dvh flex-col bg-[#101215]">
        <ScreenBanner onBack={() => router.push("/menu")} tab={<ModeTab label="Results" caret={false} />} />
        <div className="mx-auto w-full max-w-2xl px-6 py-16">
          <SkewPanel
            className="border-[3px] border-dashed border-white/20"
            innerClassName="px-8 py-10 text-center"
          >
            <h1 className="font-display text-3xl tracking-[0.1em] text-white uppercase">No match yet</h1>
            <p className="mt-3 text-sm text-white/55">
              This screen reports a match that has been played. Set the rules, pick a stage and a fighter,
              and it will fill itself in.
            </p>
            <SkewButton
              onClick={() => router.push("/rules")}
              className="mt-6 border-[3px] border-panel-ink bg-smash-yellow px-8 py-3 text-panel-ink"
              innerClassName="font-display text-lg tracking-[0.16em] uppercase"
            >
              Start a match
            </SkewButton>
          </SkewPanel>
        </div>
      </main>
    );
  }

  const statFor = (port: number): PlayerResultStat =>
    result.stats.find((s) => s.port === port) ?? { port, kos: 0, falls: 0, sds: 0 };

  return (
    <main className="flex min-h-dvh flex-col bg-[#101215]">
      <ScreenBanner
        onBack={() => {
          if (online) leaveRoom();
          router.push("/menu");
        }}
        backLabel="Back to the main menu"
        tab={<ModeTab label="Results" caret={false} />}
      >
        <SkewTag
          className="border-[3px] border-panel-ink bg-panel-ink"
          innerClassName="px-4 py-1 font-display text-sm tracking-[0.16em] text-smash-yellow uppercase"
        >
          {OUTCOME_LABELS[result.kind]}
        </SkewTag>
      </ScreenBanner>

      <div className="mx-auto w-full max-w-6xl flex-1 px-5 pb-10 sm:px-8">
        <p role="status" className={cn("text-center text-sm font-bold text-white/80", status && "mb-6")}>
          {status}
        </p>
        {/* A match that never finished has no placings to show, and no rules worth stating. */}
        {unfinished ? null : (
          <ol className="flex flex-wrap items-end justify-center gap-4">
            {result.placings.map((port, place) => {
              const fighter = findFighter(roster, result.fighters[port] ?? null);
              const stat = statFor(port);
              const winner = place === 0;

              return (
                <li
                  key={port}
                  className={cn("shrink-0", winner ? "w-[17rem]" : "w-[13rem]")}
                  style={{ order: place }}
                >
                  <SkewCard
                    className={cn(
                      "border-[4px]",
                      winner ? "shadow-[0_12px_0_rgb(0_0_0/0.5)]" : "shadow-[0_8px_0_rgb(0_0_0/0.4)]",
                    )}
                    style={{ borderColor: portColour(port), backgroundColor: "#181b20" }}
                  >
                    <div className="relative">
                      {fighter ? (
                        <SkewArtWell className={cn("w-full", winner ? "aspect-[4/5]" : "aspect-square")}>
                          <FighterBust fighter={fighter} className="h-full w-full" />
                        </SkewArtWell>
                      ) : (
                        <div className={cn("grid w-full place-items-center bg-[#22262e]", winner ? "aspect-[4/5]" : "aspect-square")}>
                          <Unskew className="font-display text-4xl text-white/30">?</Unskew>
                        </div>
                      )}
                      <span
                        className="absolute top-0 left-0 border-r-[3px] border-b-[3px] border-panel-ink px-4 py-1 font-display leading-none"
                        style={{ backgroundColor: portColour(port), fontSize: winner ? "2.25rem" : "1.5rem" }}
                      >
                        <Unskew className="text-panel-ink">{ORDINALS[place] ?? `${place + 1}th`}</Unskew>
                      </span>
                    </div>

                    <div className="border-y-[3px] border-panel-ink bg-[#0f1116] px-5 py-2">
                      <Unskew
                        className={cn(
                          "block max-w-full truncate font-display tracking-[0.06em] text-white uppercase",
                          winner ? "text-2xl" : "text-lg",
                        )}
                      >
                        {fighter?.name ?? "—"}
                      </Unskew>
                      <Unskew
                        className="text-[0.65rem] font-black tracking-[0.14em] uppercase"
                        style={{ color: portColour(port) }}
                      >
                        {portTag(port)}
                      </Unskew>
                    </div>

                    <dl className="grid grid-cols-3 divide-x-[2px] divide-panel-ink px-3 text-center">
                      <Stat label="KOs" value={stat.kos} big={winner} />
                      <Stat label="Falls" value={stat.falls} big={winner} />
                      <Stat label="SDs" value={stat.sds} big={winner} />
                    </dl>
                  </SkewCard>
                </li>
              );
            })}
          </ol>
        )}

        {/* What was played, which online is the host's rules rather than this machine's. */}
        {unfinished ? null : (
          <p className="mt-6 text-center text-xs text-white/40">{rulesLabel(result.rules ?? rules)}</p>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          {online ? (
            // No rematch online: the room is one match long, so playing again is a new room.
            <SkewButton
              onClick={() => {
                leaveRoom();
                router.push("/online");
              }}
              className="border-[4px] border-panel-ink bg-smash-yellow px-8 py-3 text-panel-ink shadow-[0_8px_0_rgb(0_0_0/0.45)] transition-transform hover:-translate-y-1"
              innerClassName="font-display text-xl tracking-[0.16em] uppercase"
            >
              Play online again
            </SkewButton>
          ) : (
            <>
              <SkewButton
                onClick={() => router.push("/play")}
                className="border-[4px] border-panel-ink bg-smash-yellow px-8 py-3 text-panel-ink shadow-[0_8px_0_rgb(0_0_0/0.45)] transition-transform hover:-translate-y-1"
                innerClassName="font-display text-xl tracking-[0.16em] uppercase"
              >
                Rematch
              </SkewButton>
              <SkewButton
                onClick={() => router.push("/fighters")}
                className="border-[3px] border-panel-ink bg-panel-bone px-6 py-3 text-panel-ink transition-transform hover:-translate-y-1"
                innerClassName="font-display text-lg tracking-[0.14em] uppercase"
              >
                Change Fighters
              </SkewButton>
            </>
          )}
          <SkewButton
            onClick={() => {
              // An online result still holds the room open; quitting is leaving it.
              if (online) leaveRoom();
              router.push("/menu");
            }}
            className="border-[3px] border-panel-ink bg-[#2a2d33] px-6 py-3 text-white/80 transition-transform hover:-translate-y-1"
            innerClassName="font-display text-lg tracking-[0.14em] uppercase"
          >
            Quit
          </SkewButton>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, big }: { label: string; value: number; big: boolean }) {
  return (
    <div className="px-1 py-2">
      <dt className="text-[0.6rem] font-black tracking-[0.14em] text-white/45 uppercase">
        <Unskew>{label}</Unskew>
      </dt>
      <dd className={cn("font-display leading-none text-white tabular-nums", big ? "text-3xl" : "text-2xl")}>
        <Unskew>{value}</Unskew>
      </dd>
    </div>
  );
}
