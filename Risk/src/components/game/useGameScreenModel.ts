"use client";

/**
 * Everything `GameScreen` derives from one session, in one place.
 *
 * The live `GameState` is read here during render and **never stored** — the
 * `version` counter in the UI slice is what makes the derivation re-run
 * (§10).
 */
import { useCallback, useMemo, useState } from "react";

import type { Card, GameState, SeatState, Seat } from "@/engine/types";
import { bestCardSet, type BestSet } from "@/game/cardChoice";
import type { Session } from "@/game/session";
import { useUi } from "@/game/useSession";
import type { PresenceRow } from "@/ports/sync";
import { playEngine } from "@/game/pending";
import { dialogText } from "@/content/dialog";

import type { RosterRow } from "./RosterCapsule";

const EMPTY_HAND: readonly Card[] = [];

export interface GameScreenModel {
  readonly state: GameState;
  readonly rows: readonly RosterRow[];
  readonly balloons: Readonly<Record<number, string>>;
  readonly acting: SeatState | undefined;
  readonly viewer: SeatState | undefined;
  readonly yourTurn: boolean;
  readonly myCards: readonly Card[];
  readonly sets: readonly (readonly [string, string, string])[];
  /** The highest-value legal set, the one the panel opens with (D110). */
  readonly bestSet: BestSet | null;
  readonly tradeValue: number;
  readonly mustTrade: boolean;
  readonly countValue: number;
  setCountValue(value: number): void;
}

export function useGameScreenModel(
  session: Session, presence?: readonly PresenceRow[],
): GameScreenModel {
  const ui = useUi(session, (s) => s);
  const engine = playEngine();
  const state = session.view;
  const [countValue, setCountValue] = useState(1);

  const acting = state.seats[ui.actingSeat];
  const viewer = state.seats[ui.viewerSeat];
  // Memoised, not `?? []`: a fresh empty array each render would re-run every
  // selector below it on every frame.
  const myCards = useMemo<readonly Card[]>(() => viewer?.cards ?? EMPTY_HAND, [viewer]);

  const sets = useMemo(() => engine.cardSets(myCards), [engine, myCards]);
  const bestSet = useMemo(() => bestCardSet(
    sets, myCards,
    (cards) => engine.cardTradeValue(cards, state.setsTradedTotal, state.rules.cardBonus),
    (t) => state.territories[t]?.owner === ui.viewerSeat,
  ), [sets, myCards, engine, state.setsTradedTotal, state.rules.cardBonus, state.territories, ui.viewerSeat]);
  const tradeValue = bestSet?.value ?? 0;

  const mustTrade = useMemo(
    () => engine.mustTradeNow(state, ui.actingSeat),
    [engine, state, ui.actingSeat],
  );

  const territories = useMemo(() => engine.territoryCounts(state), [engine, state]);
  const troops = useMemo(() => engine.troopCounts(state), [engine, state]);

  const rows = useMemo<readonly RosterRow[]>(() => state.seats.map((s) => {
    const row = presence?.find((p) => p.seat === s.seat);
    // Under fog the array selectors return `null` for every seat — nobody can
    // total a board they cannot see. The viewer's **own** capsule still shows
    // its exact numbers, which is what the evidence shows (R73, F52).
    const own = s.seat === ui.viewerSeat;
    return {
      seat: s.seat,
      name: s.name,
      colour: s.colour,
      standing: s.standing,
      bot: s.kind === "bot",
      you: s.seat === ui.viewerSeat,
      active: s.seat === ui.actingSeat,
      troops: troops[s.seat] ?? (own ? engine.troopCountFor(state, s.seat) : null),
      territories: territories[s.seat] ?? (own ? engine.territoryCountFor(state, s.seat) : null),
      cards: s.cardCount,
      ...(row ? { online: row.online, missedTurns: row.missedTurns } : {}),
    };
  }), [state, presence, ui.viewerSeat, ui.actingSeat, troops, territories, engine]);

  const balloons = useMemo(() => {
    const out: Record<number, string> = {};
    for (const b of ui.balloons) out[b.seat] = b.text;
    return out;
  }, [ui.balloons]);

  const setCount = useCallback((value: number) => setCountValue(value), []);

  return {
    state,
    rows,
    balloons,
    acting,
    viewer,
    yourTurn: ui.actingSeat === mySeatOf(session, ui.viewerSeat) && !ui.botPlaying,
    myCards,
    sets,
    bestSet,
    tradeValue,
    mustTrade,
    countValue: clamp(countValue, ui.countRequest?.min ?? 1, ui.countRequest?.max ?? 1),
    setCountValue: setCount,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mySeatOf(session: Session, fallback: Seat): Seat {
  try {
    return session.mySeat();
  } catch {
    return fallback;
  }
}

/** The text of a balloon, so a test can assert it without reaching into content. */
export const balloonText = dialogText;
